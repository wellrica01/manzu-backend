/**
 * INDICATIONS REPOSITORY
 * 
 * Database access layer for indication operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find indications with pagination and filtering
 */
async function findIndications({ skip, limit, where }) {
  return await prisma.$transaction([
    prisma.indication.findMany({
      where,
      take: limit,
      skip,
      orderBy: { id: 'desc' }
    }),
    prisma.indication.count({ where }),
  ]);
}

/**
 * Find indication by ID
 */
async function findIndicationById(id) {
  return await prisma.indication.findUnique({
    where: { id }
  });
}

/**
 * Create indication
 */
async function createIndication(data) {
  return await prisma.indication.create({ data });
}

/**
 * Update indication
 */
async function updateIndication(id, data) {
  return await prisma.indication.update({ where: { id }, data });
}

/**
 * Delete indication
 */
async function deleteIndication(id) {
  return await prisma.indication.delete({ where: { id } });
}

module.exports = {
  findIndications,
  findIndicationById,
  createIndication,
  updateIndication,
  deleteIndication,
};