/**
 * PHARMACY MEDICATIONS SERVICE
 * 
 * Business logic for pharmacy medication inventory operations
 */

const repository = require('./pharmacy-medications.repository');
const { formatPackSizeUnit, formatPerUnitType, formatStrengthUnit } = require('../../../utils/medicationUtils');
const { getPharmacyAccessInfo, canPharmacyAccessMedication } = require('../../../utils/medicationAccessControl');
const prisma = require('../../../core/database/prisma');

/**
 * Fetch medication catalog with inventory status (NEW UNIFIED APPROACH)
 */
async function fetchMedicationCatalog(pharmacyId, {
  page = 1,
  limit = 10,
  search,
  status, // 'all', 'stocked', 'not_stocked', 'low_stock', 'out_of_stock', 'expiring_soon'
  prescriptionRequired,
} = {}) {
  const skip = (page - 1) * limit;

  // Get pharmacy info
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: { pharmacyType: true, name: true },
  });

  if (!pharmacy) {
    throw new Error('Pharmacy not found');
  }

  // Build medication search filter
  const medicationWhere = {};
  
  if (search) {
    medicationWhere.OR = [
      { brandName: { contains: search, mode: 'insensitive' } },
      {
        Medication_MedicationIngredient: {
          some: {
            MedicationIngredient: {
              ActiveSubstance: { name: { contains: search, mode: 'insensitive' } },
            },
          },
        },
      },
    ];
  }

  if (prescriptionRequired !== undefined) {
    const isRequired = prescriptionRequired === 'true';
    medicationWhere.prescriptionRequired = isRequired;
  }

  // Get medications with inventory status
  const { medications, total } = await repository.getMedicationCatalogWithInventory(
    pharmacyId,
    pharmacy.pharmacyType,
    { skip, limit, where: { Medication: medicationWhere } }
  );

  // Get inventory stats
  const [totalItems, lowStockCount, outOfStockCount, expiringSoonCount, allItemsForValue] = 
    await repository.getInventoryStats(pharmacyId);

  // Calculate total inventory value
  const totalValue = allItemsForValue.reduce((sum, item) => sum + (item.stock * item.price), 0);

  // Format medications with inventory status
  const formattedMedications = medications
    .map(m => {
      const inventoryItem = m.MedicationAvailability?.[0];
      const ingredients = formatIngredients(m.Medication_MedicationIngredient);
      const activeSubstancesDisplay = formatActiveSubstancesDisplay(ingredients);

      return {
        medicationId: m.id,
        brandName: m.brandName,
        form: m.form,
        packSizeExpression: m.packSizeExpression,
        packSizeUnit: formatPackSizeUnit(m.packSizeUnit),
        regulatoryClass: m.regulatoryClass,
        prescriptionRequired: m.prescriptionRequired,
        ingredients: ingredients,
        activeSubstances: activeSubstancesDisplay,
        displayName: `${m.brandName} (${activeSubstancesDisplay})`,
        manufacturer: m.Manufacturer ? {
          id: m.Manufacturer.id,
          name: m.Manufacturer.name
        } : null,
        manufacturerName: m.Manufacturer?.name || null,
        
        // Inventory status
        isStocked: !!inventoryItem,
        pharmacyId: inventoryItem?.pharmacyId || null,
        stock: inventoryItem?.stock || null,
        price: inventoryItem?.price || null,
        expiryDate: inventoryItem?.expiryDate || null,
        receivedDate: inventoryItem?.receivedDate || null,
        batchNumber: inventoryItem?.batchNumber || null,
      };
    })
    .filter(m => {
      // Apply status filters
      if (status === 'stocked') {
        return m.isStocked && m.stock > 0;
      } else if (status === 'not_stocked') {
        return !m.isStocked || m.stock === 0;
      } else if (status === 'low_stock') {
        return m.isStocked && m.stock > 0 && m.stock < 10;
      } else if (status === 'out_of_stock') {
        return m.isStocked && m.stock === 0;
      } else if (status === 'expiring_soon') {
        if (!m.expiryDate) return false;
        const today = new Date();
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(today.getDate() + 30);
        const expiryDate = new Date(m.expiryDate);
        return expiryDate >= today && expiryDate <= thirtyDaysFromNow;
      }
      return true; // 'all'
    });

  // Get access info for this pharmacy type
  const accessInfo = getPharmacyAccessInfo(pharmacy.pharmacyType);

  console.log('Medication catalog fetched:', { 
    pharmacyType: pharmacy.pharmacyType,
    catalogSize: formattedMedications.length, 
    total, 
    totalItems,
    stats: { 
      lowStock: lowStockCount, 
      outOfStock: outOfStockCount, 
      expiringSoon: expiringSoonCount,
      totalValue 
    }
  });

  return {
    medications: formattedMedications,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    summary: {
      totalItems,
      lowStockCount,
      outOfStockCount,
      expiringSoonCount,
      totalValue: Math.round(totalValue),
      catalogSize: total, // Total medications available to this pharmacy type
      stockedCount: totalItems,
      notStockedCount: total - totalItems,
    },
    pharmacyInfo: {
      type: pharmacy.pharmacyType,
      name: pharmacy.name,
      accessRules: accessInfo,
    }
  };
}

