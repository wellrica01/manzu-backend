/**
 * ACTIVE SUBSTANCES REPOSITORY
 * 
 * Database access layer for active substance operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find active substances with pagination and filtering
 */
async function findActiveSubstances({ skip, limit, where }) {
  return await prisma.$transaction([
    prisma.activeSubstance.findMany({
      where,
      take: limit,
      skip,
      include: {
        GenericName: {
          select: { id: true, name: true }
        }
      },
      orderBy: { name: 'asc' }
    }),
    prisma.activeSubstance.count({ where }),
  ]);
}

/**
 * Find active substance by ID
 */
async function findActiveSubstanceById(id) {
  return await prisma.activeSubstance.findUnique({
    where: { id },
    include: {
      GenericName: {
        select: { id: true, name: true, description: true }
      },
      MedicationIngredient: {
        select: { id: true, strengthValue: true, strengthUnit: true }
      }
    }
  });
}

/**
 * Create active substance
 */
async function createActiveSubstance(data) {
  return await prisma.activeSubstance.create({ data });
}

/**
 * Update active substance
 */
async function updateActiveSubstance(id, data) {
  return await prisma.activeSubstance.update({ where: { id }, data });
}

/**
 * Delete active substance
 */
async function deleteActiveSubstance(id) {
  return await prisma.activeSubstance.delete({ where: { id } });
}

/**
 * Search active substances
 */
async function searchActiveSubstances({ search, limit }) {
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  return await prisma.activeSubstance.findMany({
    where,
    take: limit,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true
    },
  });
}

module.exports = {
  findActiveSubstances,
  findActiveSubstanceById,
  createActiveSubstance,
  updateActiveSubstance,
  deleteActiveSubstance,
  searchActiveSubstances,
};