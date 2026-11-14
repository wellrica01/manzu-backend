// src/domains/auth/pharmacy/stepup.service.js
//
// FND-08a. Issues step-up tokens (Doc 1 S4.5).
//
// A step-up token is a short-lived (5 minute) JWT that grants a specific
// capability "scope" inside a specific session, after the user has re-entered
// their PIN. requireStepUp(scope) (FND-08b) checks it on the routes that need
// it. Nothing is applied yet; this commit builds the issuance side.
//
// Tiers per S4.5:
//   T0 - session only. No step-up token.
//   T1 - confirmation + reason. Client-side discipline. No token.
//   T2 - fresh PIN within 5 minutes. This is the tier FND-08 issues.
//   T3 - T2 plus a second factor. FND-08 does NOT issue T3; requests for T3
//        scopes return APPROVAL_REQUIRED and Doc 3 (admin + MFA) wires the
//        second factor.
//
// Step-up attempt limits, per S4.5:
//   5 attempts per 5 minutes per user, then locked for 15 minutes.
// Uses the throttle interface (FND-07a). A denied step-up increments
// PharmacyUser.failedAttempts so it counts toward the same lockout schedule
// as login; the login lockout does not know whether the attempt was a login
// or a step-up, and it should not - they are the same failure surface.
//
// The token is signed with getSecretFor('stepup') (FND-05b1). Fallback to
// JWT_SECRET in Phase 1 with no split secrets set.
//
// What the token carries:
//   userId  - the pharmacy user the token authorises.
//   sid     - the session id (from req.user.sid, the FND-05b2 claim). The
//             token is only valid inside that session; a step-up granted on
//             device A cannot be used on device B.
//   scope   - the capability name the token grants, exact string match.
//   tier    - always 'T2' from this service. T3 is Doc 3.
//   jti     - unique token id, used for T3 single-use (FND-08b); harmless
//             for T2 which is not single-use.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const repository = require('./pharmacy-auth.repository');
const { getSecretFor } = require('../../../utils/env-validator');
const { currentActor } = require('../../../core/context/actor-context');
const throttle = require('../../../core/throttle');
const { computeLockout, isLocked } = require('../../../core/auth/lockout');
const security = require('../../../core/audit/security-event');

const STEPUP_TTL_SECONDS = 5 * 60;
const STEPUP_WINDOW_MS = 5 * 60 * 1000;
const STEPUP_MAX_ATTEMPTS = 5;
const STEPUP_LOCKOUT_MINUTES = 15;
const ISSUER = 'manzu';
const AUDIENCE = 'stepup';

// Known T3 scopes. FND-08 does not issue T3; the request gets APPROVAL_REQUIRED.
// Doc 3 will add its own T3 scopes to this list or override the check.
const T3_SCOPES = new Set([
  'banking.manage',
  'team.manage',
]);

function isT3Scope(scope) {
  return T3_SCOPES.has(scope);
}

function stepupThrottleKey(userId) {
  return crypto.createHash('sha256').update(`stepup:user:${userId}`).digest('hex');
}

function signStepUpToken({ userId, sessionId, scope, tier }) {
  return jwt.sign(
    {
      userId,
      sid: sessionId,
      scope,
      tier,
      jti: crypto.randomUUID(),
    },
    getSecretFor('stepup'),
    {
      expiresIn: STEPUP_TTL_SECONDS,
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: AUDIENCE,
    }
  );
}

/**
 * Issue a step-up token.
 *
 * @param {object} params
 * @param {number} params.userId    - from the authenticated session
 * @param {string} params.sessionId - from req.user.sid (FND-05b2 claim)
 * @param {string} params.pin       - the freshly entered PIN
 * @param {string} params.scope     - the capability name to grant
 *
 * @returns {Promise<{ok: true, token, scope, tier, expiresAt} |
 *                   {ok: false, code, message, retryAfterMs?}>}
 *
 * Never throws to the caller; returns an {ok:false} shape on every failure
 * path. The route layer maps {ok:false} to sendAuthError.
 */
