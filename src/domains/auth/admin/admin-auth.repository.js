/**
 * ADMIN AUTH REPOSITORY
 * 
 * Database access layer for admin authentication
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find admin by email
 */
async function findAdminByEmail(email) {
  return await prisma.adminUser.findUnique({
    where: { email },
  });
}

/**
 * Create admin user
 */
async function createAdmin(adminData) {
  return await prisma.adminUser.create({
    data: {
      name: adminData.name,
      email: adminData.email,
      password: adminData.hashedPassword,
      role: adminData.role || 'ADMIN',
    },
  });
}

module.exports = {
  findAdminByEmail,
  createAdmin,
};