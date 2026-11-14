// src/core/authz/require-stepup.js
//
// FND-08b. requireStepUp(scope) returns middleware that verifies the
// X-Step-Up header contains a step-up token for exactly this scope, in
// exactly this session.
//
// Doc 1 S4.5. The token is issued by POST /auth/step-up (FND-08a). The
// middleware is not applied to any route yet; Doc 2 (banking) and Doc 3
// (admin actions) apply it where they need a fresh PIN.
//
// Env:
//   SEC_STEPUP_ENFORCE  'off' | 'log' | 'enforce'  (default 'off')
//
// Separate switch from SEC_ENFORCE on purpose: capability enforcement and
// step-up enforcement are rolled out on different schedules. Doc 2 will flip
// capability groups as it decorates routes and step-up as it decorates the
// banking writes; those two flips can happen in different deploys.
//
// Modes:
//   off      - no checks. The route behaves as if the middleware were not there.
//   log      - verifies the header, logs what would have happened on deny,
//              lets the request through. This is the observation mode.
//   enforce  - verifies, denies with the shared error contract on failure.
//
// Verification steps on the enforce / log path:
//   1. Read X-Step-Up header. Missing -> STEP_UP_REQUIRED.
//   2. Verify the token with getSecretFor('stepup'). Expired -> STEP_UP_REQUIRED.
//      Bad signature -> STEP_UP_INVALID.
//   3. Check iss = 'manzu', aud = 'stepup' (jwt.verify does this when passed).
//   4. Check token.scope === required scope. Exact string match. Mismatch ->
//      STEP_UP_INVALID.
//   5. Check token.sid === req.user.sid. STRICT: reject if either is missing
//      or if they differ. A step-up granted on device A cannot be used on
//      device B; a step-up granted in one session cannot be used in another.
//   6. If token.tier === 'T3': consume the token. The jti is stored in
//      AuthThrottle via the throttle interface, so a second use is denied
//      STEP_UP_INVALID. T2 tokens are not single-use.
//
// The policy tag makes the middleware visible to the route-policy CI test,
// but the test's check is 'has requireCapability or publicRoute'. A route
// with only requireStepUp is still treated as undeclared for that test - it
// stays in the grandfathered snapshot until Doc 2 adds the capability.
//
// Actor: read from currentActor() (FND-05b3 seeds it), with a fallback to
// req.user for tests and pre-context callers, same as require-capability.

const jwt = require('jsonwebtoken');
const { currentActor } = require('../context/actor-context');
const { getSecretFor } = require('../../utils/env-validator');
const { sendError } = require('../errors/send-error');
const security = require('../audit/security-event');
const throttle = require('../throttle');
const prisma = require('../database/prisma');

const ISSUER = 'manzu';
const AUDIENCE = 'stepup';

function mode() {
  return String(process.env.SEC_STEPUP_ENFORCE || 'off').toLowerCase();
}

function actorFromRequest(req) {
  const ctx = currentActor();
  if (ctx) return ctx;
  if (req && req.user) {
    if (req.user.userId != null) {
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

function readStepUpToken(req) {
  const raw = req.headers && req.headers['x-step-up'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  return trimmed;
}

function verifyStepUp(raw, expectedScope) {
  try {
    const decoded = jwt.verify(raw, getSecretFor('stepup'), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (decoded.scope !== expectedScope) return { ok: false, reason: 'scope_mismatch' };
    return { ok: true, decoded };
  } catch (err) {
    if (err.name === 'TokenExpiredError') return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}

async function consumeT3Jti(jti) {
  // Single-use. A second use in the TTL window is denied.
  const result = await throttle.hit({
    class: 'stepup_jti',
    key: jti,
    windowMs: 5 * 60 * 1000,
    max: 1,
    lockoutMinutes: 5,
  });
  return result.allowed;
}

function requireStepUp(scope) {
  if (!scope || typeof scope !== 'string') {
    throw new TypeError('requireStepUp(scope): scope is required');
  }

  const middleware = async function requireStepUpMiddleware(req, res, next) {
    const current = mode();
    if (current === 'off') return next();

    const raw = readStepUpToken(req);
    if (!raw) {
      if (current === 'log') {
        security.record(prisma, {
          action: 'security.stepup.denied',
          entityType: 'Auth',
          entityId: scope,
          severity: 'warning',
          after: { reason: 'missing', scope },
        }).catch(() => {});
        return next();
      }
      return sendError(res, 403, 'STEP_UP_REQUIRED', 'Please confirm your PIN to continue.');
    }

    const verified = verifyStepUp(raw, scope);
    if (!verified.ok) {
      if (current === 'log') {
        security.record(prisma, {
          action: 'security.stepup.denied',
          entityType: 'Auth',
          entityId: scope,
          severity: 'warning',
          after: { reason: verified.reason, scope },
        }).catch(() => {});
        return next();
      }
      const code = verified.reason === 'expired' || verified.reason === 'scope_mismatch'
        ? 'STEP_UP_REQUIRED'
        : 'STEP_UP_INVALID';
      return sendError(res, 403, code, 'The confirmation is no longer valid.');
    }

    const token = verified.decoded;

    // Session binding. STRICT: reject when either side is missing, even if
    // both sides being undefined would "match". A step-up token with no session
    // claim is not useful and should not be honoured.
    const actor = actorFromRequest(req);
    const actorSid = actor && actor.sessionId;
    if (!actorSid || !token.sid || actorSid !== token.sid) {
      if (current === 'log') {
        security.record(prisma, {
          action: 'security.stepup.denied',
          entityType: 'Auth',
          entityId: scope,
          severity: 'warning',
          after: { reason: 'session_mismatch', scope },
        }).catch(() => {});
        return next();
      }
      return sendError(res, 403, 'STEP_UP_INVALID', 'The confirmation is no longer valid.');
    }

    // T3 single-use. Only checked for T3; T2 tokens can be reused within
    // their 5-minute TTL, which is what the S4.5 "fresh PIN within the last
    // 5 minutes" wording intends.
    if (token.tier === 'T3') {
      const fresh = await consumeT3Jti(token.jti);
      if (!fresh) {
        if (current === 'log') {
          security.record(prisma, {
            action: 'security.stepup.denied',
            entityType: 'Auth',
            entityId: scope,
            severity: 'warning',
            after: { reason: 't3_replay', scope },
          }).catch(() => {});
          return next();
        }
        return sendError(res, 403, 'STEP_UP_INVALID', 'The confirmation is no longer valid.');
      }
    }

    return next();
  };

  middleware.policy = Object.freeze({ type: 'stepup', scope });
  return middleware;
}

module.exports = { requireStepUp, mode };
module.exports._testHooks = { verifyStepUp, actorFromRequest, readStepUpToken };