/**
 * PHARMACY AUTH SERVICE
 *
 * Business logic for pharmacy authentication and user management.
 * FND-07b2 adds equal-time login (SEC-04) and per-account lockout using
 * PharmacyUser.failedAttempts / lockedUntil.
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { validateLocation } = require('../../../utils/location');
const pharmacyAuthRepository = require('./pharmacy-auth.repository');
const sessionService = require('./pharmacy-session.service');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');
const throttle = require('../../../core/throttle');
const { computeLockout, isLocked } = require('../../../core/auth/lockout');
const { createAuditLog } = require('../../../utils/audit-logger');
const { hashPin, verifyPin, needsUpgrade, DUMMY_HASH_V2 } = require('../../../utils/pin-crypto');
const { isWeakPin } = require('../../../utils/pin-blocklist');

// A real bcrypt hash with the same cost factor as production PINs.
// The dummy compare makes an unknown email take the same time as a known
// email with the wrong PIN, closing the SEC-04 timing oracle.
const DUMMY_HASH = bcrypt.hashSync('dummy-pin-never-used', 10);

function accountKey(email) {
  return crypto.createHash('sha256').update(String(email || '').toLowerCase()).digest('hex');
}

/**
 * Register pharmacy and initial user
 */
async function registerPharmacyAndUser({ pharmacy, user, deviceInfo, meta }) {
  validateLocation(pharmacy.state, pharmacy.lga, pharmacy.latitude, pharmacy.longitude);

  const existingPharmacy = await pharmacyAuthRepository.findPharmacyByLicense(pharmacy.licenseNumber);
  if (existingPharmacy) {
    const error = new Error('Pharmacy license number already exists');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = ERROR_CODES.ALREADY_EXISTS;
    throw error;
  }

  const existingUser = await pharmacyAuthRepository.findPharmacyUserByEmail(user.email);
  if (existingUser) {
    const error = new Error('Email already registered');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = ERROR_CODES.ALREADY_EXISTS;
    throw error;
  }

  const weak = isWeakPin(user.pin);
  if (weak.blocked) {
    const error = new Error('PIN is too common or too predictable');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'WEAK_PIN';
    throw error;
  }
  const hashedPin = await hashPin(user.pin);

  const result = await pharmacyAuthRepository.executeTransaction(async (tx) => {
    const newPharmacy = await pharmacyAuthRepository.createPharmacyWithGPS(pharmacy, tx);

    const newUser = await pharmacyAuthRepository.createPharmacyUser({
      email: user.email,
      hashedPassword: hashedPin,
      name: user.name,
      role: 'MANAGER',
      pharmacyId: newPharmacy.id,
    }, tx);

    return { pharmacy: newPharmacy, user: newUser };
  });

  console.log('Pharmacy registered with GPS:', {
    pharmacyId: result.pharmacy.id,
    lat: result.pharmacy.latitude,
    lng: result.pharmacy.longitude,
    accuracy: result.pharmacy.locationAccuracy,
  });

  const { token, refreshToken } = await sessionService.startSession(result.user, deviceInfo, {}, meta || {});

  return { token, refreshToken, user: result.user, pharmacy: result.pharmacy };
}

/**
 * Login pharmacy user (FND-07b2).
 *
 * Flow:
 *   1. (removed in P-04.2b2) the throttle gate; see the new comment at step 1.
 *      before any database or bcrypt work.
 *   2. Look up the user. If the account is currently locked out (lockedUntil
 *      in the future), throw 403 ACCOUNT_LOCKED with retryAfterMs.
 *   3. bcrypt.compare(pin, user.password). If the user does not exist, run the
 *      same compare against DUMMY_HASH so the two paths take the same time.
 *   4. On failure: increment failedAttempts, apply the lockout schedule, write
 *      both with updatePharmacyUser. Throw 401.
 *   5. On success: reset failedAttempts and lockedUntil; start the session.
 */
