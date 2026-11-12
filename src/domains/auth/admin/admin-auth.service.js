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
  loginAdmin,
};
