/**
 * PHARMACY MEDICATIONS SERVICE
 * 
 * Business logic for pharmacy medication inventory operations
 */

const repository = require('./pharmacy-medications.repository');
const { formatPackSizeUnit, formatPerUnitType, formatStrengthUnit } = require('../../../utils/medicationUtils');
const { getPharmacyAccessInfo, canPharmacyAccessMedication } = require('../../../utils/medicationAccessControl');
const { buildMedicationWhereClause } = require('../../../utils/medicationAccessControl');
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

  // Get inventory stats (used for summary regardless of filter)
  const [totalItems, lowStockCount, outOfStockCount, expiringSoonCount, allItemsForValue] = 
    await repository.getInventoryStats(pharmacyId);
  const totalValue = allItemsForValue.reduce((sum, item) => sum + (item.stock * item.price), 0);

  let medications = [];
  let total = 0;

  // ===== INVENTORY-BASED FILTERS: Query MedicationAvailability table =====
  if (['stocked', 'low_stock', 'out_of_stock', 'expiring_soon'].includes(status)) {
    const inventoryWhere = { pharmacyId };
    
    // Stock filters
    if (status === 'stocked') {
      inventoryWhere.stock = { gt: 0 };
    } else if (status === 'low_stock') {
      inventoryWhere.stock = { gt: 0, lt: 10 };
    } else if (status === 'out_of_stock') {
      inventoryWhere.stock = { equals: 0 };
    } else if (status === 'expiring_soon') {
      const today = new Date();
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(today.getDate() + 30);
      inventoryWhere.expiryDate = { 
        gte: today, 
        lte: thirtyDaysFromNow 
      };
      inventoryWhere.stock = { gt: 0 }; // Only show stocked items that are expiring
    }
    
    // Add search filter on the medication relation
    if (search || prescriptionRequired !== undefined) {
      inventoryWhere.Medication = {};
      
      if (search) {
        inventoryWhere.Medication.OR = [
          { brandName: { contains: search, mode: 'insensitive' } },
          {
            Medication_MedicationIngredient: {
              some: {
                MedicationIngredient: {
                  ActiveSubstance: { name: { contains: search, mode: 'insensitive' } }
                }
              }
            }
          }
        ];
      }
      
      if (prescriptionRequired !== undefined) {
        inventoryWhere.Medication.prescriptionRequired = prescriptionRequired === 'true';
      }
    }
    
    // Query inventory with medication details
    const [inventoryItems, inventoryTotal] = await prisma.$transaction([
      prisma.medicationAvailability.findMany({
        where: inventoryWhere,
        include: {
          Medication: {
            include: {
              Manufacturer: { select: { id: true, name: true } },
              Medication_MedicationIngredient: {
                include: {
                  MedicationIngredient: {
                    include: { ActiveSubstance: true }
                  }
                }
              }
            }
          }
        },
        orderBy: { Medication: { brandName: 'asc' } },
        skip,
        take: limit,
      }),
      prisma.medicationAvailability.count({ where: inventoryWhere })
    ]);
    
    // Transform to match expected format
    medications = inventoryItems.map(item => ({
      ...item.Medication,
      MedicationAvailability: [item]
    }));
    total = inventoryTotal;
  } 
  
  // ===== CATALOG-BASED FILTERS: Query Medication table =====
  else if (status === 'all' || status === 'not_stocked' || !status) {
    const medicationWhere = buildMedicationWhereClause(pharmacy.pharmacyType);
    
    // Add search
    if (search) {
      if (!medicationWhere.AND) medicationWhere.AND = [];
      medicationWhere.AND.push({
        OR: [
          { brandName: { contains: search, mode: 'insensitive' } },
          {
            Medication_MedicationIngredient: {
              some: {
                MedicationIngredient: {
                  ActiveSubstance: { name: { contains: search, mode: 'insensitive' } }
                }
              }
            }
          }
        ]
      });
    }
    
    // Add prescription filter
    if (prescriptionRequired !== undefined) {
      medicationWhere.prescriptionRequired = prescriptionRequired === 'true';
    }
    
    // For 'not_stocked', exclude medications with stock
    if (status === 'not_stocked') {
      medicationWhere.OR = [
        { MedicationAvailability: { none: { pharmacyId } } },
        { MedicationAvailability: { every: { pharmacyId, stock: 0 } } }
      ];
    }
    
    // Query medications with optional inventory
    [medications, total] = await prisma.$transaction([
      prisma.medication.findMany({
        where: medicationWhere,
        include: {
          Manufacturer: { select: { id: true, name: true } },
          Medication_MedicationIngredient: {
            include: {
              MedicationIngredient: {
                include: { ActiveSubstance: true }
              }
            }
          },
          MedicationAvailability: {
            where: { pharmacyId }
          }
        },
        orderBy: { brandName: 'asc' },
        skip,
        take: limit,
      }),
      prisma.medication.count({ where: medicationWhere })
    ]);
  }

  // ===== FORMAT MEDICATIONS =====
  const formattedMedications = medications.map(m => {
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
      isStocked: !!inventoryItem && inventoryItem.stock > 0,
      pharmacyId: inventoryItem?.pharmacyId || null,
      stock: inventoryItem?.stock || null,
      price: inventoryItem?.price || null,
      expiryDate: inventoryItem?.expiryDate || null,
      receivedDate: inventoryItem?.receivedDate || null,
      batchNumber: inventoryItem?.batchNumber || null,
    };
  });

  // Get total catalog size for this pharmacy type
  const catalogSize = await prisma.medication.count({
    where: buildMedicationWhereClause(pharmacy.pharmacyType)
  });

  // Get access info for this pharmacy type
  const accessInfo = getPharmacyAccessInfo(pharmacy.pharmacyType);

  console.log('Medication catalog fetched:', { 
    pharmacyType: pharmacy.pharmacyType,
    status,
    resultCount: formattedMedications.length, 
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
      catalogSize, // Total medications available to this pharmacy type
      stockedCount: totalItems,
      notStockedCount: catalogSize - totalItems,
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

// Helper functions (keep existing implementations)
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