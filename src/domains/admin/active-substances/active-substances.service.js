/**
 * ACTIVE SUBSTANCES SERVICE
 * 
 * Business logic for active substance operations
 */

const activeSubstancesRepository = require('./active-substances.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

/**
 * Get active substances with pagination and filtering
 */
async function getActiveSubstances({ page = 1, limit = 20, name, type, genericId }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = {};
  
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (type) where.type = type;
  if (genericId) where.genericId = Number(genericId);

  const [activeSubstances, total] = await activeSubstancesRepository.findActiveSubstances({
    skip,
    limit: take,
    where,
  });

  return {
    activeSubstances,
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) }
  };
}

/**
 * Get single active substance by ID
 */
async function getActiveSubstance(id) {
  const activeSubstance = await activeSubstancesRepository.findActiveSubstanceById(id);

  if (!activeSubstance) {
    const error = new Error('Active substance not found');
    error.status = HTTP_STATUS?.NOT_FOUND || 404;
    error.code = ERROR_CODES?.NOT_FOUND;
    throw error;
  }

  return activeSubstance;
}

/**
 * Create active substance
 */
async function createActiveSubstance(data) {
  try {
    return await activeSubstancesRepository.createActiveSubstance(data);
  } catch (error) {
    if (error.code === 'P2003') {
      const err = new Error('Invalid generic name ID');
      err.status = HTTP_STATUS?.BAD_REQUEST || 400;
      err.code = ERROR_CODES?.VALIDATION_ERROR;
      throw err;
    }
    throw error;
  }
}

/**
 * Update active substance
 */
async function updateActiveSubstance(id, data) {
  try {
    return await activeSubstancesRepository.updateActiveSubstance(id, data);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Active substance not found');
      err.status = HTTP_STATUS?.NOT_FOUND || 404;
      err.code = ERROR_CODES?.NOT_FOUND;
      throw err;
    }
    if (error.code === 'P2003') {
      const err = new Error('Invalid generic name ID');
      err.status = HTTP_STATUS?.BAD_REQUEST || 400;
      err.code = ERROR_CODES?.VALIDATION_ERROR;
      throw err;
    }
    throw error;
  }
}

/**
 * Delete active substance
 */
async function deleteActiveSubstance(id) {
  try {
    await activeSubstancesRepository.deleteActiveSubstance(id);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Active substance not found');
      err.status = HTTP_STATUS?.NOT_FOUND || 404;
      err.code = ERROR_CODES?.NOT_FOUND;
      throw err;
    }
    throw error;
  }
}

/**
 * Search active substances
 */
async function searchActiveSubstances({ search, limit = 20 }) {
  return await activeSubstancesRepository.searchActiveSubstances({ search, limit });
}

module.exports = {
  getActiveSubstances,
  getActiveSubstance,
  createActiveSubstance,
  updateActiveSubstance,
  deleteActiveSubstance,
  searchActiveSubstances,
};