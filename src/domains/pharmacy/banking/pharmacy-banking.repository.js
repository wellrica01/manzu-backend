/**
 * PHARMACY BANKING REPOSITORY
 * 
 * Database access layer for pharmacy banking operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find pharmacy with banking details
 */
async function findPharmacyBanking(pharmacyId) {
  return await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: {
      id: true,
      name: true,
      bankAccountNumber: true,
      bankCode: true,
      bankName: true,
      accountName: true,
      recipientCode: true,
    },
  });
}

/**
 * Update pharmacy banking details
 */
async function updatePharmacyBanking(pharmacyId, data, tx = null) {
  const client = tx || prisma;
  
  return await client.pharmacy.update({
    where: { id: pharmacyId },
    data: {
      bankAccountNumber: data.accountNumber,
      bankCode: data.bankCode,
      bankName: data.bankName,
      accountName: data.accountName,
      recipientCode: data.recipientCode,
    },
  });
}

/**
 * Check if pharmacy has banking setup
 */
async function hasBankingSetup(pharmacyId) {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: { recipientCode: true },
  });
  
  return !!pharmacy?.recipientCode;
}

/**
 * Get pharmacies without banking setup
 */
async function getPharmaciesWithoutBanking() {
  return await prisma.pharmacy.findMany({
    where: {
      recipientCode: null,
      status: 'VERIFIED',
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
    },
  });
}

module.exports = {
  findPharmacyBanking,
  updatePharmacyBanking,
  hasBankingSetup,
  getPharmaciesWithoutBanking,
};