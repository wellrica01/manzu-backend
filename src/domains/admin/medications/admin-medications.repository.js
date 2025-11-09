/**
 * ADMIN MEDICATIONS REPOSITORY
 * 
 * Database access layer for admin medication management
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find medications with filters and pagination
 */
async function findMedications({ skip, limit, where }) {
  return await prisma.$transaction([
    prisma.medication.findMany({
      where,
      select: {
        id: true,
        brandName: true,
        brandDescription: true,
        localNames: true,
        fullName: true,
        Manufacturer: { select: { id: true, name: true } },
        pharmacopeia: true,
        form: true,
        route: true,
        packSizeExpression: true,
        packSizeQuantity: true,
        packSizeUnit: true,
        nafdacCode: true,
        nafdacStatus: true,
        prescriptionRequired: true,
        regulatoryClass: true,
        restrictedTo: true,
        insuranceCoverage: true,
        imageUrl: true,
        createdAt: true,
        approvalDate: true,
        expiryDate: true,
        storageConditions: true,
        Medication_MedicationIngredient: {
          select: {
            MedicationIngredient: {
              select: {
                id: true,
                strengthValue: true,
                strengthUnit: true,
                perUnitValue: true,
                perUnitType: true,
                ActiveSubstance: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        },
        MedicationAvailability: {
          select: {
            stock: true,
            price: true,
            Pharmacy: { select: { id: true, name: true } },
          },
        },
      },
      take: limit,
      skip,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.medication.count({ where }),
  ]);
}

/**
 * Find medication by ID with full details
 */
async function findMedicationById(id) {
  return await prisma.medication.findUnique({
    where: { id },
    select: {
      id: true,
      brandName: true,
      brandDescription: true,
      localNames: true,
      fullName: true,
      manufacturerId: true,
      Manufacturer: { select: { id: true, name: true } },
      pharmacopeia: true,
      form: true,
      route: true,
      packSizeExpression: true,
      packSizeQuantity: true,
      packSizeUnit: true,
      nafdacCode: true,
      nafdacStatus: true,
      prescriptionRequired: true,
      regulatoryClass: true,
      restrictedTo: true,
      insuranceCoverage: true,
      imageUrl: true,
      createdAt: true,
      approvalDate: true,
      expiryDate: true,
      storageConditions: true,
      Medication_MedicationIngredient: {
        select: {
          MedicationIngredient: {
            select: {
              id: true,
              strengthValue: true,
              strengthUnit: true,
              perUnitValue: true,
              perUnitType: true,
              ActiveSubstance: {
                select: { id: true, name: true }
              }
            }
          }
        }
      },
      MedicationAvailability: {
        select: {
          stock: true,
          price: true,
          Pharmacy: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * Find medication by NAFDAC code
 */
async function findMedicationByNafdacCode(nafdacCode) {
 return await prisma.medication.findFirst({
    where: { nafdacCode },
  });
}

/**
 * Find active substances by IDs
 */
async function findActiveSubstancesByIds(ids) {
  return await prisma.activeSubstance.findMany({
    where: { id: { in: ids } },
  });
}

/**
 * Create medication
 */
async function createMedication(data, tx = null) {
  const client = tx || prisma;
  return await client.medication.create({ data });
}

/**
 * Update medication
 */
async function updateMedication(id, data, tx = null) {
  const client = tx || prisma;
  return await client.medication.update({
    where: { id },
    data,
  });
}

/**
 * Delete medication and related records
 */
async function deleteMedicationWithRelations(id) {
  return await prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany({
      where: { medicationId: id },
    });
    await tx.medicationAvailability.deleteMany({
      where: { medicationId: id },
    });
    await tx.medication.delete({
      where: { id },
    });
  });
}

/**
 * Execute transaction
 */
async function executeTransaction(callback) {
  return await prisma.$transaction(callback);
}

module.exports = {
  findMedications,
  findMedicationById,
  findMedicationByNafdacCode,
  findActiveSubstancesByIds,
  createMedication,
  updateMedication,
  deleteMedicationWithRelations,
  executeTransaction,
};