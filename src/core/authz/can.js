// src/core/authz/can.js
// can(actor, capability, resource?) -> boolean. Doc 1 S4.1.
// Pure: no Express, no Prisma, no logging. Callers decide what to do.
//
// Actor shape (Doc 1 S3.1, from FND-01 actor-context):
//   { type, id, pharmacyId, role, sessionId, deviceId, ip, userAgent, label }
//
// Resource shape: free-form object; this module knows only the checks that
// live in code for v1. Anything not covered falls through to "true" only when
// the actor already holds the capability - i.e. resource conditions can
// only narrow, never widen.
//
// Doc 1 S4.1: "Per-user overrides stored in the database are v2. can()
// already takes the actor and resource, so callers will not change."
// Doc 1 S4.1: "Actor types never mix. A pharmacy_user can never hold an
// admin.* capability."

const { roleHasCapability, knownCapability } = require('./capabilities');

const ADMIN_CAPABILITY_PREFIX = 'admin.';

function isPharmacyActor(actor) {
  return Boolean(actor && actor.type === 'pharmacy_user');
}

function isAdminActor(actor) {
  return Boolean(actor && actor.type === 'admin');
}

// Resource checks specific to the pharmacy domain. Each function returns:
//   - true  -> pass
//   - false -> fail with FORBIDDEN_CAPABILITY at the caller
// A capability with no entry in RESOURCE_CHECKS is allowed once the actor
// holds the capability itself.
const RESOURCE_CHECKS = {
  // Any capability that names an order: the order must belong to the actor's
  // pharmacy. Cross-pharmacy access is 404, not 403 (Doc 1 S7.3
  // tenant-scope test); can() returns false and the caller maps it.
  'orders.view': (actor, res) => samePharmacy(actor, res),
  'orders.accept': (actor, res) => samePharmacy(actor, res),
  'orders.reject': (actor, res) => samePharmacy(actor, res),
  'orders.cancel': (actor, res) => samePharmacy(actor, res),

  // Inventory writes are pharmacy-scoped.
  'inventory.edit': (actor, res) => samePharmacy(actor, res),
  'inventory.delete': (actor, res) => samePharmacy(actor, res),
  'inventory.price.edit': (actor, res) => samePharmacy(actor, res),
  'inventory.stock.adjust': (actor, res) => samePharmacy(actor, res),

  // Banking is manager-only and pharmacy-scoped.
  'banking.manage': (actor, res) => samePharmacy(actor, res),
  'banking.verify': (actor, res) => samePharmacy(actor, res),

  // Team management cannot target the actor themselves, and cannot target
  // a different pharmacy. (Doc 2 owns the self-target rule; can() encodes
  // the pharmacy scope now so the route cannot accidentally cross tenants.)
  'team.manage': (actor, res) => samePharmacy(actor, res),
};

function samePharmacy(actor, res) {
  if (!res || res.pharmacyId == null) return true;
  return actor && actor.pharmacyId != null && Number(actor.pharmacyId) === Number(res.pharmacyId);
}

// Main entry point.
// Returns false for anything it cannot positively affirm. Never throws.
function can(actor, capability, resource) {
  if (!actor || !capability || typeof capability !== 'string') return false;
  if (!knownCapability(capability) && !capability.startsWith(ADMIN_CAPABILITY_PREFIX)) {
    return false;
  }

  // Actor types never mix. A pharmacy_user cannot hold admin.*, and an admin
  // cannot hold pharmacy capabilities.
  const isAdminCap = capability.startsWith(ADMIN_CAPABILITY_PREFIX);
  if (isAdminCap && !isAdminActor(actor)) return false;
  if (!isAdminCap && !isPharmacyActor(actor)) return false;

  // Admins: the grants table is Doc 3's job. For v1, an admin actor resolves
  // admin.* capabilities from ROLE_CAPABILITIES in the admin module. Since
  // the pharmacy module does not seed admin capabilities, deny here.
  if (isAdminCap) return false;

  // Pharmacy: capability must be granted to the role, and any resource
  // check must pass.
  if (!roleHasCapability(actor.role, capability)) return false;

  const check = RESOURCE_CHECKS[capability];
  if (check && !check(actor, resource)) return false;

  return true;
}

module.exports = { can };