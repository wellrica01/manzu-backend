/**
 * MANUFACTURERS REPOSITORY
 * 
 * Database access layer for manufacturer operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find manufacturers with pagination and filtering
 */
async function findManufacturers({ skip, limit, where }) {
  return await prisma.$transaction([
    prisma.manufacturer.findMany({
      where,
      take: limit,
      skip,
      orderBy: { name: 'asc' }
    }),
    prisma.manufacturer.count({ where }),
  ]);
}

/**
 * Find manufacturer by ID
 */
async function findManufacturerById(id) {
  return await prisma.manufacturer.findUnique({
    where: { id }
  });
}

/**
 * Create manufacturer
 */
async function createManufacturer(data) {
  return await prisma.manufacturer.create({ data });
}

/**
 * Update manufacturer
 */
async function updateManufacturer(id, data) {
  return await prisma.manufacturer.update({ where: { id }, data });
}

/**
 * Delete manufacturer
 */
async function deleteManufacturer(id) {
  return await prisma.manufacturer.delete({ where: { id } });
}

/**
 * Search manufacturers
 */
async function searchManufacturers({ search, limit }) {
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { country: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  return await prisma.manufacturer.findMany({
    where,
    take: limit,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      country: true,
    },
  });
}

module.exports = {
  findManufacturers,
  findManufacturerById,
  createManufacturer,
  updateManufacturer,
  deleteManufacturer,
  searchManufacturers,
};