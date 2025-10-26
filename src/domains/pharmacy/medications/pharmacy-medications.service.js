/**
 * PHARMACY MEDICATIONS SERVICE
 * 
 * Business logic for pharmacy medication inventory operations
 */

const repository = require('./pharmacy-medications.repository');
const { formatPackSizeUnit, formatPerUnitType, formatStrengthUnit } = require('../../../utils/medicationUtils');

/**
 * Fetch medications in pharmacy inventory with filters and stats
 */
async function fetchMedications(pharmacyId, {
  page = 1,
  limit = 10,
  search,
  lowStock,
  outOfStock,
  expiringSoon,
  prescriptionRequired,
} = {}) {
  const skip = (page - 1) * limit;

  // Build where clause for filtering
  const where = { pharmacyId };

  if (search) {
    where.Medication = {
      OR: [
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
      ],
    };
  }

  if (lowStock) {
    where.stock = { lt: 10, gt: 0 }; // Low stock: 1-9
  } else if (outOfStock) {
    where.stock = { equals: 0 }; // Out of stock: 0
  }

  // Expiring soon filter
  if (expiringSoon) {
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);
    where.expiryDate = {
      gte: today,
      lte: thirtyDaysFromNow
    };
  }

  if (prescriptionRequired !== undefined) {
    const isRequired = prescriptionRequired === 'true';
    where.Medication = {
      ...where.Medication,
      prescriptionRequired: isRequired,
    };
  }

  // Fetch medications and total count
  const [medications, total] = await repository.findMedications(pharmacyId, { skip, limit, where });

  // Get inventory stats
  const [totalItems, lowStockCount, outOfStockCount, expiringSoonCount, allItemsForValue] = 
    await repository.getInventoryStats(pharmacyId);

  // Calculate total inventory value
  const totalValue = allItemsForValue.reduce((sum, item) => sum + (item.stock * item.price), 0);

  // Fetch all medications for availableMedications
  const allMedications = await repository.getAllMedications();

  // Helper to format ingredients
  const formatIngredients = (medicationIngredients) => {
    return medicationIngredients.map(mmi => ({
      id: mmi.MedicationIngredient.id,
      activeSubstanceId: mmi.MedicationIngredient.ActiveSubstance?.id || null,
      activeSubstanceName: mmi.MedicationIngredient.ActiveSubstance?.name || null,
      strengthValue: mmi.MedicationIngredient.strengthValue,
      strengthUnit: formatStrengthUnit(mmi.MedicationIngredient.strengthUnit),
      perUnitValue: mmi.MedicationIngredient.perUnitValue,
      perUnitType: formatPerUnitType(mmi.MedicationIngredient.perUnitType),
    }));
  };

  // Format medications (inventory items)
  const formattedMedications = medications.map(m => {
    const ingredients = formatIngredients(m.Medication.Medication_MedicationIngredient);
    const activeSubstancesDisplay = ingredients
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

    return {
      pharmacyId: m.pharmacyId,
      medicationId: m.medicationId,
      brandName: m.Medication.brandName,
      form: m.Medication.form,
      packSizeExpression: m.Medication.packSizeExpression,
      packSizeUnit: formatPackSizeUnit(m.Medication.packSizeUnit),
      ingredients: ingredients,
      activeSubstances: activeSubstancesDisplay,
      displayName: `${m.Medication.brandName} (${activeSubstancesDisplay})`,
      manufacturer: m.Medication.Manufacturer ? {
        id: m.Medication.Manufacturer.id,
        name: m.Medication.Manufacturer.name
      } : null,
      manufacturerName: m.Medication.Manufacturer?.name || null,
      stock: m.stock,
      price: m.price,
      expiryDate: m.expiryDate,
      receivedDate: m.receivedDate,
      batchNumber: m.batchNumber,
    };
  });

  // Format availableMedications
  const formattedAvailable = allMedications.map(m => {
    const ingredients = formatIngredients(m.Medication_MedicationIngredient);
    const activeSubstancesDisplay = ingredients
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

    return {
      id: m.id,
      brandName: m.brandName,
      ingredients: ingredients,
      activeSubstances: activeSubstancesDisplay,
      displayName: `${m.brandName} (${activeSubstancesDisplay})${m.form ? ' ' + m.form : ''}`,
    };
  });

  console.log('Medications fetched:', { 
    count: formattedMedications.length, 
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
    availableMedications: formattedAvailable,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    summary: {
      totalItems,
      lowStockCount,
      outOfStockCount,
      expiringSoonCount,
      totalValue: Math.round(totalValue),
    }
  };
}

/**
 * Add medication to pharmacy inventory
 */
async function addMedication({ pharmacyId, medicationId, stock, price, receivedDate, expiryDate, batchNumber }) {
  const existing = await repository.findMedicationInInventory(medicationId, pharmacyId);
  if (existing) throw new Error('Medication already exists in pharmacy inventory');

  const medication = await repository.createMedicationInInventory({
    pharmacyId,
    medicationId,
    stock,
    price: parseFloat(price.toFixed(2)),
    receivedDate: receivedDate ? new Date(receivedDate) : null,
    expiryDate: expiryDate ? new Date(expiryDate) : null,
    batchNumber,
  });

  const activeSubstances = medication.Medication.Medication_MedicationIngredient
    .map(mi => mi.MedicationIngredient.ActiveSubstance.name)
    .join(', ');

  return {
    pharmacyId: medication.pharmacyId,
    medicationId: medication.medicationId,
    brandName: medication.Medication.brandName,
    activeSubstances,
    stock: medication.stock,
    price: medication.price,
    receivedDate: medication.receivedDate,
    expiryDate: medication.expiryDate,
    batchNumber,
  };
}

/**
 * Update medication in pharmacy inventory
 */
async function updateMedication({ pharmacyId, medicationId, stock, price, receivedDate, expiryDate, batchNumber }) {
  const medication = await repository.findMedicationInInventory(medicationId, pharmacyId);
  if (!medication) throw new Error('Medication not found');

  const updatedMedication = await repository.updateMedicationInInventory(medicationId, pharmacyId, {
    stock,
    price: parseFloat(price.toFixed(2)),
    receivedDate: receivedDate ? new Date(receivedDate) : null,
    expiryDate: expiryDate ? new Date(expiryDate) : null,
    batchNumber,
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
 * Delete medication from pharmacy inventory
 */
async function deleteMedication(pharmacyId, medicationId) {
  const medication = await repository.findMedicationInInventory(medicationId, pharmacyId);
  if (!medication) {
    throw new Error('Medication not found');
  }

  await repository.deleteMedicationFromInventory(medicationId, pharmacyId);

  console.log('Medication deleted:', { pharmacyId, medicationId });
}

module.exports = {
  fetchMedications,
  addMedication,
  updateMedication,
  deleteMedication,
};