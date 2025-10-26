/**
 * GENERIC NAMES SERVICE
 * 
 * Business logic for generic name operations
 */

const genericNamesRepository = require('./generic-names.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

/**
 * Get generic names with pagination
 */
async function getGenericNames({ page = 1, limit = 20, name }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = {};

  if (name) where.name = { contains: name, mode: 'insensitive' };

  const [genericNames, total] = await genericNamesRepository.findGenericNames({
    skip,
    limit: take,
    where,
  });

  return {
    genericNames,
    pagination: {
      page: Number(page),
      limit: take,
      total,
      pages: Math.ceil(total / take),
    },
  };
}

/**
 * Get single generic name by ID
 */
async function getGenericName(id) {
  const genericName = await genericNamesRepository.findGenericNameById(id);

  if (!genericName) {
    const error = new Error('Generic name not found');
    error.status = HTTP_STATUS?.NOT_FOUND || 404;
    error.code = ERROR_CODES?.NOT_FOUND;
    throw error;
  }

  return genericName;
}

/**
 * Create generic name
 */
async function createGenericName(data) {
  try {
    return await genericNamesRepository.createGenericName(data);
  } catch (error) {
    if (error.code === 'P2002') {
      const err = new Error('Generic name must be unique');
      err.status = HTTP_STATUS?.BAD_REQUEST || 400;
      err.code = ERROR_CODES?.VALIDATION_ERROR;
      throw err;
    }
    throw error;
  }
}

/**
 * Update generic name
 */
async function updateGenericName(id, data) {
  try {
    return await genericNamesRepository.updateGenericName(id, data);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Generic name not found');
      err.status = HTTP_STATUS?.NOT_FOUND || 404;
      err.code = ERROR_CODES?.NOT_FOUND;
      throw err;
    }
    if (error.code === 'P2002') {
      const err = new Error('Generic name must be unique');
      err.status = HTTP_STATUS?.BAD_REQUEST || 400;
      err.code = ERROR_CODES?.VALIDATION_ERROR;
      throw err;
    }
    throw error;
  }
}

/**
 * Delete generic name
 */
async function deleteGenericName(id) {
  try {
    await genericNamesRepository.deleteGenericName(id);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Generic name not found');
      err.status = HTTP_STATUS?.NOT_FOUND || 404;
      err.code = ERROR_CODES?.NOT_FOUND;
      throw err;
    }
    throw error;
  }
}

module.exports = {
  getGenericNames,
  getGenericName,
  createGenericName,
  updateGenericName,
  deleteGenericName,
};