/**
 * PHARMACY SALES SERVICE
 * 
 * Business logic for pharmacy POS sales operations
 */

const repository = require('./pharmacy-sales.repository');

/**
 * Record a POS sale
 */
async function recordSale({ pharmacyId, items, total, paymentMethod }) {
  // Decrement stock for each item
  await Promise.all(items.map(async (item) => {
    const { medicationId, quantity } = item;
    const medAvail = await repository.findMedicationInInventory(medicationId, pharmacyId);
    
    if (!medAvail) {
      throw new Error(`Medication ${medicationId} not found in pharmacy inventory`);
    }
    
    if (medAvail.stock < quantity) {
      throw new Error(`Insufficient stock for medication ${medicationId}`);
    }
    
    await repository.decrementStock(medicationId, pharmacyId, quantity);
  }));
  
  // Create the sale
  const sale = await repository.createSale({
    pharmacyId,
    items,
    total,
    paymentMethod,
  });
  
  return sale;
}

/**
 * Fetch sales with filters
 */
async function fetchSales(pharmacyId, filters) {
  const { date, startDate, endDate, paymentMethod, minAmount, maxAmount } = filters;
  
  let where = { pharmacyId };
  
  // Date filtering
  if (date) {
    const start = new Date(date + 'T00:00:00.000Z');
    const end = new Date(date + 'T23:59:59.999Z');
    where.createdAt = { gte: start, lte: end };
  } else if (startDate && endDate) {
    where.createdAt = {
      gte: new Date(startDate + 'T00:00:00.000Z'),
      lte: new Date(endDate + 'T23:59:59.999Z')
    };
  }
  
  // Payment method
  if (paymentMethod) {
    where.paymentMethod = paymentMethod;
  }
  
  // Amount range
  if (minAmount || maxAmount) {
    where.total = {};
    if (minAmount) where.total.gte = parseFloat(minAmount);
    if (maxAmount) where.total.lte = parseFloat(maxAmount);
  }
  
  const sales = await repository.findSales(where);
  
  return sales;
}

module.exports = {
  recordSale,
  fetchSales,
};