/**
 * GENERIC NAMES REPOSITORY
 * 
 * Database access layer for generic name operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find generic names with pagination and filtering
 */
async function findGenericNames({ skip, limit, where }) {
  return await prisma.$transaction([
    prisma.genericName.findMany({
      where,
      take: limit,
      skip,
      include: {
        ActiveSubstance: {
          select: { id: true, name: true, type: true },
        },
        Indication: {
          select: { id: true, description: true },
        },
        Contraindication: {
          select: { id: true, description: true },
        },
        GenericNameChemicalSubstance: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.genericName.count({ where }),
  ]);
}

/**
 * Find generic name by ID
 */
async function findGenericNameById(id) {
  return await prisma.genericName.findUnique({
    where: { id: Number(id) },
    include: {
      ActiveSubstance: { select: { id: true, name: true, type: true } },
      Indication: { select: { id: true, name: true, description: true } },
      Contraindication: { select: { id: true, name: true, description: true } },
      GenericNameChemicalSubstance: true,
    },
  });
}

/**
 * Create generic name
 */
async function createGenericName(data) {
  return await prisma.genericName.create({ data });
}

/**
 * Update generic name
 */
async function updateGenericName(id, data) {
  return await prisma.genericName.update({ where: { id }, data });
}

/**
 * Delete generic name
 */
async function deleteGenericName(id) {
  return await prisma.genericName.delete({ where: { id } });
}

module.exports = {
  findGenericNames,
  findGenericNameById,
  createGenericName,
  updateGenericName,
  deleteGenericName,
};