async function loginUser({ email, pin, deviceInfo, meta }) {

  // Step 1 (P-04.2b2): the account throttle used to gate here.
  // The IP bucket is now class `auth_ip` in middleware/rate-limiting.js.
  // The per-account lockout is the `lockedUntil` column below.

  // Step 2: look up.
  const user = await pharmacyAuthRepository.findPharmacyUserByEmail(email);

  if (user && isLocked(user.lockedUntil)) {
    const error = new Error('Account is locked. Please try again later.');
    error.status = 403;
    error.code = 'ACCOUNT_LOCKED';
    error.retryAfterMs = new Date(user.lockedUntil).getTime() - Date.now();
    throw error;
  }

  // Step 3: equal-time compare, version-aware.
  let isPinValid = false;
  if (user) {
    isPinValid = await verifyPin(pin, user.password, user.pinHashVersion || 1);
  } else {
    // Unknown email: v2 dummy compare at the same cost as a real v2 verify.
    await verifyPin(pin, DUMMY_HASH_V2, 2);
    isPinValid = false;
  }

  if (!user || !isPinValid) {
    // Step 4: failure.
    if (user) {
      const nextFailures = Number(user.failedAttempts || 0) + 1;
      const lockout = computeLockout(nextFailures);
      try {
        await pharmacyAuthRepository.updatePharmacyUser(user.id, {
          failedAttempts: nextFailures,
          lockedUntil: lockout.lockedUntil,
        });
      } catch (writeErr) {
        console.error('Failed to record failed login:', { message: writeErr.message });
      }
      // P-04.2b2: route on severity (see lockout.js).
      //   'lockout'  - routine (5-7); no extra event, just the DB write above.
      //   'notify'   - 8-11; write an AuditEvent for P-11's activity feed.
      //   'critical' - 12+; also fire security.notify (Sentry).
      try {
        const security = require('../../../core/audit/security-event');
        const prismaDb = require('../../../core/database/prisma');
        if (lockout.severity === 'notify') {
          security.record(prismaDb, {
            action: 'auth.account.lockout.warning',
            severity: 'warning',
            entityType: 'PharmacyUser',
            entityId: user.id,
            after: { failedAttempts: nextFailures, minutes: lockout.minutes },
          }).catch(() => {});
        } else if (lockout.severity === 'critical') {
          security.notify({
            action: 'auth.account.locked',
            severity: 'critical',
            entityType: 'PharmacyUser',
            entityId: user.id,
            after: { failedAttempts: nextFailures, minutes: lockout.minutes },
          });
        }
      } catch (_) { /* never break the login rejection on the event path */ }
    }
    const error = new Error('Invalid email or PIN');
    error.status = HTTP_STATUS.UNAUTHORIZED;
    error.code = ERROR_CODES.INVALID_CREDENTIALS;
    throw error;
  }

  // Step 5: success.
  if (user.failedAttempts > 0 || user.lockedUntil) {
    try {
      await pharmacyAuthRepository.updatePharmacyUser(user.id, {
        failedAttempts: 0,
        lockedUntil: null,
      });
    } catch (writeErr) {
      console.error('Failed to reset lockout state:', { message: writeErr.message });
    }
  }

  // P-07: v1 -> v2 upgrade on first successful login. A v1 hash means the
  // user's PIN predates the blocklist; if the typed PIN is weak, set
  // mustChangePin in the same write so the user is forced to choose a new
  // one (Doc 2 section 5.3 first-sign-in sweep).
  if (isPinValid && needsUpgrade(user.pinHashVersion)) {
    try {
      const upgraded = await hashPin(pin);
      const update = { password: upgraded, pinHashVersion: 2 };
      if (isWeakPin(pin).blocked) update.mustChangePin = true;
      await pharmacyAuthRepository.updatePharmacyUser(user.id, update);
    } catch (upgradeErr) {
      console.error('PIN hash upgrade failed (login still succeeds):', { message: upgradeErr.message });
    }
  }
  console.log('User authenticated with PIN:', { userId: user.id, pharmacyId: user.pharmacyId });

  const { token, refreshToken } = await sessionService.startSession(user, deviceInfo, {}, meta || {});

  return { token, refreshToken, user, pharmacy: user.Pharmacy };
}

