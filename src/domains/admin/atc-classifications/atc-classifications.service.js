/**
 * ATC CLASSIFICATIONS SERVICE
 * 
 * Generic business logic for all ATC classification entities
 */

const atcRepository = require('./atc-classifications.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

// Entity name mapping for error messages
const ENTITY_NAMES = {
  anatomical: 'Anatomical class',
  therapeutic: 'Therapeutic class',
  pharmacological: 'Pharmacological class',
  chemical: 'Chemical class',
  chemicalSubstance: 'Chemical substance',
};

const PARENT_NAMES = {
  therapeutic: 'anatomical class',
  pharmacological: 'therapeutic class',
  chemical: 'pharmacological class',
  chemicalSubstance: 'chemical class',
};

/**
 * Generic get classifications with pagination
 */
async function getClassifications(entityType, { page = 1, limit = 20, name, parentId }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = {};
  
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (parentId) where.parentId = Number(parentId);

  const [items, total] = await atcRepository.findClassifications(entityType, {
    skip,
    limit: take,
    where,
  });

  return {
    items,
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) }
  };
}

/**
 * Generic get single classification by ID
 */
async function getClassification(entityType, id) {
  const item = await atcRepository.findClassificationById(entityType, id);
  
  if (!item) {
    const error = new Error(`${ENTITY_NAMES[entityType]} not found`);
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }
  
  return item;
}

/**
 * Generic create classification
 */
async function createClassification(entityType, data) {
  try {
    return await atcRepository.createClassification(entityType, data);
  } catch (error) {
    if (error.code === 'P2002') {
      const err = new Error('ATC code already exists');
      err.status = HTTP_STATUS.BAD_REQUEST;
      err.code = ERROR_CODES.VALIDATION_ERROR;
      throw err;
    }
    if (error.code === 'P2003') {
      const err = new Error(`Invalid parent ${PARENT_NAMES[entityType]}`);
      err.status = HTTP_STATUS.BAD_REQUEST;
      err.code = ERROR_CODES.VALIDATION_ERROR;
      throw err;
    }
    throw error;
  }
}

/**
 * Generic update classification
 */
async function updateClassification(entityType, id, data) {
  try {
    return await atcRepository.updateClassification(entityType, id, data);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error(`${ENTITY_NAMES[entityType]} not found`);
      err.status = HTTP_STATUS.NOT_FOUND;
      err.code = ERROR_CODES.NOT_FOUND;
      throw err;
    }
    if (error.code === 'P2002') {
      const err = new Error('ATC code already exists');
      err.status = HTTP_STATUS.BAD_REQUEST;
      err.code = ERROR_CODES.VALIDATION_ERROR;
      throw err;
    }
    if (error.code === 'P2003') {
      const err = new Error(`Invalid parent ${PARENT_NAMES[entityType]}`);
      err.status = HTTP_STATUS.BAD_REQUEST;
      err.code = ERROR_CODES.VALIDATION_ERROR;
      throw err;
    }
    throw error;
  }
}

/**
 * Generic delete classification
 */
async function deleteClassification(entityType, id) {
  try {
    await atcRepository.deleteClassification(entityType, id);
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error(`${ENTITY_NAMES[entityType]} not found`);
      err.status = HTTP_STATUS.NOT_FOUND;
      err.code = ERROR_CODES.NOT_FOUND;
      throw err;
    }
    throw error;
  }
}

/**
 * Get children by parent ID
 */
async function getChildrenByParent(childEntityType, parentId) {
  return await atcRepository.findChildrenByParent(childEntityType, parentId);
}

// ==================== SPECIFIC ENTITY FUNCTIONS ====================

// Anatomical Classes
const getAnatomicalClasses = (query) => getClassifications('anatomical', query);
const getAnatomicalClass = (id) => getClassification('anatomical', id);
const createAnatomicalClass = (data) => createClassification('anatomical', data);
const updateAnatomicalClass = (id, data) => updateClassification('anatomical', id, data);
const deleteAnatomicalClass = (id) => deleteClassification('anatomical', id);
const getTherapeuticClassesByAnatomical = (parentId) => getChildrenByParent('therapeutic', parentId);

// Therapeutic Classes
const getTherapeuticClasses = (query) => getClassifications('therapeutic', query);
const getTherapeuticClass = (id) => getClassification('therapeutic', id);
const createTherapeuticClass = (data) => createClassification('therapeutic', data);
const updateTherapeuticClass = (id, data) => updateClassification('therapeutic', id, data);
const deleteTherapeuticClass = (id) => deleteClassification('therapeutic', id);
const getPharmacologicalClassesByTherapeutic = (parentId) => getChildrenByParent('pharmacological', parentId);

// Pharmacological Classes
const getPharmacologicalClasses = (query) => getClassifications('pharmacological', query);
const getPharmacologicalClass = (id) => getClassification('pharmacological', id);
const createPharmacologicalClass = (data) => createClassification('pharmacological', data);
const updatePharmacologicalClass = (id, data) => updateClassification('pharmacological', id, data);
const deletePharmacologicalClass = (id) => deleteClassification('pharmacological', id);
const getChemicalClassesByPharmacological = (parentId) => getChildrenByParent('chemical', parentId);

// Chemical Classes
const getChemicalClasses = (query) => getClassifications('chemical', query);
const getChemicalClass = (id) => getClassification('chemical', id);
const createChemicalClass = (data) => createClassification('chemical', data);
const updateChemicalClass = (id, data) => updateClassification('chemical', id, data);
const deleteChemicalClass = (id) => deleteClassification('chemical', id);
const getChemicalSubstancesByChemical = (parentId) => getChildrenByParent('chemicalSubstance', parentId);

// Chemical Substances
const getChemicalSubstances = (query) => getClassifications('chemicalSubstance', query);
const getChemicalSubstance = (id) => getClassification('chemicalSubstance', id);
const createChemicalSubstance = (data) => createClassification('chemicalSubstance', data);
const updateChemicalSubstance = (id, data) => updateClassification('chemicalSubstance', id, data);
const deleteChemicalSubstance = (id) => deleteClassification('chemicalSubstance', id);

module.exports = {
  // Anatomical
  getAnatomicalClasses,
  getAnatomicalClass,
  createAnatomicalClass,
  updateAnatomicalClass,
  deleteAnatomicalClass,
  getTherapeuticClassesByAnatomical,
  
  // Therapeutic
  getTherapeuticClasses,
  getTherapeuticClass,
  createTherapeuticClass,
  updateTherapeuticClass,
  deleteTherapeuticClass,
  getPharmacologicalClassesByTherapeutic,
  
  // Pharmacological
  getPharmacologicalClasses,
  getPharmacologicalClass,
  createPharmacologicalClass,
  updatePharmacologicalClass,
  deletePharmacologicalClass,
  getChemicalClassesByPharmacological,
  
  // Chemical
  getChemicalClasses,
  getChemicalClass,
  createChemicalClass,
  updateChemicalClass,
  deleteChemicalClass,
  getChemicalSubstancesByChemical,
  
  // Chemical Substances
  getChemicalSubstances,
  getChemicalSubstance,
  createChemicalSubstance,
  updateChemicalSubstance,
  deleteChemicalSubstance,
};