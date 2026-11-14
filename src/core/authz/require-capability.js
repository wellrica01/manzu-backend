// src/core/authz/require-capability.js
// requireCapability(capability, opts) - returns middleware tagged with a
// policy. Doc 1 S4.2.
//
// Env:
//   SEC_ENFORCE         'off' | 'log' | 'enforce' (default 'off')
//   SEC_ENFORCE_GROUPS  'inventory:enforce,sales:log' (group = capability
//                       prefix before the first dot). Overrides SEC_ENFORCE
//                       per group.
//
// Modes:
//   off      - no checks, no events (used before the module is wired to routes)
//   log      - runs can(); on deny, writes security.capability.denied with
//              mode:'shadow' and lets the request through (shadow mode)
//   enforce  - runs can(); on deny, writes the event with mode:'enforce',
//              then returns 403 FORBIDDEN_CAPABILITY
//
// Actor resolution (transitional, until FND-05 wires the context):
//   1. currentActor() from AsyncLocalStorage
//   2. req.user in the legacy JWT shape -> synthesized actor
//   3. deny
// The fallback goes through the same can() checks, so deny-by-default holds
// on the fallback path too.

const { can } = require('./can');
const { currentActor } = require('../context/actor-context');
const { sendError } = require('../errors/send-error');
const security = require('../audit/security-event');

function modeFor(capability) {
  const top = (process.env.SEC_ENFORCE || 'off').toLowerCase();
  const groups = process.env.SEC_ENFORCE_GROUPS || '';
  const group = String(capability).split('.')[0];
  for (const pair of groups.split(',')) {
    const [g, m] = pair.split(':').map((s) => s && s.trim().toLowerCase());
    if (g && m && g === group) return m;
  }
  return top;
}

function actorFromRequest(req) {
  const ctx = currentActor();
  if (ctx) return ctx;
  if (req && req.user) {
    if (req.user.userId != null && req.user.pharmacyId != null) {
      return {
        type: 'pharmacy_user',
        id: req.user.userId,
        pharmacyId: req.user.pharmacyId,
        role: req.user.role,
        sessionId: req.user.sid || null,
      };
    }
    if (req.user.adminId != null) {
      return {
        type: 'admin',
        id: req.user.adminId,
        role: req.user.role,
        sessionId: req.user.sid || null,
      };
    }
  }
  return null;
}

function requireCapability(capability, opts) {
  if (!capability || typeof capability !== 'string') {
    throw new TypeError('requireCapability(capability, opts): capability is required');
  }
  const options = opts || {};
  const tier = options.tier || 'T0';
  const rate = options.rate || 'read';
  const resourceOf = typeof options.resource === 'function' ? options.resource : null;

  const middleware = async function requireCapabilityMiddleware(req, res, next) {
    const mode = modeFor(capability);
    if (mode === 'off') return next();

    const actor = actorFromRequest(req);
    const resource = resourceOf ? resourceOf(req) : undefined;
    const allowed = actor ? can(actor, capability, resource) : false;

    if (allowed) return next();

    // Deny: record, then either log-and-continue or send 403.
    try {
      await security.record(require('../database/prisma'), {
        action: 'security.capability.denied',
        entityType: 'Capability',
        entityId: capability,
        severity: 'warning',
        after: { capability, mode },
      });
    } catch (_) {
      // security.record never throws; this catch is defensive only.
    }

    if (mode === 'log') {
      return next();
    }

    return sendError(res, 403, 'FORBIDDEN_CAPABILITY', undefined, { capability });
  };

  middleware.policy = Object.freeze({
    type: 'capability',
    capability,
    tier,
    rate,
    resource: resourceOf ? 'function' : null,
  });
  return middleware;
}

module.exports = { requireCapability, actorFromRequest, modeFor };