/**
 * Add pharmacy user
 */
async function addPharmacyUser({ name, email, pin, role, pharmacyId }) {
  const existingUser = await pharmacyAuthRepository.findPharmacyUserByEmail(email);
  if (existingUser) {
    const error = new Error('Email already registered');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = ERROR_CODES.ALREADY_EXISTS;
    throw error;
  }

  const weak = isWeakPin(pin);
  if (weak.blocked) {
    const error = new Error('PIN is too common or too predictable');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'WEAK_PIN';
    throw error;
  }
  const hashedPin = await hashPin(pin);

  const newUser = await pharmacyAuthRepository.createPharmacyUser({
    name,
    email,
    hashedPassword: hashedPin,
    role: role.toUpperCase(),
    pharmacyId,
  });

  console.log('User added with PIN:', { userId: newUser.id, pharmacyId });
  return newUser;
}

// ============================================================================
// P-06: last-manager guard (Doc 2 section 5.1)
// ============================================================================

/**
 * Refuse to suspend / remove / demote the last ACTIVE manager in a pharmacy.
 * Non-managers always pass (they can never be "last manager").
 */
async function assertNotLastManager(userId, pharmacyId, action) {
  const target = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(userId, pharmacyId);
  if (!target || target.role !== 'MANAGER') return;
  const managerCount = await pharmacyAuthRepository.countActiveManagers(pharmacyId);
  if (managerCount <= 1) {
    const error = new Error('Cannot ' + action + ' the last active manager');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'LAST_MANAGER';
    throw error;
  }
}

/**
 * Edit pharmacy user
 */
