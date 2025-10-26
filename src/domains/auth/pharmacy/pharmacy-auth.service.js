/**
 * PHARMACY AUTH SERVICE
 * 
 * Business logic for pharmacy authentication and user management
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validateLocation } = require('../../../utils/location');
const pharmacyAuthRepository = require('./pharmacy-auth.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

/**
 * Register pharmacy and initial user
 */
async function registerPharmacyAndUser({ pharmacy, user }) {
  // Validate location (state, lga, and GPS bounds)
  validateLocation(pharmacy.state, pharmacy.lga, pharmacy.latitude, pharmacy.longitude);

  // Check if pharmacy license exists
  const existingPharmacy = await pharmacyAuthRepository.findPharmacyByLicense(pharmacy.licenseNumber);
  if (existingPharmacy) {
    const error = new Error('Pharmacy license number already exists');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = ERROR_CODES.ALREADY_EXISTS;
    throw error;
  }

  // Check if user email exists
  const existingUser = await pharmacyAuthRepository.findPharmacyUserByEmail(user.email);
  if (existingUser) {
    const error = new Error('Email already registered');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = ERROR_CODES.ALREADY_EXISTS;
    throw error;
  }

  // Hash PIN
  const salt = await bcrypt.genSalt(10);
  const hashedPin = await bcrypt.hash(user.pin, salt);

  // Create pharmacy and user in transaction
  const result = await pharmacyAuthRepository.executeTransaction(async (tx) => {
    const newPharmacy = await pharmacyAuthRepository.createPharmacyWithGPS(pharmacy, tx);
    
    const newUser = await pharmacyAuthRepository.createPharmacyUser({
      email: user.email,
      hashedPassword: hashedPin,
      name: user.name,
      role: 'MANAGER',
      pharmacyId: newPharmacy.id,
    }, tx);

    return { pharmacy: newPharmacy, user: newUser };
  });

  console.log('Pharmacy registered with GPS:', {
    pharmacyId: result.pharmacy.id,
    lat: result.pharmacy.latitude,
    lng: result.pharmacy.longitude,
    accuracy: result.pharmacy.locationAccuracy,
  });

  // Generate JWT token
  const token = jwt.sign(
    { userId: result.user.id, pharmacyId: result.pharmacy.id, role: result.user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, user: result.user, pharmacy: result.pharmacy };
}

/**
 * Login pharmacy user
 */
async function loginUser({ email, pin }) {
  const user = await pharmacyAuthRepository.findPharmacyUserByEmail(email);
  
  if (!user) {
    const error = new Error('Invalid email or PIN');
    error.status = HTTP_STATUS.UNAUTHORIZED;
    error.code = ERROR_CODES.INVALID_CREDENTIALS;
    throw error;
  }

  const isPinValid = await bcrypt.compare(pin, user.password);
  if (!isPinValid) {
    const error = new Error('Invalid email or PIN');
    error.status = HTTP_STATUS.UNAUTHORIZED;
    error.code = ERROR_CODES.INVALID_CREDENTIALS;
    throw error;
  }

  console.log('User authenticated with PIN:', { userId: user.id, pharmacyId: user.pharmacyId });

  const token = jwt.sign(
    { userId: user.id, pharmacyId: user.pharmacyId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, user, pharmacy: user.Pharmacy };
}

/**
 * Add pharmacy user
 */
async function addPharmacyUser({ name, email, pin, role, pharmacyId }) {
  const existingUser = await pharmacyAuthRepository.findPharmacyUserByEmail(email);
  
  if (existingUser) {
    const error = new Error('Email already registered');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = ERROR_CODES.ALREADY_EXISTS;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPin = await bcrypt.hash(pin, salt);

  const newUser = await pharmacyAuthRepository.createPharmacyUser({
    name,
    email,
    hashedPassword: hashedPin,
    role: role.toUpperCase(),
    pharmacyId,
  });

  console.log('User added with PIN:', { userId: newUser.id, pharmacyId });

  return newUser;
}

/**
 * Edit pharmacy user
 */
async function editPharmacyUser(userId, { name, email, pin, role }, managerId, pharmacyId) {
  if (userId === managerId) {
    const error = new Error('Cannot edit your own account');
    error.status = HTTP_STATUS.FORBIDDEN;
    error.code = ERROR_CODES.FORBIDDEN;
    throw error;
  }

  const user = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(userId, pharmacyId);
  
  if (!user) {
    const error = new Error('User not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }

  if (email !== user.email) {
    const existingUser = await pharmacyAuthRepository.findPharmacyUserByEmail(email);
    if (existingUser) {
      const error = new Error('Email already registered');
      error.status = HTTP_STATUS.BAD_REQUEST;
      error.code = ERROR_CODES.ALREADY_EXISTS;
      throw error;
    }
  }

  const updateData = { name, email };
  if (pin) {
    const salt = await bcrypt.genSalt(10);
    updateData.password = await bcrypt.hash(pin, salt);
  }
  if (typeof role !== 'undefined') {
    updateData.role = role.toUpperCase();
  }

  const updatedUser = await pharmacyAuthRepository.updatePharmacyUser(userId, updateData);

  console.log('User updated:', { userId: updatedUser.id, pharmacyId });

  return updatedUser;
}

/**
 * Delete pharmacy user
 */
async function deletePharmacyUser(userId, managerId, pharmacyId) {
  if (userId === managerId) {
    const error = new Error('Cannot delete your own account');
    error.status = HTTP_STATUS.FORBIDDEN;
    error.code = ERROR_CODES.FORBIDDEN;
    throw error;
  }

  const user = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(userId, pharmacyId);
  
  if (!user) {
    const error = new Error('User not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }

  await pharmacyAuthRepository.deletePharmacyUser(userId);

  console.log('User deleted:', { userId, pharmacyId });
}

/**
 * Change pharmacy user PIN
 */
async function changePharmacyUserPin(userId, currentPin, newPin) {
  const user = await pharmacyAuthRepository.findPharmacyUserById(userId);
  
  if (!user) {
    return { success: false, message: 'User not found' };
  }

  const isPinValid = await bcrypt.compare(currentPin, user.password);
  if (!isPinValid) {
    return { success: false, message: 'Current PIN is incorrect' };
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPin = await bcrypt.hash(newPin, salt);

  await pharmacyAuthRepository.updatePharmacyUser(userId, { password: hashedPin });

  return { success: true };
}

module.exports = {
  registerPharmacyAndUser,
  loginUser,
  addPharmacyUser,
  editPharmacyUser,
  deletePharmacyUser,
  changePharmacyUserPin,
};