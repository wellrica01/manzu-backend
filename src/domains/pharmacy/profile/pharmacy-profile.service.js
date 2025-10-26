/**
 * PHARMACY PROFILE SERVICE
 * 
 * Business logic for pharmacy profile operations
 */

const repository = require('./pharmacy-profile.repository');
const prisma = require('../../../core/database/prisma');
const { validateLocation } = require('../../../utils/location');

/**
 * Get pharmacy profile (user + pharmacy)
 */
async function getProfile(userId, pharmacyId) {
  const user = await repository.findPharmacyUser(userId);
  
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const pharmacy = await repository.findPharmacy(pharmacyId);
  
  if (!pharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = 404;
    throw error;
  }

  console.log('Profile fetched:', { userId, pharmacyId });

  return { user, pharmacy };
}

/**
 * Edit pharmacy profile (user + pharmacy)
 */
async function editProfile({ user, pharmacy }, userId, pharmacyId) {
  // Validate location if coordinates provided
  if (pharmacy.latitude && pharmacy.longitude) {
    validateLocation(
      pharmacy.state, 
      pharmacy.lga, 
      pharmacy.ward, 
      pharmacy.latitude, 
      pharmacy.longitude
    );
  }

  // Check email uniqueness
  const existingUser = await repository.findPharmacyUser(userId);
  
  if (user.email !== existingUser.email) {
    const emailConflict = await repository.findPharmacyUserByEmail(user.email);
    if (emailConflict) {
      const error = new Error('Email already registered');
      error.status = 400;
      throw error;
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Update user
    const updatedUser = await repository.updatePharmacyUser(userId, { 
      name: user.name, 
      email: user.email 
    }, tx);

    // Prepare pharmacy update data
    const pharmacyUpdateData = {
      name: pharmacy.name,
      address: pharmacy.address,
      lga: pharmacy.lga,
      state: pharmacy.state,
      ward: pharmacy.ward || null,
      phone: pharmacy.phone,
      logoUrl: pharmacy.logoUrl || null,
      latitude: pharmacy.latitude ? parseFloat(pharmacy.latitude) : null,
      longitude: pharmacy.longitude ? parseFloat(pharmacy.longitude) : null,
      deliveryAvailability: pharmacy.deliveryAvailability || false,
    };

    // Update pharmacy
    const updatedPharmacy = await repository.updatePharmacy(pharmacyId, pharmacyUpdateData, tx);

    // Update PostGIS location if coordinates provided
    if (pharmacy.latitude && pharmacy.longitude) {
      await repository.updatePharmacyLocation(pharmacyId, pharmacy.latitude, pharmacy.longitude, tx);
    }

    return { user: updatedUser, pharmacy: updatedPharmacy };
  });

  console.log('Profile updated:', { userId, pharmacyId });

  return { updatedUser: result.user, updatedPharmacy: result.pharmacy };
}

/**
 * Register device token for push notifications
 */
async function registerDevice(pharmacyId, deviceToken) {
  await repository.registerDeviceToken(pharmacyId, deviceToken);
  console.log('Device registered:', { pharmacyId });
}

module.exports = {
  getProfile,
  editProfile,
  registerDevice,
};