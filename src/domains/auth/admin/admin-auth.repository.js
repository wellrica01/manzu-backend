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

module.exports = {
  findAdminByEmail,
};