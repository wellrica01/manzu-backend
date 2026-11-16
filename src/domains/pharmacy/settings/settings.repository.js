// src/domains/pharmacy/settings/settings.repository.js
// P-06.6d: Prisma access for PharmacySetting. One row per pharmacy.

const prisma = require('../../../core/database/prisma');

/**
 * Find the settings row for a pharmacy. Returns null if no row has been
 * created yet - the service substitutes defaults in that case.
 */
async function findByPharmacyId(pharmacyId) {
  return prisma.pharmacySetting.findUnique({
    where: { pharmacyId },
  });
}

/**
 * Upsert the settings row. `patch` may contain any subset of the writable
 * fields; on create, schema defaults fill the rest.
 */
async function upsert(pharmacyId, patch, actorUserId, tx = null) {
  const client = tx || prisma;
  const data = { ...patch, updatedById: actorUserId, updatedAt: new Date() };
  return client.pharmacySetting.upsert({
    where: { pharmacyId },
    create: { pharmacyId, ...data },
    update: data,
  });
}

module.exports = { findByPharmacyId, upsert };