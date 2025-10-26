/**
 * ADMIN USERS SERVICE
 * 
 * Business logic for admin user management
 */

const usersRepository = require('./admin-users.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

/**
 * Get admin users with filters and pagination
 */
async function getAdminUsers({ page, limit, role, email }) {
  const skip = (page - 1) * limit;
  const where = {};
  
  if (role) where.role = role;
  if (email) where.email = { contains: email, mode: 'insensitive' };

  const [users, total] = await usersRepository.findAdminUsers({
    skip,
    limit,
    where,
  });

  console.log('Admin users fetched:', { count: users.length, total });

  return {
    users,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get single admin user by ID
 */
async function getAdminUser(id) {
  const user = await usersRepository.findAdminUserById(id);

  if (!user) {
    const error = new Error('Admin user not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }

  console.log('Admin user fetched:', { userId: id });
  return user;
}

/**
 * Get pharmacy users with filters and pagination
 */
async function getPharmacyUsers({ page, limit, role, email, pharmacyId }) {
  const skip = (page - 1) * limit;
  const where = {};
  
  if (role) where.role = role;
  if (email) where.email = { contains: email, mode: 'insensitive' };
  if (pharmacyId) where.pharmacyId = pharmacyId;

  const [users, total] = await usersRepository.findPharmacyUsers({
    skip,
    limit,
    where,
  });

  console.log('Pharmacy users fetched:', { count: users.length, total });

  return {
    users,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get single pharmacy user by ID
 */
async function getPharmacyUser(id) {
  const user = await usersRepository.findPharmacyUserById(id);

  if (!user) {
    const error = new Error('Pharmacy user not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }

  console.log('Pharmacy user fetched:', { userId: id });
  return user;
}

module.exports = {
  getAdminUsers,
  getAdminUser,
  getPharmacyUsers,
  getPharmacyUser,
};