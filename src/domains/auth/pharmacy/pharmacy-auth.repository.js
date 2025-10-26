/**
 * PHARMACY AUTH REPOSITORY
 * 
 * Database access layer for pharmacy authentication
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find pharmacy by license number
 */
async function findPharmacyByLicense(licenseNumber) {
  return await prisma.pharmacy.findUnique({
    where: { licenseNumber },
  });
}

/**
 * Find pharmacy user by email
 */
async function findPharmacyUserByEmail(email) {
  return await prisma.pharmacyUser.findUnique({
    where: { email },
    include: { Pharmacy: true },
  });
}

/**
 * Find pharmacy user by ID
 */
async function findPharmacyUserById(userId) {
  return await prisma.pharmacyUser.findUnique({
    where: { id: userId },
  });
}

/**
 * Find pharmacy user by ID and pharmacy
 */
async function findPharmacyUserByIdAndPharmacy(userId, pharmacyId) {
  return await prisma.pharmacyUser.findFirst({
    where: { id: userId, pharmacyId },
  });
}

/**
 * Create pharmacy with GPS coordinates
 */
async function createPharmacyWithGPS(pharmacyData, tx = null) {
  const client = tx || prisma;
  const locationAccuracy = pharmacyData.locationAccuracy || null;
  const locationCapturedAt = new Date();
  const logoUrl = pharmacyData.logoUrl || null;

  const [newPharmacy] = await client.$queryRaw`
    INSERT INTO "Pharmacy" (
      name, 
      location, 
      latitude,
      longitude,
      "locationAccuracy",
      "locationCapturedAt",
      address, 
      lga, 
      state, 
      phone, 
      "licenseNumber", 
      status, 
      "logoUrl"
    )
    VALUES (
      ${pharmacyData.name},
      ST_SetSRID(ST_MakePoint(${pharmacyData.longitude}, ${pharmacyData.latitude}), 4326),
      ${pharmacyData.latitude},
      ${pharmacyData.longitude},
      ${locationAccuracy},
      ${locationCapturedAt},
      ${pharmacyData.address},
      ${pharmacyData.lga},
      ${pharmacyData.state},
      ${pharmacyData.phone},
      ${pharmacyData.licenseNumber},
      'PENDING',
      ${logoUrl}
    )
    RETURNING id, name, latitude, longitude, "locationAccuracy"
  `;

  return newPharmacy;
}

/**
 * Create pharmacy user
 */
async function createPharmacyUser(userData, tx = null) {
  const client = tx || prisma;
  
  return await client.pharmacyUser.create({
    data: {
      email: userData.email,
      password: userData.hashedPassword,
      name: userData.name,
      role: userData.role || 'MANAGER',
      pharmacyId: userData.pharmacyId,
    },
  });
}

/**
 * Update pharmacy user
 */
async function updatePharmacyUser(userId, updateData) {
  return await prisma.pharmacyUser.update({
    where: { id: userId },
    data: updateData,
  });
}

/**
 * Delete pharmacy user
 */
async function deletePharmacyUser(userId) {
  return await prisma.pharmacyUser.delete({
    where: { id: userId },
  });
}

/**
 * Execute transaction
 */
async function executeTransaction(callback) {
  return await prisma.$transaction(callback);
}

module.exports = {
  findPharmacyByLicense,
  findPharmacyUserByEmail,
  findPharmacyUserById,
  findPharmacyUserByIdAndPharmacy,
  createPharmacyWithGPS,
  createPharmacyUser,
  updatePharmacyUser,
  deletePharmacyUser,
  executeTransaction,
};