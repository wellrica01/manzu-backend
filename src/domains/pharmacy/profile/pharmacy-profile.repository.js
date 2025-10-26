/**
 * PHARMACY PROFILE REPOSITORY
 * 
 * Database access layer for pharmacy profile operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find pharmacy user by ID
 */
async function findPharmacyUser(userId) {
  return await prisma.pharmacyUser.findUnique({
    where: { id: userId },
    select: { 
      id: true, 
      name: true, 
      email: true, 
      role: true,
      lastLogin: true 
    },
  });
}

/**
 * Find pharmacy by ID with operating hours
 */
async function findPharmacy(pharmacyId) {
  return await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: { 
      id: true, 
      name: true, 
      address: true, 
      lga: true, 
      state: true, 
      ward: true, 
      phone: true, 
      licenseNumber: true, 
      status: true, 
      logoUrl: true,
      latitude: true,
      longitude: true,
      deliveryAvailability: true,
      pharmacyType: true,
      isActive: true,
      createdAt: true,
      verifiedAt: true,
      OperatingHour: {
        select: {
          id: true,
          dayOfWeek: true,
          openTime: true,
          closeTime: true,
        }
      }
    },
  });
}

/**
 * Find pharmacy user by email
 */
async function findPharmacyUserByEmail(email) {
  return await prisma.pharmacyUser.findUnique({
    where: { email },
  });
}

/**
 * Update pharmacy user
 */
async function updatePharmacyUser(userId, data, tx) {
  return await tx.pharmacyUser.update({
    where: { id: userId },
    data,
  });
}

/**
 * Update pharmacy
 */
async function updatePharmacy(pharmacyId, data, tx) {
  return await tx.pharmacy.update({
    where: { id: pharmacyId },
    data,
  });
}

/**
 * Update pharmacy location (PostGIS)
 */
async function updatePharmacyLocation(pharmacyId, latitude, longitude, tx) {
  return await tx.$queryRaw`
    UPDATE "Pharmacy"
    SET location = ST_SetSRID(ST_MakePoint(${parseFloat(longitude)}, ${parseFloat(latitude)}), 4326),
        "locationCapturedAt" = NOW()
    WHERE id = ${pharmacyId}
  `;
}

/**
 * Register device token
 */
async function registerDeviceToken(pharmacyId, deviceToken) {
  return await prisma.pharmacy.update({
    where: { id: pharmacyId },
    data: { devicetoken: deviceToken },
  });
}

module.exports = {
  findPharmacyUser,
  findPharmacy,
  findPharmacyUserByEmail,
  updatePharmacyUser,
  updatePharmacy,
  updatePharmacyLocation,
  registerDeviceToken,
};