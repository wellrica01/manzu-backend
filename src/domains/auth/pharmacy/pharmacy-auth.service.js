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

  const salt = await bcrypt.genSalt(10);
  const hashedPin = await bcrypt.hash(user.pin, salt);

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

  // Step 3: equal-time compare.
  const hash = user ? user.password : DUMMY_HASH;
  const isPinValid = await bcrypt.compare(pin, hash);

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

  const salt = await bcrypt.genSalt(10);
  const hashedPin = await bcrypt.hash(pin, salt);

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

  const updateData = { name, email };
  if (pin) {
    const salt = await bcrypt.genSalt(10);
    updateData.password = await bcrypt.hash(pin, salt);
  }
  if (typeof role !== 'undefined') {
    updateData.role = role.toUpperCase();
  }

  const updatedUser = await pharmacyAuthRepository.updatePharmacyUser(userId, updateData);

  // P-04: a PIN set, role change or email change ends every live session.
  // Previously this ran only when `pin` was set, so a pure demotion left
  // the refresh family alive and the user could keep refreshing for 30 days.
  const roleChanged = typeof role !== 'undefined' && role && role.toUpperCase() !== user.role;
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
  await sessionService.bumpTokenVersionAndRevoke(userId);
  await createAuditLog({
    action: 'AUTH_USER_REMOVED',
    entityType: 'PharmacyUser',
    entityId: userId,
    before: { status: user.status },
    after: { removedLabel: user.name },
  });
  await pharmacyAuthRepository.deletePharmacyUser(userId);
  console.log('User deleted:', { userId, pharmacyId });
}

/**
 * Change pharmacy user PIN
 */
async function changePharmacyUserPin(userId, currentPin, newPin) {
  const user = await pharmacyAuthRepository.findPharmacyUserById(userId);
  if (!user) {
    return { success: false, message: 'User not found' };
  }

  const isPinValid = await bcrypt.compare(currentPin, user.password);
  if (!isPinValid) {
    return { success: false, message: 'Current PIN is incorrect' };
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPin = await bcrypt.hash(newPin, salt);

  await pharmacyAuthRepository.updatePharmacyUser(userId, { password: hashedPin });
  await sessionService.revokeAllForUser(userId);

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

module.exports = {
  registerPharmacyAndUser,
  loginUser,
  addPharmacyUser,
  editPharmacyUser,
  deletePharmacyUser,
  suspendPharmacyUser,
  changePharmacyUserPin,
};