/**
 * ADMIN AUTH SERVICE
 * 
 * Business logic for admin authentication
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const adminAuthRepository = require('./admin-auth.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

/**
 * Register admin user
 */
async function registerAdmin({ name, email, password }) {
  const existingAdmin = await adminAuthRepository.findAdminByEmail(email);
  
  if (existingAdmin) {
    const error = new Error('Email already registered');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = ERROR_CODES.ALREADY_EXISTS;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const newAdmin = await adminAuthRepository.createAdmin({
    name,
    email,
    hashedPassword,
    role: 'ADMIN',
  });

  console.log('Admin registered:', { adminId: newAdmin.id });

  const token = jwt.sign(
    { adminId: newAdmin.id, role: newAdmin.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, admin: newAdmin };
}

/**
 * Login admin user
 */
async function loginAdmin({ email, password }) {
  const admin = await adminAuthRepository.findAdminByEmail(email);
  
  if (!admin) {
    const error = new Error('Invalid email or password');
    error.status = HTTP_STATUS.UNAUTHORIZED;
    error.code = ERROR_CODES.INVALID_CREDENTIALS;
    throw error;
  }

  const isPasswordValid = await bcrypt.compare(password, admin.password);
  if (!isPasswordValid) {
    const error = new Error('Invalid email or password');
    error.status = HTTP_STATUS.UNAUTHORIZED;
    error.code = ERROR_CODES.INVALID_CREDENTIALS;
    throw error;
  }

  console.log('Admin authenticated:', { adminId: admin.id });

  const token = jwt.sign(
    { adminId: admin.id, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, admin };
}

module.exports = {
  registerAdmin,
  loginAdmin,
};