// src/core/database/prisma-scoped.js
//
// FND-11b. Wraps the raw Prisma client (core/database/prisma.js) with a
// $extends layer that can enforce per-pharmacy scoping on tenant models.
//
// Opt-in. Nothing imports this module yet. core/database/prisma.js is the raw
// client and stays that way. Doc 2 (P-02) will switch services to this
// module one at a time as it rolls out tenant scoping, so today this file is
// inert: PRISMA_SCOPE_MODE defaults to 'off', in which case the extension
// simply calls query(args) unchanged.
//
// Modes (PRISMA_SCOPE_MODE):
//   off      - pass-through (the extension is loaded but does nothing).
//   log      - tenant model + tenant op without a pharmacyId in where: warn.
//   enforce  - reserved for Doc 2 P-02; the injection path exists but refuses
//              to run outside a pharmacy actor so a missing scope is loud.

const raw = require('./prisma');

const TENANT_MODELS = new Set([
  'MedicationAvailability',
  'Order',
  'OperatingHour',
  'Payout',
  'PharmacyUser',
  'PushToken',
  'Sale',
]);

const TENANT_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'count',
  'aggregate',
  'updateMany',
  'deleteMany',
]);

function scopeMode() {
  return String(process.env.PRISMA_SCOPE_MODE || 'off').toLowerCase();
}

function currentRequestIdSafe() {
  try {
    const { currentRequestId } = require('../context/actor-context');
    return currentRequestId() || null;
  } catch (_) {
    return null;
  }
}

function currentActorPharmacyIdSafe() {
  try {
    const { currentActor } = require('../context/actor-context');
    const actor = currentActor();
    return actor && actor.type === 'pharmacy_user' ? actor.pharmacyId : null;
  } catch (_) {
    return null;
  }
}

function buildExtension() {
  return raw.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const mode = scopeMode();
          if (mode === 'off') return query(args);

          const isTenantModel = TENANT_MODELS.has(model);
          const isTenantOp = TENANT_OPERATIONS.has(operation);

          if (isTenantModel && isTenantOp) {
            const where = (args && args.where) || null;
            const hasPharmacyId = Boolean(where && Object.prototype.hasOwnProperty.call(where, 'pharmacyId'));

            if (!hasPharmacyId) {
              if (mode === 'log') {
                const requestId = currentRequestIdSafe();
                console.warn('[prisma-scope] tenant query without pharmacyId', {
                  model,
                  operation,
                  requestId,
                });
                return query(args);
              }
              if (mode === 'enforce') {
                const pharmacyId = currentActorPharmacyIdSafe();
                if (pharmacyId != null) {
                  args = { ...(args || {}), where: { ...(where || {}), pharmacyId } };
                  return query(args);
                }
                throw new Error(
                  `prisma-scope: PRISMA_SCOPE_MODE=enforce but no pharmacy actor for ${model}.${operation}`
                );
              }
            }
          }

          return query(args);
        },
      },
    },
  });
}

const scoped = buildExtension();

// Attach the test hooks as a property on the extended client so we do not
// break the client export. Anything importing prisma-scoped gets the extended
// client with an extra _testHooks field.
scoped._testHooks = {
  buildExtension,
  TENANT_MODELS,
  TENANT_OPERATIONS,
  scopeMode,
};

module.exports = scoped;