/**
 * Legacy method - Fetch medications in pharmacy inventory with filters and stats
 * DEPRECATED: Use fetchMedicationCatalog instead
 */
async function fetchMedications(pharmacyId, options = {}) {
  console.warn('fetchMedications is deprecated. Use fetchMedicationCatalog instead.');
  
  // Map to new method
  return await fetchMedicationCatalog(pharmacyId, {
    ...options,
    status: options.lowStock ? 'low_stock' : 
            options.outOfStock ? 'out_of_stock' : 
            options.expiringSoon ? 'expiring_soon' : 'stocked',
  });
}

/**
 * Update or create medication in inventory (UNIFIED METHOD)
 */
async function updateOrCreateMedication({ pharmacyId, medicationId, stock, price, receivedDate, expiryDate, batchNumber }) {
  // Verify pharmacy has access to this medication
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: { pharmacyType: true },
  });

  if (!pharmacy) {
    throw new Error('Pharmacy not found');
  }

  // Get medication details
  const medication = await prisma.medication.findUnique({
    where: { id: medicationId },
  });

  if (!medication) {
    throw new Error('Medication not found');
  }

  // Check access
  if (!canPharmacyAccessMedication(pharmacy.pharmacyType, medication)) {
    throw new Error(`Your pharmacy type (${pharmacy.pharmacyType}) cannot stock this medication`);
  }

  // Upsert inventory
  const updatedMedication = await repository.upsertMedicationInInventory(medicationId, pharmacyId, {
    stock: parseInt(stock),
    price: parseFloat(price.toFixed(2)),
    receivedDate: receivedDate ? new Date(receivedDate) : null,
    expiryDate: expiryDate ? new Date(expiryDate) : null,
    batchNumber: batchNumber?.trim() || null,
  });

  const activeSubstances = updatedMedication.Medication.Medication_MedicationIngredient
    .map(mi => mi.MedicationIngredient.ActiveSubstance.name)
    .join(', ');

  return {
    pharmacyId: updatedMedication.pharmacyId,
    medicationId: updatedMedication.medicationId,
    brandName: updatedMedication.Medication.brandName,
    activeSubstances,
    stock: updatedMedication.stock,
    price: updatedMedication.price,
    receivedDate: updatedMedication.receivedDate,
    expiryDate: updatedMedication.expiryDate,
    batchNumber: updatedMedication.batchNumber,
  };
}

/**
 * Add medication to pharmacy inventory
 * DEPRECATED: Use updateOrCreateMedication instead
 */
async function addMedication(data) {
  console.warn('addMedication is deprecated. Use updateOrCreateMedication instead.');
  return await updateOrCreateMedication(data);
}

/**
 * Update medication in pharmacy inventory
 * DEPRECATED: Use updateOrCreateMedication instead
 */
async function updateMedication(data) {
  console.warn('updateMedication is deprecated. Use updateOrCreateMedication instead.');
  return await updateOrCreateMedication(data);
}

/**
 * Delete medication from pharmacy inventory
 */
async function deleteMedication(pharmacyId, medicationId) {
  const medication = await repository.findMedicationInInventory(medicationId, pharmacyId);
  if (!medication) {
    throw new Error('Medication not found in inventory');
  }

  await repository.deleteMedicationFromInventory(medicationId, pharmacyId);

  console.log('Medication deleted from inventory:', { pharmacyId, medicationId });
}

// Helper functions
function formatIngredients(medicationIngredients) {
  return medicationIngredients.map(mmi => ({
    id: mmi.MedicationIngredient.id,
    activeSubstanceId: mmi.MedicationIngredient.ActiveSubstance?.id || null,
    activeSubstanceName: mmi.MedicationIngredient.ActiveSubstance?.name || null,
    strengthValue: mmi.MedicationIngredient.strengthValue,
    strengthUnit: formatStrengthUnit(mmi.MedicationIngredient.strengthUnit),
    perUnitValue: mmi.MedicationIngredient.perUnitValue,
    perUnitType: formatPerUnitType(mmi.MedicationIngredient.perUnitType),
  }));
}

function formatActiveSubstancesDisplay(ingredients) {
  return ingredients
    .map(ing => {
      const substance = ing.activeSubstanceName;
      let strengthPart = '';
      if (ing.strengthValue) {
        strengthPart += `${ing.strengthValue}`;
        if (ing.strengthUnit) strengthPart += ` ${ing.strengthUnit}`;
      }
      return strengthPart ? `${substance} ${strengthPart}` : substance;
    })
    .join(', ');
}

module.exports = {
  fetchMedications, // DEPRECATED
  fetchMedicationCatalog, // NEW
  addMedication, // DEPRECATED
  updateMedication, // DEPRECATED
  updateOrCreateMedication, // NEW
  deleteMedication,
};