/**
 * ADMIN PHARMACIES REPOSITORY
 * 
 * Database access layer for admin pharmacy management
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find pharmacies with filters and pagination
 */
async function findPharmacies({ skip, limit, where }) {
  return await prisma.$transaction([
    prisma.pharmacy.findMany({
      where,
      select: {
        id: true,
        name: true,
        address: true,
        lga: true,
        state: true,
        phone: true,
        licenseNumber: true,
        status: true,
        logoUrl: true,
        isActive: true,
        createdAt: true,
        verifiedAt: true,
      },
      take: limit,
      skip,
    }),
    prisma.pharmacy.count({ where }),
  ]);
}

/**
 * Find all pharmacies (simple list)
 */
async function findAllPharmaciesSimple() {
  return await prisma.pharmacy.findMany({
    select: {
      id: true,
      name: true,
    },
  });
}

/**
 * Find pharmacy by ID
 */
async function findPharmacyById(id) {
  return await prisma.pharmacy.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      lga: true,
      state: true,
      phone: true,
      licenseNumber: true,
      status: true,
      logoUrl: true,
      isActive: true,
      createdAt: true,
      verifiedAt: true,
    },
  });
}

/**
 * Find pharmacy by license number
 */
async function findPharmacyByLicense(licenseNumber) {
  return await prisma.pharmacy.findUnique({
    where: { licenseNumber },
  });
}

/**
 * Update pharmacy
 */
async function updatePharmacy(id, data) {
  return await prisma.pharmacy.update({
    where: { id },
    data,
  });
}

/**
 * Update pharmacy location (PostGIS)
 */
async function updatePharmacyLocation(id, lat, long, tx = null) {
  const client = tx || prisma;
  return await client.$executeRaw`
    UPDATE "Pharmacy"
    SET location = ST_SetSRID(ST_MakePoint(${long}, ${lat}), 4326)
    WHERE id = ${id}
  `;
}

/**
 * Delete pharmacy
 */
async function deletePharmacy(id) {
  return await prisma.pharmacy.delete({
    where: { id },
  });
}

/**
 * Execute transaction
 */
async function executeTransaction(callback) {
  return await prisma.$transaction(callback);
}

module.exports = {
  findPharmacies,
  findAllPharmaciesSimple,
  findPharmacyById,
  findPharmacyByLicense,
  updatePharmacy,
  updatePharmacyLocation,
  deletePharmacy,
  executeTransaction,
};