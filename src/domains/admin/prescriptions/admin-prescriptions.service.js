/**
 * ADMIN PRESCRIPTIONS SERVICE
 * 
 * Business logic for admin prescription management
 */

const prescriptionsRepository = require('./admin-prescriptions.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

/**
 * Get prescriptions with filters and pagination
 */
async function getPrescriptions({ page, limit, status, userIdentifier }) {
  const skip = (page - 1) * limit;
  const where = {};
  
  if (status) where.status = status.toUpperCase();
  if (userIdentifier) {
    where.userIdentifier = { contains: userIdentifier, mode: 'insensitive' };
  }

  const [prescriptions, total] = await prescriptionsRepository.findPrescriptions({
    skip,
    limit,
    where,
  });

  console.log('Prescriptions fetched:', { count: prescriptions.length, total });

  return {
    prescriptions,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get single prescription by ID
 */
async function getPrescription(id) {
  const prescription = await prescriptionsRepository.findPrescriptionById(id);
  
  if (!prescription) {
    const error = new Error('Prescription not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }
  
  console.log('Prescription fetched:', { prescriptionId: id });
  return prescription;
}

module.exports = {
  getPrescriptions,
  getPrescription,
};