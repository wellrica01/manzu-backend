/**
 * MEDICATION INGREDIENTS SERVICE
 * 
 * Business logic for medication ingredient operations
 */

const medicationIngredientsRepository = require('./medication-ingredients.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

/**
 * Get medication ingredients with pagination and filtering
 */
async function getMedicationIngredients({ page = 1, limit = 20, substanceId }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = {};
  
  if (substanceId) where.substanceId = Number(substanceId);

  const [medicationIngredients, total] = await medicationIngredientsRepository.findMedicationIngredients({
    skip,
    limit: take,
    where,
  });

  return {
    medicationIngredients,
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) }
  };
}

/**
 * Get single medication ingredient by ID
 */
async function getMedicationIngredient(id) {
  const medicationIngredient = await medicationIngredientsRepository.findMedicationIngredientById(id);

  if (!medicationIngredient) {
    const error = new Error('Medication ingredient not found');
    error.status = HTTP_STATUS?.NOT_FOUND || 404;
    error.code = ERROR_CODES?.NOT_FOUND;
    throw error;
  }

  return medicationIngredient;
}

/**
 * Create medication ingredient
 */
async function createMedicationIngredient(data) {
  try {
    return await medicationIngredientsRepository.createMedicationIngredient(data);
  } catch (error) {
    if (error.code === 'P2003') {
      const err = new Error('Invalid medication or substance ID');
      err.status = HTTP_STATUS?.BAD_REQUEST || 400;
      err.code = ERROR_CODES?.VALIDATION_ERROR;
      throw err;
    }
    throw error;
  }
}

/**
 * Update medication ingredient
 */
async function updateMedicationIngredient(id, data) {
  try {
    return await medicationIngredientsRepository.updateMedicationIngredient(id, data);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Medication ingredient not found');
      err.status = HTTP_STATUS?.NOT_FOUND || 404;
      err.code = ERROR_CODES?.NOT_FOUND;
      throw err;
    }
    if (error.code === 'P2003') {
      const err = new Error('Invalid medication or substance ID');
      err.status = HTTP_STATUS?.BAD_REQUEST || 400;
      err.code = ERROR_CODES?.VALIDATION_ERROR;
      throw err;
    }
    throw error;
  }
}

/**
 * Delete medication ingredient
 */
async function deleteMedicationIngredient(id) {
  try {
    await medicationIngredientsRepository.deleteMedicationIngredient(id);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Medication ingredient not found');
      err.status = HTTP_STATUS?.NOT_FOUND || 404;
      err.code = ERROR_CODES?.NOT_FOUND;
      throw err;
    }
    throw error;
  }
}

/**
 * Search medication ingredients
 */
async function searchMedicationIngredients({ search, limit = 20 }) {
  return await medicationIngredientsRepository.searchMedicationIngredients({ search, limit });
}

module.exports = {
  getMedicationIngredients,
  getMedicationIngredient,
  createMedicationIngredient,
  updateMedicationIngredient,
  deleteMedicationIngredient,
  searchMedicationIngredients,
};