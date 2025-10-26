/**
 * PHARMACY USERS REPOSITORY
 * 
 * Database access layer for pharmacy users/staff operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find all users for a pharmacy
 */
async function findPharmacyUsers(pharmacyId) {
  return await prisma.pharmacyUser.findMany({
    where: { pharmacyId },
    select: { id: true, name: true, email: true, role: true },
  });
}

module.exports = {
  findPharmacyUsers,
};