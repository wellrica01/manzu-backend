/**
 * ADMIN AUTH SERVICE
 *
 * Business logic for admin authentication.
 * FND-07b2 adds equal-time login and per-account lockout via
 * AdminUser.failedAttempts / lockedUntil.
 *
 * Access token shape is unchanged by this commit. Admin tokens remain 1-day
 * HS256 signed with JWT_SECRET, carrying { adminId, role }. Doc 3 owns the
 * admin token rewrite (aud=admin, sid, tv, jti, split secret).
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const adminAuthRepository = require('./admin-auth.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');
const throttle = require('../../../core/throttle');
const { computeLockout, isLocked } = require('../../../core/auth/lockout');

const DUMMY_HASH = bcrypt.hashSync('dummy-password-never-used', 10);

function accountKey(email) {
  return crypto.createHash('sha256').update(String(email || '').toLowerCase()).digest('hex');
}

/**
 * Login admin (FND-07b2).
 */
async function loginAdmin({ email, password }) {
  const key = accountKey(email);

  const gate = await throttle.hit({
    class: 'login',
    key,
    windowMs: 15 * 60 * 1000,
    max: 5,
    lockoutMinutes: 15,
  });
  if (!gate.allowed) {
    const error = new Error('Too many login attempts. Please try again later.');
    error.status = 429;
    error.code = 'RATE_LIMITED';
    error.retryAfterMs = gate.retryAfterMs;
    throw error;
  }

  const admin = await adminAuthRepository.findAdminByEmail(email);

  if (admin && isLocked(admin.lockedUntil)) {
    const error = new Error('Account is locked. Please try again later.');
    error.status = 403;
    error.code = 'ACCOUNT_LOCKED';
    error.retryAfterMs = new Date(admin.lockedUntil).getTime() - Date.now();
    throw error;
  }

  const hash = admin ? admin.password : DUMMY_HASH;
  const isPasswordValid = await bcrypt.compare(password, hash);

  if (!admin || !isPasswordValid) {
    if (admin) {
      const nextFailures = Number(admin.failedAttempts || 0) + 1;
      const lockout = computeLockout(nextFailures);
      try {
        await adminAuthRepository.updateAdmin(admin.id, {
          failedAttempts: nextFailures,
          lockedUntil: lockout.lockedUntil,
        });
      } catch (writeErr) {
        console.error('Failed to record failed admin login:', { message: writeErr.message });
      }
      if (lockout.shouldAlert) {
        try {
          require('../../../core/audit/security-event').notify({
            action: 'admin.account.locked',
            severity: 'critical',
            entityType: 'AdminUser',
            entityId: admin.id,
            after: { failedAttempts: nextFailures, minutes: lockout.minutes },
          });
        } catch (_) {
          // never break the login rejection on the alert path
        }
      }
    }
    const error = new Error('Invalid email or password');
    error.status = HTTP_STATUS.UNAUTHORIZED;
    error.code = ERROR_CODES.INVALID_CREDENTIALS;
    throw error;
  }

  if (admin.failedAttempts > 0 || admin.lockedUntil) {
    try {
      await adminAuthRepository.updateAdmin(admin.id, { failedAttempts: 0, lockedUntil: null });
    } catch (writeErr) {
      console.error('Failed to reset admin lockout state:', { message: writeErr.message });
    }
  }
  await throttle.reset({ class: 'login', key }).catch(() => {});

  console.log('Admin authenticated:', { adminId: admin.id });

  const token = jwt.sign(
    { adminId: admin.id, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, admin };
}

module.exports = {
  loginAdmin,
};