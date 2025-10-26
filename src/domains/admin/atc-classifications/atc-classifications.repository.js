/**
 * ATC CLASSIFICATIONS REPOSITORY
 * 
 * Generic database access layer for all ATC classification entities
 */

const prisma = require('../../../core/database/prisma');

// Entity type mapping
const ENTITY_MODELS = {
  anatomical: 'anatomicalClass',
  therapeutic: 'therapeuticClass',
  pharmacological: 'pharmacologicalClass',
  chemical: 'chemicalClass',
  chemicalSubstance: 'chemicalSubstance',
};

/**
 * Generic find with pagination
 */
async function findClassifications(entityType, { skip, limit, where }) {
  const model = prisma[ENTITY_MODELS[entityType]];
  
  return await prisma.$transaction([
    model.findMany({
      where,
      take: limit,
      skip,
      ...(entityType !== 'anatomical' && {
        include: getIncludeForEntity(entityType)
      }),
      orderBy: { name: 'asc' }
    }),
    model.count({ where }),
  ]);
}

/**
 * Generic find by ID
 */
async function findClassificationById(entityType, id) {
  const model = prisma[ENTITY_MODELS[entityType]];
  
  return await model.findUnique({
    where: { id },
    ...(entityType !== 'anatomical' && {
      include: getIncludeForEntity(entityType, true)
    }),
  });
}

/**
 * Generic create
 */
async function createClassification(entityType, data) {
  const model = prisma[ENTITY_MODELS[entityType]];
  return await model.create({ data });
}

/**
 * Generic update
 */
async function updateClassification(entityType, id, data) {
  const model = prisma[ENTITY_MODELS[entityType]];
  return await model.update({ where: { id }, data });
}

/**
 * Generic delete
 */
async function deleteClassification(entityType, id) {
  const model = prisma[ENTITY_MODELS[entityType]];
  return await model.delete({ where: { id } });
}

/**
 * Get children by parent ID
 */
async function findChildrenByParent(childEntityType, parentId) {
  const model = prisma[ENTITY_MODELS[childEntityType]];
  return await model.findMany({
    where: { parentId },
    orderBy: { name: 'asc' }
  });
}

/**
 * Helper: Get include config for entity type
 */
function getIncludeForEntity(entityType, includeChildren = false) {
  const includes = {
    therapeutic: {
      AnatomicalClass: { select: { id: true, name: true, atcCode: true } },
      ...(includeChildren && {
        PharmacologicalClass: { select: { id: true, name: true, atcCode: true } }
      })
    },
    pharmacological: {
      TherapeuticClass: { select: { id: true, name: true, atcCode: true } },
      ...(includeChildren && {
        ChemicalClass: { select: { id: true, name: true, atcCode: true } }
      })
    },
    chemical: {
      PharmacologicalClass: { select: { id: true, name: true, atcCode: true } },
      ...(includeChildren && {
        ChemicalSubstance: { select: { id: true, name: true, atcCode: true } }
      })
    },
    chemicalSubstance: {
      ChemicalClass: { select: { id: true, name: true, atcCode: true } }
    },
  };
  
  return includes[entityType] || {};
}

module.exports = {
  findClassifications,
  findClassificationById,
  createClassification,
  updateClassification,
  deleteClassification,
  findChildrenByParent,
};