/**
 * INDICATIONS SERVICE
 * 
 * Business logic for indication operations
 */

const indicationsRepository = require('./indications.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

/**
 * Get indications with pagination and filtering
 */
async function getIndications({ page = 1, limit = 20, genericMedicationId }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = genericMedicationId ? { genericMedicationId: Number(genericMedicationId) } : {};

  const [indications, total] = await indicationsRepository.findIndications({
    skip,
    limit: take,
    where,
  });

  return {
    indications,
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) }
  };
}

/**
 * Get single indication by ID
 */
async function getIndication(id) {
  const indication = await indicationsRepository.findIndicationById(id);

  if (!indication) {
    const error = new Error('Indication not found');
    error.status = HTTP_STATUS?.NOT_FOUND || 404;
    error.code = ERROR_CODES?.NOT_FOUND;
    throw error;
  }

  return indication;
}

/**
 * Create indication
 */
async function createIndication(data) {
  return await indicationsRepository.createIndication(data);
}

/**
 * Update indication
 */
async function updateIndication(id, data) {
  try {
    return await indicationsRepository.updateIndication(id, data);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Indication not found');
      err.status = HTTP_STATUS?.NOT_FOUND || 404;
      err.code = ERROR_CODES?.NOT_FOUND;
      throw err;
    }
    throw error;
  }
}

/**
 * Delete indication
 */
async function deleteIndication(id) {
  try {
    await indicationsRepository.deleteIndication(id);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Indication not found');
      err.status = HTTP_STATUS?.NOT_FOUND || 404;
      err.code = ERROR_CODES?.NOT_FOUND;
      throw err;
    }
    throw error;
  }
}

module.exports = {
  getIndications,
  getIndication,
  createIndication,
  updateIndication,
  deleteIndication,
};