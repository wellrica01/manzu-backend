/**
 * ADMIN AUTH REPOSITORY
 *
 * Database access layer for admin authentication.
 */

const prisma = require('../../../core/database/prisma');

async function findAdminByEmail(email) {
  return await prisma.adminUser.findUnique({
    where: { email },
  });
}

/**
 * Update admin fields (FND-07b2: failedAttempts, lockedUntil).
 * Small wrapper so the admin auth service does not touch prisma directly.
 */
async function updateAdmin(id, data) {
  return await prisma.adminUser.update({
    where: { id },
    data,
  });
}

module.exports = {
  findAdminByEmail,
  updateAdmin,
};