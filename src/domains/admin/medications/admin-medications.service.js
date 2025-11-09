/**
 * ADMIN MEDICATIONS SERVICE
 * 
 * Business logic for admin medication management
 */

const medicationsRepository = require('./admin-medications.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');
const { 
  capitalize, 
  formatPerUnitType, 
  formatPackSizeUnit, 
  formatStrengthUnit, 
  resolveManufacturer, 
  computePackSizeQuantity, 
  linkIngredients 
} = require('../../../utils/medicationUtils');

/**
 * Get medications with filters and pagination
 */
async function getMedications({
  page = 1,
  limit = 10,
  brandName,
  activeSubstance,
  prescriptionRequired,
  pharmacyId,
  manufacturerId,
  form,
  nafdacStatus
}) {
  const skip = (page - 1) * limit;
  const where = {};

  // Parameter mapping
  if (prescriptionRequired !== undefined) {
    where.prescriptionRequired = prescriptionRequired;
  }
  if (brandName) where.brandName = { contains: brandName, mode: 'insensitive' };
  if (manufacturerId) where.manufacturerId = manufacturerId;
  if (form) where.form = form;
  if (nafdacStatus) where.nafdacStatus = nafdacStatus;

  // Pharmacy filter
  if (pharmacyId) {
    where.availabilities = { some: { pharmacyId } };
  }

  // Active substance filter
  if (activeSubstance) {
    where.Medication_MedicationIngredient = {
      some: {
        MedicationIngredient: {
          ActiveSubstance: {
            name: { contains: activeSubstance, mode: 'insensitive' }
          }
        }
      }
    };
  }

  try {
    const [medications, total] = await medicationsRepository.findMedications({
      skip,
      limit,
      where,
    });

    // Improved ingredient mapping
    const medsWithIngredients = medications.map(med => ({
      ...med,
      form: capitalize(med.form),
      packSizeUnit: formatPackSizeUnit(med.packSizeUnit),
      ingredients: med.Medication_MedicationIngredient.map(mmi => ({
        id: mmi.MedicationIngredient.id,
        activeSubstanceId: mmi.MedicationIngredient.ActiveSubstance?.id || null,
        activeSubstanceName: mmi.MedicationIngredient.ActiveSubstance?.name || null,
        strengthValue: mmi.MedicationIngredient.strengthValue,
        strengthUnit: formatStrengthUnit(mmi.MedicationIngredient.strengthUnit),
        perUnitValue: mmi.MedicationIngredient.perUnitValue,
        perUnitType: formatPerUnitType(mmi.MedicationIngredient.perUnitType),
      }))
    }));

    console.log('Medications fetched:', { count: medications.length, total, filters: where });

    return {
      medications: medsWithIngredients,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  } catch (error) {
    console.error('Error fetching medications:', error);
    throw new Error('Failed to fetch medications');
  }
}

/**
 * Get single medication by ID
 */
async function getMedication(id) {
  try {
    const medication = await medicationsRepository.findMedicationById(id);

    if (!medication) {
      const error = new Error('Medication not found');
      error.status = HTTP_STATUS.NOT_FOUND;
      error.code = ERROR_CODES.NOT_FOUND;
      throw error;
    }

    const medicationWithIngredients = {
      ...medication,
      ingredients: medication.Medication_MedicationIngredient.map(mmi => ({
        id: mmi.MedicationIngredient.id,
        activeSubstanceId: mmi.MedicationIngredient.ActiveSubstance?.id || null,
        activeSubstanceName: mmi.MedicationIngredient.ActiveSubstance?.name || null,
        strengthValue: mmi.MedicationIngredient.strengthValue,
        strengthUnit: mmi.MedicationIngredient.strengthUnit,
        perUnitValue: mmi.MedicationIngredient.perUnitValue,
        perUnitType: mmi.MedicationIngredient.perUnitType,
      }))
    };

    console.log('Medication fetched:', { medicationId: id });
    return medicationWithIngredients;
  } catch (error) {
    console.error('Error fetching medication:', error);
    throw error;
  }
}

/**
 * Create medication
 */
async function createMedication(data) {
  try {
    console.log('Received data:', JSON.stringify(data, null, 2));

  // Validate active substances only for new ingredients
  const newIngredients = data.ingredients.filter(ing => !ing.id);
  const activeSubstanceIds = newIngredients
    .map(ing => ing.activeSubstanceId)
    .filter(id => id != null);

  let activeSubstanceMap = new Map();
  if (activeSubstanceIds.length > 0) {
    const activeSubstances = await medicationsRepository.findActiveSubstancesByIds(activeSubstanceIds);
    activeSubstanceMap = new Map(activeSubstances.map(as => [as.id, as]));
    for (const ing of newIngredients) {
      if (!activeSubstanceMap.has(ing.activeSubstanceId)) {
        throw new Error(`Active substance not found for ID ${ing.activeSubstanceId}`);
      }
    }
  }

    // Check for duplicate NAFDAC code
    const existingMed = await medicationsRepository.findMedicationByNafdacCode(data.nafdacCode);
    if (existingMed) throw new Error('NAFDAC code already exists');

    // Run everything inside a single transaction
    const medication = await medicationsRepository.executeTransaction(async (tx) => {
      // Resolve manufacturer ID (existing or newly created)
      const manufacturerId = await resolveManufacturer(tx, data);

      // Compute pack size quantity from expression like "10 x 10"
      const computedQty = computePackSizeQuantity(data.packSizeExpression);

      // Create medication record
      const med = await medicationsRepository.createMedication({
        brandName: data.brandName,
        nafdacCode: data.nafdacCode,
        prescriptionRequired: data.prescriptionRequired ?? false,
        brandDescription: data.brandDescription || null,
        manufacturerId,
        pharmacopeia: data.pharmacopeia || null,
        form: data.form || null,
        packSizeExpression: data.packSizeExpression || null,
        packSizeQuantity: computedQty,
        packSizeUnit: data.packSizeUnit || null,
        imageUrl: data.imageUrl || null,
      }, tx);

      for (const ing of data.ingredients) {
        if (ing.id) {
          const existing = await tx.medicationIngredient.findUnique({
            where: { id: ing.id },
          });
          if (!existing) {
            throw new Error(`MedicationIngredient ${ing.id} not found`);
          }
          // Merge any provided updates if needed, but for create, probably just link
        }
      }


      // Validate existing ingredients
      const existingIngredients = data.ingredients.filter(ing => ing.id);
      for (const ing of existingIngredients) {
        const existingIng = await tx.medicationIngredient.findUnique({
          where: { id: ing.id },
        });
        if (!existingIng) {
          throw new Error(`MedicationIngredient ${ing.id} not found`);
        }
      }

      // Link ingredients to this medication
      await linkIngredients(tx, med.id, data.ingredients);

      return med;
    });

    console.log('Medication created:', { medicationId: medication.id });
    return medication;

  } catch (error) {
    console.error('Error creating medication:', error);
    throw error;
  }
}

/**
 * Update medication
 */
async function updateMedication(id, data) {
  try {
    console.log('Update data received:', JSON.stringify(data, null, 2));

    const medication = await medicationsRepository.findMedicationById(id);
    if (!medication) {
      const error = new Error('Medication not found');
      error.status = HTTP_STATUS.NOT_FOUND;
      error.code = ERROR_CODES.NOT_FOUND;
      throw error;
    }


    const newIngredients = data.ingredients.filter(ing => !ing.id);
    const activeSubstanceIds = newIngredients
      .map(ing => ing.activeSubstanceId)
      .filter(id => id != null);

    let activeSubstanceMap = new Map();
    if (activeSubstanceIds.length > 0) {
      const activeSubstances = await medicationsRepository.findActiveSubstancesByIds(activeSubstanceIds, tx);  // Pass tx if needed, but since outside, move inside
      activeSubstanceMap = new Map(activeSubstances.map(as => [as.id, as]));
      for (const ing of newIngredients) {
        if (!activeSubstanceMap.has(ing.activeSubstanceId)) {
          throw new Error(`Active substance not found for ID ${ing.activeSubstanceId}`);
        }
      }
    }

    // Check NAFDAC code uniqueness if being updated
    if (data.nafdacCode && data.nafdacCode !== medication.nafdacCode) {
      const existingMed = await medicationsRepository.findMedicationByNafdacCode(data.nafdacCode);
      if (existingMed) throw new Error('NAFDAC code already exists');
    }

    return await medicationsRepository.executeTransaction(async (tx) => {
      const updateData = {};

      // Update basic fields if provided
      if (data.brandName !== undefined) updateData.brandName = data.brandName;
      if (data.brandDescription !== undefined) updateData.brandDescription = data.brandDescription;

      // Manufacturer handling
      if (data.manufacturerId !== undefined) {
        const manufacturer = await tx.manufacturer.findUnique({ where: { id: data.manufacturerId } });
        if (!manufacturer) throw new Error('Manufacturer not found');
        updateData.manufacturerId = data.manufacturerId;
      } else if (data.manufacturerName) {
        const manufacturerId = await resolveManufacturer(tx, data);
        updateData.manufacturerId = manufacturerId;
      }

      if (data.form !== undefined) updateData.form = data.form;

      // Update pack size expression and quantity
      if (data.packSizeExpression !== undefined) {
        updateData.packSizeExpression = data.packSizeExpression;
        updateData.packSizeQuantity = computePackSizeQuantity(data.packSizeExpression);
      }

      if (data.packSizeUnit !== undefined) updateData.packSizeUnit = data.packSizeUnit;
      if (data.pharmacopeia !== undefined) updateData.pharmacopeia = data.pharmacopeia;
      if (data.nafdacCode !== undefined) updateData.nafdacCode = data.nafdacCode;
      if (data.prescriptionRequired !== undefined) updateData.prescriptionRequired = !!data.prescriptionRequired;
      if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
      if (data.fullName !== undefined) updateData.fullName = data.fullName;

      // Apply updates to medication
      const updatedMedication = await medicationsRepository.updateMedication(id, updateData, tx);

      // Update ingredients if provided
      if (Array.isArray(data.ingredients)) {
      
        const existingIngredients = data.ingredients.filter(ing => ing.id);
          for (const ing of existingIngredients) {
            const existingIng = await tx.medicationIngredient.findUnique({
              where: { id: ing.id },
            });
            if (!existingIng) {
              throw new Error(`MedicationIngredient ${ing.id} not found`);
            }
          }

        await linkIngredients(tx, id, data.ingredients, true); // true = remove orphaned ingredients
      }

      return updatedMedication;
    });

  } catch (error) {
    console.error('Error updating medication:', error);
    throw error;
  }
}

/**
 * Delete medication
 */
async function deleteMedication(id) {
  try {
    await medicationsRepository.deleteMedicationWithRelations(id);
    console.log('Medication, related MedicationAvailability, and OrderItem records deleted:', { medicationId: id });
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Medication not found');
      err.status = HTTP_STATUS.NOT_FOUND;
      err.code = ERROR_CODES.NOT_FOUND;
      throw err;
    }
    throw error;
  }
}

module.exports = {
  getMedications,
  getMedication,
  createMedication,
  updateMedication,
  deleteMedication,
};