async function editPharmacyUser(userId, { name, email, pin, role }, managerId, pharmacyId) {
  if (userId === managerId) {
    const error = new Error('Cannot edit your own account');
    error.status = HTTP_STATUS.FORBIDDEN;
    error.code = ERROR_CODES.FORBIDDEN;
    throw error;
  }

  const user = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(userId, pharmacyId);
  if (!user) {
    const error = new Error('User not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }

  if (email !== user.email) {
    const existingUser = await pharmacyAuthRepository.findPharmacyUserByEmail(email);
    if (existingUser) {
      const error = new Error('Email already registered');
      error.status = HTTP_STATUS.BAD_REQUEST;
      error.code = ERROR_CODES.ALREADY_EXISTS;
      throw error;
    }
  }

  const roleChanged = typeof role !== 'undefined' && role && role.toUpperCase() !== user.role;
  if (roleChanged && user.role === 'MANAGER') {
    await assertNotLastManager(userId, pharmacyId, 'demote');
  }
  const updateData = { name, email };
  if (pin) {
    const weak = isWeakPin(pin);
    if (weak.blocked) {
      const error = new Error('PIN is too common or too predictable');
      error.status = HTTP_STATUS.BAD_REQUEST;
      error.code = 'WEAK_PIN';
      throw error;
    }
    updateData.password = await hashPin(pin);
    updateData.pinHashVersion = 2;
  }
  if (typeof role !== 'undefined') {
    updateData.role = role.toUpperCase();
  }

  const updatedUser = await pharmacyAuthRepository.updatePharmacyUser(userId, updateData);

  // P-04: a PIN set, role change or email change ends every live session.
  // Previously this ran only when `pin` was set, so a pure demotion left
  // the refresh family alive and the user could keep refreshing for 30 days.
  const emailChanged = email && email !== user.email;
  if (pin || roleChanged || emailChanged) {
    await sessionService.bumpTokenVersionAndRevoke(userId);
  }

  // P-05.5c: actor-attributed audit for role and PIN changes.
  if (roleChanged) {
    await createAuditLog({
      action: 'AUTH_ROLE_CHANGED',
      entityType: 'PharmacyUser',
      entityId: userId,
      before: { role: user.role },
      after: { role: role.toUpperCase(), changedById: managerId },
    });
  }
  if (pin) {
    await createAuditLog({
      action: 'AUTH_PIN_CHANGED',
      entityType: 'PharmacyUser',
      entityId: userId,
    });
  }

  console.log('User updated:', { userId: updatedUser.id, pharmacyId });
  return updatedUser;
}

/**
 * Delete pharmacy user
 */
async function deletePharmacyUser(userId, managerId, pharmacyId) {
  if (userId === managerId) {
    const error = new Error('Cannot delete your own account');
    error.status = HTTP_STATUS.FORBIDDEN;
    error.code = ERROR_CODES.FORBIDDEN;
    throw error;
  }

  const user = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(userId, pharmacyId);
  if (!user) {
    const error = new Error('User not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }

  // P-04: end every live session before the row is removed. The refresh
  // tokens cascade with the row, but the access token would otherwise
  // stay valid for its TTL. Bumping tokenVersion closes that window; when
  // P-06 replaces this with a soft delete, the row persists, so this bump
  // is the only thing that ends the session.
  await assertNotLastManager(userId, pharmacyId, 'remove');
  await sessionService.bumpTokenVersionAndRevoke(userId);
  await createAuditLog({
    action: 'AUTH_USER_REMOVED',
    entityType: 'PharmacyUser',
    entityId: userId,
    before: { status: user.status },
    after: { removedLabel: user.name },
  });
  // P-06.6c: soft delete. Row stays for history; email is NOT rewritten here
  // (a follow-up will rewrite to removed+<id>@invalid for reuse).
  await pharmacyAuthRepository.updatePharmacyUser(userId, {
    status: 'REMOVED',
    removedAt: new Date(),
    removedLabel: user.name,
  });
  console.log('User removed:', { userId, pharmacyId });
}

/**
 * Change pharmacy user PIN
 */
async function changePharmacyUserPin(userId, currentPin, newPin) {
  const user = await pharmacyAuthRepository.findPharmacyUserById(userId);
  if (!user) {
    return { success: false, message: 'User not found' };
  }

  const isPinValid = await verifyPin(currentPin, user.password, user.pinHashVersion || 1);
  if (!isPinValid) {
    return { success: false, message: 'Current PIN is incorrect' };
  }

  const weak = isWeakPin(newPin);
  if (weak.blocked) {
    return { success: false, message: 'PIN is too common or too predictable' };
  }
  const hashedPin = await hashPin(newPin);

  await pharmacyAuthRepository.updatePharmacyUser(userId, { password: hashedPin, pinHashVersion: 2 });

  return { success: true };
}

/**
 * Suspend a pharmacy user (Doc 2 section 5.1, P-04).
 *
 * Sets status=SUSPENDED, records suspendedAt/suspendedById, then ends
 * every live session (tokenVersion bump + refresh family revoke) via the
 * session-service primitive. Route wiring (POST /auth/users/:userId/suspend)
 * is P-06; this method is the primitive it will call.
 *
 * Self-suspend is refused, matching edit/delete.
 */
async function suspendPharmacyUser(userId, managerId, pharmacyId) {
  if (userId === managerId) {
    const error = new Error('Cannot suspend your own account');
    error.status = HTTP_STATUS.FORBIDDEN;
    error.code = ERROR_CODES.FORBIDDEN;
    throw error;
  }

  const user = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(userId, pharmacyId);
  if (!user) {
    const error = new Error('User not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }

  await assertNotLastManager(userId, pharmacyId, 'suspend');

  const updated = await pharmacyAuthRepository.updatePharmacyUser(userId, {
    status: 'SUSPENDED',
    suspendedAt: new Date(),
    suspendedById: managerId,
  });

  await sessionService.bumpTokenVersionAndRevoke(userId);
  await createAuditLog({
    action: 'AUTH_USER_SUSPENDED',
    entityType: 'PharmacyUser',
    entityId: userId,
    before: { status: user.status },
    after: { status: 'SUSPENDED', suspendedById: managerId },
  });

  console.log('User suspended:', { userId, pharmacyId, managerId });
  return updated;
}

// ============================================================================
// P-06: invite flow (Doc 2 section 5.2)
//
// Managers create an invite for an INVITED user. The server returns the
// plaintext code ONCE (this is the only time it leaves the server) and
// stores only an HMAC-SHA256 hash. The invitee accepts via the public route
// POST /auth/invite/accept, sets their own PIN, and the user becomes ACTIVE.
//
// Enumeration resistance: every refusal path in acceptInvite returns the
// same INVALID_INVITE error - unknown email, wrong code, expired, already
// used, too many attempts, or email mismatch. Do not distinguish between
// them in the response.
//
// PIN format is enforced here (6 digits). The PIN blocklist (Doc 2 section
// 5.3) is P-07 and will be added in the same place.
// ============================================================================

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 8;
const INVITE_TTL_HOURS = 48;
const INVITE_MAX_ATTEMPTS = 5;

function invitePepper() {
  const pepper = process.env.INVITE_PEPPER;
  if (!pepper || pepper.length < 32) {
    const err = new Error('Server configuration error');
    err.status = 500;
    err.code = 'SERVER_ERROR';
    throw err;
  }
  return pepper;
}

function generateInviteCode() {
  const bytes = crypto.randomBytes(INVITE_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  }
  return out;
}

function hashInviteCode(code) {
  return crypto.createHmac('sha256', invitePepper()).update(String(code)).digest('hex');
}

function invalidInviteError() {
  const error = new Error('Invalid invite');
  error.status = HTTP_STATUS.BAD_REQUEST;
  error.code = 'INVALID_INVITE';
  return error;
}

/**
 * Create (or re-issue) an invite for an INVITED user.
 *
 * Returns { code, expiresAt } - code is the plaintext, shown once to the
 * caller. The DB row holds only the HMAC hash.
 */
async function createInvite(userId, createdById, pharmacyId) {
  const user = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(userId, pharmacyId);
  if (!user) {
    const error = new Error('User not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }
  if (user.status !== 'INVITED') {
    const error = new Error('User is not in INVITED state');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'INVALID_STATE';
    throw error;
  }

  const code = generateInviteCode();
  const codeHash = hashInviteCode(code);
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

  await pharmacyAuthRepository.createPharmacyUserInvite({
    userId,
    codeHash,
    expiresAt,
    createdById,
  });

  await createAuditLog({
    action: 'AUTH_INVITE_SENT',
    entityType: 'PharmacyUser',
    entityId: userId,
    after: { role: user.role, invitedById: createdById },
  });

  console.log('Invite created:', { userId, pharmacyId, createdById });
  return { code, expiresAt };
}

/**
 * Accept an invite. Public route - the caller has no session.
 *
 * On success: user status becomes ACTIVE, PIN is set, invite is consumed,
 * and a session starts. On any failure: INVALID_INVITE, same shape and
 * status regardless of the cause (enumeration resistance).
 */
async function acceptInvite({ email, code, pin, deviceInfo, meta }) {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    const error = new Error('PIN must be exactly 6 digits');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const codeHash = hashInviteCode(code);
  const invite = await pharmacyAuthRepository.findInviteByHash(codeHash);

  if (!invite) throw invalidInviteError();
  if (invite.usedAt) throw invalidInviteError();
  if (invite.attempts >= INVITE_MAX_ATTEMPTS) throw invalidInviteError();
  if (new Date(invite.expiresAt) <= new Date()) throw invalidInviteError();
  if (!invite.PharmacyUser || invite.PharmacyUser.email !== email) {
    await pharmacyAuthRepository.incrementInviteAttempts(invite.id);
    throw invalidInviteError();
  }

  const weak = isWeakPin(pin);
  if (weak.blocked) {
    const error = new Error('PIN is too common or too predictable');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'WEAK_PIN';
    throw error;
  }
  const hashedPin = await hashPin(pin);

  await pharmacyAuthRepository.executeTransaction(async (tx) => {
    await tx.pharmacyUser.update({
      where: { id: invite.userId },
      data: {
        status: 'ACTIVE',
        password: hashedPin,
        pinHashVersion: 2,
        pinChangedAt: new Date(),
        mustChangePin: false,
      },
    });
    await tx.pharmacyUserInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });
  });

  await createAuditLog({
    action: 'AUTH_INVITE_ACCEPTED',
    entityType: 'PharmacyUser',
    entityId: invite.userId,
    after: {},
  });

  const updatedUser = await pharmacyAuthRepository.findPharmacyUserById(invite.userId);
  const { token, refreshToken } = await sessionService.startSession(updatedUser, deviceInfo, {}, meta || {});

  console.log('Invite accepted:', { userId: invite.userId });
  return { token, refreshToken, user: updatedUser, pharmacy: updatedUser.Pharmacy };
}

/**
 * Revoke a pending invite. Re-inviting the same user issues a new code,
 * so this is only needed if the manager wants to cancel without reissuing.
 * No audit event - the fresh AUTH_INVITE_SENT on re-invite supersedes it.
 */
async function revokeInvite(userId, pharmacyId) {
  const user = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(userId, pharmacyId);
  if (!user) {
    const error = new Error('User not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }
  return { revoked: true };
}


// ============================================================================
// P-06: reactivate and PIN reset
// ============================================================================

/**
 * Reactivate a SUSPENDED user. The manager issues a fresh invite code that
 * the user redeems to set a new PIN; the user becomes ACTIVE when they
 * accept. This is not the same as setting status=ACTIVE here - the account
 * stays SUSPENDED until the invite is redeemed, so the manager cannot
 * accidentally re-open a session without the user setting a new credential.
 */
async function reactivatePharmacyUser(userId, managerId, pharmacyId) {
  if (userId === managerId) {
    const error = new Error('Cannot reactivate your own account');
    error.status = HTTP_STATUS.FORBIDDEN;
    error.code = ERROR_CODES.FORBIDDEN;
    throw error;
  }

  const user = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(userId, pharmacyId);
  if (!user) {
    const error = new Error('User not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }
  if (user.status !== 'SUSPENDED') {
    const error = new Error('User is not in SUSPENDED state');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'INVALID_STATE';
    throw error;
  }

  // Clear suspension metadata; status stays SUSPENDED until invite accept.
  await pharmacyAuthRepository.updatePharmacyUser(userId, {
    suspendedAt: null,
    suspendedById: null,
    mustChangePin: true,
  });

  await sessionService.bumpTokenVersionAndRevoke(userId);

  await createAuditLog({
    action: 'AUTH_USER_REACTIVATED',
    entityType: 'PharmacyUser',
    entityId: userId,
    before: { status: user.status },
    after: { status: 'SUSPENDED_PENDING_ACCEPT' },
  });

  // Issue an invite code (the user redeems it to set a new PIN, which flips
  // status to ACTIVE via acceptInvite).
  const code = generateInviteCode();
  const codeHash = hashInviteCode(code);
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
  await pharmacyAuthRepository.createPharmacyUserInvite({
    userId,
    codeHash,
    expiresAt,
    createdById: managerId,
  });

  console.log('User reactivation pending accept:', { userId, pharmacyId, managerId });
  return { code, expiresAt };
}

/**
 * Reset a user's PIN. Manager-triggered; the user redeems a one-time code
 * to set a new PIN (same mechanism as invite accept). Revokes every live
 * session on the target immediately.
 */
async function resetPharmacyUserPin(userId, managerId, pharmacyId) {
  if (userId === managerId) {
    const error = new Error('Cannot reset your own PIN');
    error.status = HTTP_STATUS.FORBIDDEN;
    error.code = ERROR_CODES.FORBIDDEN;
    throw error;
  }

  const user = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(userId, pharmacyId);
  if (!user) {
    const error = new Error('User not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }
  if (user.status !== 'ACTIVE') {
    const error = new Error('Can only reset the PIN of an ACTIVE user');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'INVALID_STATE';
    throw error;
  }

  await pharmacyAuthRepository.updatePharmacyUser(userId, { mustChangePin: true });
  await sessionService.bumpTokenVersionAndRevoke(userId);

  await createAuditLog({
    action: 'AUTH_PIN_RESET',
    entityType: 'PharmacyUser',
    entityId: userId,
    after: { pinChangedById: managerId },
  });

  const code = generateInviteCode();
  const codeHash = hashInviteCode(code);
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
  await pharmacyAuthRepository.createPharmacyUserInvite({
    userId,
    codeHash,
    expiresAt,
    createdById: managerId,
  });

  console.log('PIN reset initiated:', { userId, pharmacyId, managerId });
  return { code, expiresAt };
}

/**
 * Transfer the MANAGER role from one user to another. Both users are signed
 * out; both are audited. The transaction never leaves the pharmacy without a
 * manager, so the LAST_MANAGER guard does not apply here.
 */
async function transferManager(fromUserId, toUserId, actorUserId, pharmacyId) {
  if (fromUserId === toUserId) {
    const error = new Error('Cannot transfer the manager role to yourself');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'INVALID_STATE';
    throw error;
  }

  const from = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(fromUserId, pharmacyId);
  const to = await pharmacyAuthRepository.findPharmacyUserByIdAndPharmacy(toUserId, pharmacyId);
  if (!from || !to) {
    const error = new Error('User not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }
  if (from.role !== 'MANAGER') {
    const error = new Error('Source user is not a MANAGER');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'INVALID_STATE';
    throw error;
  }
  if (to.status !== 'ACTIVE') {
    const error = new Error('Target user must be ACTIVE');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'INVALID_STATE';
    throw error;
  }
  if (to.role === 'MANAGER') {
    const error = new Error('Target user is already a MANAGER');
    error.status = HTTP_STATUS.BAD_REQUEST;
    error.code = 'INVALID_STATE';
    throw error;
  }

  await pharmacyAuthRepository.executeTransaction(async (tx) => {
    await tx.pharmacyUser.update({ where: { id: toUserId }, data: { role: 'MANAGER' } });
    await tx.pharmacyUser.update({ where: { id: fromUserId }, data: { role: 'PHARMACIST' } });
  });

  await sessionService.bumpTokenVersionAndRevoke(toUserId);
  await sessionService.bumpTokenVersionAndRevoke(fromUserId);

  await createAuditLog({
    action: 'AUTH_ROLE_CHANGED',
    entityType: 'PharmacyUser',
    entityId: toUserId,
    before: { role: to.role },
    after: { role: 'MANAGER', changedById: actorUserId },
  });
  await createAuditLog({
    action: 'AUTH_ROLE_CHANGED',
    entityType: 'PharmacyUser',
    entityId: fromUserId,
    before: { role: from.role },
    after: { role: 'PHARMACIST', changedById: actorUserId },
  });

  console.log('Manager transferred:', { fromUserId, toUserId, pharmacyId, actorUserId });
  return { user: { id: to.id, name: to.name, email: to.email, role: 'MANAGER' } };
}
module.exports = {
  registerPharmacyAndUser,
  loginUser,
  addPharmacyUser,
  editPharmacyUser,
  deletePharmacyUser,
  suspendPharmacyUser,
  changePharmacyUserPin,
  createInvite,
  acceptInvite,
  revokeInvite,
  reactivatePharmacyUser,
  resetPharmacyUserPin,
  transferManager,
};