async function issueStepUp({ userId, sessionId, pin, scope }) {
  // 1. Argument checks. A missing session id means the caller is not in a
  // proper session (or the token predates FND-05b2). Either way, a step-up
  // token bound to no session is not useful - refuse.
  if (!userId || !sessionId || typeof pin !== 'string' || !pin) {
    return { ok: false, code: 'STEP_UP_INVALID', message: 'Missing session, user, or PIN.' };
  }
  if (!scope || typeof scope !== 'string') {
    return { ok: false, code: 'STEP_UP_INVALID', message: 'Missing scope.' };
  }

  // 2. T3 is out of scope for FND-08. A T3 request is a legitimate request
  // that we cannot yet fulfil, so APPROVAL_REQUIRED is the right signal.
  if (isT3Scope(scope)) {
    return {
      ok: false,
      code: 'APPROVAL_REQUIRED',
      message: 'This action needs a second factor. It is not yet enabled.',
    };
  }

  // 3. Throttle: five attempts per five minutes per user, then a 15-minute lock.
  const throttleKey = stepupThrottleKey(userId);
  const gate = await throttle.hit({
    class: 'stepup',
    key: throttleKey,
    windowMs: STEPUP_WINDOW_MS,
    max: STEPUP_MAX_ATTEMPTS,
    lockoutMinutes: STEPUP_LOCKOUT_MINUTES,
  });
  if (!gate.allowed) {
    security.record(require('../../../core/database/prisma'), {
      action: 'security.stepup.denied',
      entityType: 'PharmacyUser',
      entityId: userId,
      severity: 'warning',
      after: { scope, reason: 'throttle', level: gate.level },
    }).catch(() => {});
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Too many step-up attempts. Please try again later.',
      retryAfterMs: gate.retryAfterMs,
    };
  }

  // 4. Load the user. If they are already locked out from login failures, a
  // successful step-up should not unlock them, so honour the existing lock.
  const user = await repository.findPharmacyUserById(userId);
  if (!user) {
    return { ok: false, code: 'STEP_UP_INVALID', message: 'Account no longer exists.' };
  }
  if (isLocked(user.lockedUntil)) {
    return {
      ok: false,
      code: 'ACCOUNT_LOCKED',
      message: 'Account is locked. Please try again later.',
      retryAfterMs: new Date(user.lockedUntil).getTime() - Date.now(),
    };
  }

  // 5. Verify the PIN. Same bcrypt cost as login and change-pin.
  const pinValid = await bcrypt.compare(pin, user.password);
  if (!pinValid) {
    // 5a. Count the failure the same way login does. This feeds the existing
    // lockout schedule; the next login attempt will see the higher count.
    const nextFailures = Number(user.failedAttempts || 0) + 1;
    const lockout = computeLockout(nextFailures);
    try {
      await repository.updatePharmacyUser(user.id, {
        failedAttempts: nextFailures,
        lockedUntil: lockout.lockedUntil,
      });
    } catch (err) {
      console.error('step-up: failed to record failure', { message: err && err.message });
    }
    security.record(require('../../../core/database/prisma'), {
      action: 'security.stepup.denied',
      entityType: 'PharmacyUser',
      entityId: user.id,
      severity: 'warning',
      after: { scope, reason: 'pin_invalid' },
    }).catch(() => {});
    return { ok: false, code: 'STEP_UP_INVALID', message: 'PIN is incorrect.' };
  }

  // 6. Success. Reset the failure counter (but not a login lockout - that is
  // a separate decision, and the login path owns the reset).
  if (user.failedAttempts > 0) {
    try {
      await repository.updatePharmacyUser(user.id, { failedAttempts: 0, lockedUntil: null });
    } catch (err) {
      console.error('step-up: failed to reset failure count', { message: err && err.message });
    }
  }
  await throttle.reset({ class: 'stepup', key: throttleKey }).catch(() => {});

  // 7. Sign and return.
  const token = signStepUpToken({
    userId: user.id,
    sessionId,
    scope,
    tier: 'T2',
  });

  return {
    ok: true,
    token,
    scope,
    tier: 'T2',
    expiresAt: new Date(Date.now() + STEPUP_TTL_SECONDS * 1000).toISOString(),
  };
}

module.exports = {
  issueStepUp,
  isT3Scope,
  signStepUpToken,
  // exported for tests
  STEPUP_TTL_SECONDS,
  T3_SCOPES,
};