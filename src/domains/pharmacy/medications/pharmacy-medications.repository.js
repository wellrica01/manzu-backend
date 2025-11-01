/**
 * PHARMACY MEDICATIONS REPOSITORY
 * 
 * Database access layer for pharmacy medication inventory operations
 */

const prisma = require('../../../core/database/prisma');
const { buildMedicationWhereClause } = require('../../../utils/medicationAccessControl');

/**
 * Get all medications accessible to a pharmacy (virtual catalog)
 */
async function getApplicableMedications(pharmacyType) {
  const whereClause = buildMedicationWhereClause(pharmacyType);
  
  return await prisma.medication.findMany({
    where: whereClause,
    include: {
      Manufacturer: { select: { id: true, name: true } },
      Medication_MedicationIngredient: {
        include: {
          MedicationIngredient: {
            include: { ActiveSubstance: true },
          },
        },
      },
    },
    orderBy: { brandName: 'asc' },
  });
}

/**
 * Get medication catalog with inventory status
 */
async function getMedicationCatalogWithInventory(pharmacyId, pharmacyType, { skip, limit, where }) {
  // Get applicable medications for this pharmacy type
  const medicationWhere = buildMedicationWhereClause(pharmacyType);
  
  // Merge with additional filters (search, etc.)
  const combinedWhere = {
    ...medicationWhere,
    ...(where?.Medication || {}),
  };
  
  // Get medications
  const medications = await prisma.medication.findMany({
    where: combinedWhere,
    include: {
      Manufacturer: { select: { id: true, name: true } },
      Medication_MedicationIngredient: {
        include: {
          MedicationIngredient: {
            include: { ActiveSubstance: true },
          },
        },
      },
      MedicationAvailability: {
        where: { pharmacyId },
      },
    },
    orderBy: { brandName: 'asc' },
    take: limit,
    skip,
  });
  
  // Count total
  const total = await prisma.medication.count({ where: combinedWhere });
  
  return { medications, total };
}

/**
 * Original findMedications - now returns only stocked items
 */
async function findMedications(pharmacyId, { skip, limit, where }) {
  return await prisma.$transaction([
    prisma.medicationAvailability.findMany({
      where,
      include: {
        Medication: {
          include: {
            Manufacturer: { select: { id: true, name: true } },
            Medication_MedicationIngredient: {
              include: {
                MedicationIngredient: {
                  include: { ActiveSubstance: true },
                },
              },
            },
          },
        },
      },
      orderBy: { Medication: { brandName: 'asc' } },
      take: limit,
      skip,
    }),
    prisma.medicationAvailability.count({ where }),
  ]);
}

async function getInventoryStats(pharmacyId) {
  const allInventoryWhere = { pharmacyId };
  const today = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(today.getDate() + 30);

  return await prisma.$transaction([
    prisma.medicationAvailability.count({ where: allInventoryWhere }),
    prisma.medicationAvailability.count({ where: { ...allInventoryWhere, stock: { lt: 10, gt: 0 } } }),
    prisma.medicationAvailability.count({ where: { ...allInventoryWhere, stock: { equals: 0 } } }),
    prisma.medicationAvailability.count({ where: { ...allInventoryWhere, expiryDate: { gte: today, lte: thirtyDaysFromNow } } }),
    prisma.medicationAvailability.findMany({ where: allInventoryWhere, select: { stock: true, price: true } }),
  ]);
}

async function getAllMedications() {
  return await prisma.medication.findMany({
    include: {
      Medication_MedicationIngredient: {
        include: {
          MedicationIngredient: {
            include: { ActiveSubstance: true },
          },
        },
      },
    },
  });
}

async function findMedicationInInventory(medicationId, pharmacyId) {
  return await prisma.medicationAvailability.findUnique({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
    include: {
      Medication: { 
        include: { 
          Manufacturer: true,
          Medication_MedicationIngredient: { 
            include: { 
              MedicationIngredient: { 
                include: { ActiveSubstance: true } 
              } 
            } 
          } 
        } 
      },
    },
  });
}

async function createMedicationInInventory(data) {
  return await prisma.medicationAvailability.create({
    data,
    include: {
      Medication: { 
        include: { 
          Manufacturer: true,
          Medication_MedicationIngredient: { 
            include: { 
              MedicationIngredient: { 
                include: { ActiveSubstance: true } 
              } 
            } 
          } 
        } 
      },
    },
  });
}

async function updateMedicationInInventory(medicationId, pharmacyId, data) {
  return await prisma.medicationAvailability.update({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
    data,
    include: {
      Medication: { 
        include: { 
          Manufacturer: true,
          Medication_MedicationIngredient: { 
            include: { 
              MedicationIngredient: { 
                include: { ActiveSubstance: true } 
              } 
            } 
          } 
        } 
      },
    },
  });
}

async function deleteMedicationFromInventory(medicationId, pharmacyId) {
  return await prisma.medicationAvailability.delete({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
  });
}

/**
 * Upsert medication in inventory (create or update)
 */
async function upsertMedicationInInventory(medicationId, pharmacyId, data) {
  return await prisma.medicationAvailability.upsert({
    where: { 
      medicationId_pharmacyId: { medicationId, pharmacyId } 
    },
    create: {
      medicationId,
      pharmacyId,
      ...data,
    },
    update: data,
    include: {
      Medication: { 
        include: { 
          Manufacturer: true,
          Medication_MedicationIngredient: { 
            include: { 
              MedicationIngredient: { 
                include: { ActiveSubstance: true } 
              } 
            } 
          } 
        } 
      },
    },
  });
}

module.exports = {
  findMedications,
  getInventoryStats,
  getAllMedications,
  getApplicableMedications,
  getMedicationCatalogWithInventory,
  findMedicationInInventory,
  createMedicationInInventory,
  updateMedicationInInventory,
  upsertMedicationInInventory,
  deleteMedicationFromInventory,
};