/**
 * PHARMACY SALES REPOSITORY
 * 
 * Database access layer for pharmacy POS sales operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find medication in inventory
 */
async function findMedicationInInventory(medicationId, pharmacyId) {
  return await prisma.medicationAvailability.findUnique({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
  });
}

/**
 * Decrement medication stock
 */
async function decrementStock(medicationId, pharmacyId, quantity) {
  return await prisma.medicationAvailability.update({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
    data: { stock: { decrement: quantity } },
  });
}

/**
 * Create sale record
 */
async function createSale(data) {
  return await prisma.sale.create({
    data,
  });
}

/**
 * Find sales with filters
 */
async function findSales(where) {
  return await prisma.sale.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = {
  findMedicationInInventory,
  decrementStock,
  createSale,
  findSales,
};