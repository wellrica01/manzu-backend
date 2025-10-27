/**
 * MEDICATION INGREDIENTS REPOSITORY
 * 
 * Database access layer for medication ingredient operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find medication ingredients with pagination and filtering
 */
async function findMedicationIngredients({ skip, limit, where }) {
  return await prisma.$transaction([
    prisma.medicationIngredient.findMany({
      where,
      take: limit,
      skip,
      include: {
        ActiveSubstance: {
          select: { id: true, name: true, type: true }
        },
        Medication_MedicationIngredient: {
          select: {
            Medication: {
              select: { id: true, brandName: true }
            }
          }
        }
      },
      orderBy: { id: 'desc' }
    }),
    prisma.medicationIngredient.count({ where }),
  ]);
}

/**
 * Find medication ingredient by ID
 */
async function findMedicationIngredientById(id) {
  return await prisma.medicationIngredient.findUnique({
    where: { id },
    include: {
      ActiveSubstance: {
        select: { id: true, name: true, type: true }
      },
      Medication_MedicationIngredient: {
        select: {
          Medication: {
            select: { id: true, brandName: true, form: true }
          }
        }
      }
    }
  });
}

/**
 * Create medication ingredient
 */
async function createMedicationIngredient(data) {
  return await prisma.medicationIngredient.create({ data });
}

/**
 * Update medication ingredient
 */
async function updateMedicationIngredient(id, data) {
  return await prisma.medicationIngredient.update({ where: { id }, data });
}

/**
 * Delete medication ingredient
 */
async function deleteMedicationIngredient(id) {
  return await prisma.medicationIngredient.delete({ where: { id } });
}

/**
 * Search medication ingredients
 */
async function searchMedicationIngredients({ search, limit }) {
  const where = search
    ? {
        OR: [
          { ActiveSubstance: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }
    : {};

  return await prisma.medicationIngredient.findMany({
    where,
    take: limit,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      strengthValue: true,
      strengthUnit: true,
      ActiveSubstance: {
        select: {
          name: true
        }
      }
    },
  });
}

module.exports = {
  findMedicationIngredients,
  findMedicationIngredientById,
  createMedicationIngredient,
  updateMedicationIngredient,
  deleteMedicationIngredient,
  searchMedicationIngredients,
};