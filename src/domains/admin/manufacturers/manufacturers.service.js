/**
 * MANUFACTURERS SERVICE
 * 
 * Business logic for manufacturer operations
 */

const manufacturersRepository = require('./manufacturers.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

/**
 * Get manufacturers with pagination and filtering
 */
async function getManufacturers({ page = 1, limit = 20, name }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = name ? { name: { contains: name, mode: 'insensitive' } } : {};

  const [manufacturers, total] = await manufacturersRepository.findManufacturers({
    skip,
    limit: take,
    where,
  });

  return {
    manufacturers,
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) }
  };
}

/**
 * Get single manufacturer by ID
 */
async function getManufacturer(id) {
  const manufacturer = await manufacturersRepository.findManufacturerById(id);

  if (!manufacturer) {
    const error = new Error('Manufacturer not found');
    error.status = HTTP_STATUS?.NOT_FOUND || 404;
    error.code = ERROR_CODES?.NOT_FOUND;
    throw error;
  }

  return manufacturer;
}

/**
 * Create manufacturer
 */
async function createManufacturer(data) {
  return await manufacturersRepository.createManufacturer(data);
}

/**
 * Update manufacturer
 */
async function updateManufacturer(id, data) {
  try {
    return await manufacturersRepository.updateManufacturer(id, data);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Manufacturer not found');
      err.status = HTTP_STATUS?.NOT_FOUND || 404;
      err.code = ERROR_CODES?.NOT_FOUND;
      throw err;
    }
    throw error;
  }
}

/**
 * Delete manufacturer
 */
async function deleteManufacturer(id) {
  try {
    await manufacturersRepository.deleteManufacturer(id);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Manufacturer not found');
      err.status = HTTP_STATUS?.NOT_FOUND || 404;
      err.code = ERROR_CODES?.NOT_FOUND;
      throw err;
    }
    throw error;
  }
}

/**
 * Search manufacturers
 */
async function searchManufacturers({ search, limit = 20 }) {
  return await manufacturersRepository.searchManufacturers({ search, limit });
}

module.exports = {
  getManufacturers,
  getManufacturer,
  createManufacturer,
  updateManufacturer,
  deleteManufacturer,
  searchManufacturers,
};