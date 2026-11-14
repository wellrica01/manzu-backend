// src/domains/auth/session/session-service.factory.js
//
// FND-06: extract createSessionService() so pharmacy and admin can each have
// their own instance. Doc 1 S3.5.
//
// The factory takes everything that differs between audiences:
//   repository       - the audience-specific repository (pharmacy or admin)
//   signAccess       - function (user, familyId, opts) -> signed token
//   hashToken        - optional, defaults to sha256 hex
//   generateRefreshToken - optional, defaults to 32 random bytes base64url
//   refreshTtlDays   - optional, default 30
//
// Behaviour is identical to the pre-FND-06 pharmacy-session.service.js. The
// pharmacy instance is constructed in pharmacy-session.service.js and
// re-exported under the same names. Doc 3 will construct the admin instance
// with its own repository and signing function.
//
// The exported `createSessionService` does not touch the database or the
// environment. All I/O goes through the injected repository. All signing goes
// through the injected signAccess. That makes both instances testable without
// Prisma and without env vars.

const crypto = require('crypto');

function defaultHashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function defaultGenerateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function defaultSessionError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function createSessionService(config) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('createSessionService: config is required');
  }
  const {
    repository,
    signAccess,
    hashToken = defaultHashToken,
    generateRefreshToken = defaultGenerateRefreshToken,
    refreshTtlDays = 30,
    audience = 'pharmacy',
  } = config;

  if (!repository) throw new TypeError('createSessionService: repository is required');
  if (typeof signAccess !== 'function') throw new TypeError('createSessionService: signAccess function is required');

  const sessionError = defaultSessionError;

  function refreshExpiry() {
    return new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);
  }

  async function startSession(user, deviceInfo, opts = {}, meta = {}) {
    const refreshToken = generateRefreshToken();
    const familyId = crypto.randomUUID();
    await repository.createRefreshToken({
      userId: user.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiry(),
      deviceInfo,
    });

    // FND-09: best-effort device registry upsert. Skipped when the caller did
    // not provide a deviceId (released mobile builds today) or when the
    // repository has no upsertDevice (admin instance until Doc 3 provides one).
    if (meta && meta.deviceId && typeof repository.upsertDevice === 'function') {
      try {
        await repository.upsertDevice({
          actorType: 'pharmacy_user',
          actorId: user.id,
          deviceId: String(meta.deviceId).slice(0, 64),
          label: deviceInfo,
          lastIp: meta.ip || null,
        });
      } catch (err) {
        console.error('Device upsert failed:', { message: err.message });
      }
    }

    // Housekeeping must never break a login.
    if (typeof repository.deleteStaleForUser === 'function') {
      repository.deleteStaleForUser(user.id).catch((err) => {
        console.error('Refresh token cleanup failed:', { message: err.message });
      });
    }

    return { token: signAccess(user, familyId, opts), refreshToken };
  }

  async function refreshSession(rawRefreshToken, deviceInfo, opts = {}, meta = {}) {
    const row = await repository.findRefreshTokenByHash(hashToken(rawRefreshToken));
    if (!row) throw sessionError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');

    if (row.rotatedAt) {
      await repository.revokeFamily(row.familyId);
      throw sessionError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token was already used. Please sign in again.');
    }
    if (row.revokedAt) throw sessionError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
    if (row.expiresAt <= new Date()) throw sessionError(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token expired. Please sign in again.');

    // The user row is joined under different names depending on the
    // repository. Pharmacy users join under "PharmacyUser"; admin rows join
    // under "AdminUser". Accept either, with a fallback to "user" for tests.
    const user = row.PharmacyUser || row.AdminUser || row.user;
    const newRefreshToken = generateRefreshToken();
    const rotated = await repository.rotateRefreshToken(row, {
      tokenHash: hashToken(newRefreshToken),
      expiresAt: refreshExpiry(),
      deviceInfo,
    });
    if (!rotated) {
      await repository.revokeFamily(row.familyId);
      throw sessionError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token was already used. Please sign in again.');
    }

    // FND-09: same best-effort device upsert on the refresh path. This is what
    // updates lastSeenAt when a user actively uses the app - a login-only
    // update would look stale after the first refresh.
    if (meta && meta.deviceId && typeof repository.upsertDevice === 'function') {
      try {
        await repository.upsertDevice({
          actorType: 'pharmacy_user',
          actorId: user.id,
          deviceId: String(meta.deviceId).slice(0, 64),
          label: deviceInfo,
          lastIp: meta.ip || null,
        });
      } catch (err) {
        console.error('Device upsert failed:', { message: err.message });
      }
    }

    return {
      token: signAccess(user, row.familyId, opts),
      refreshToken: newRefreshToken,
      user: opts.userDto ? opts.userDto(user) : undefined,
      pharmacy: opts.pharmacyDto && user.Pharmacy ? opts.pharmacyDto(user.Pharmacy) : undefined,
    };
  }

  async function logout(rawRefreshToken) {
    const row = await repository.findRefreshTokenByHash(hashToken(rawRefreshToken));
    if (row) await repository.revokeFamily(row.familyId);
  }

  async function revokeAllForUser(userId) {
    await repository.revokeAllForUser(userId);
  }

  // The "me" shape depends on the audience. Pharmacy returns { user, pharmacy }.
  // Admin will return its own shape via an override in opts.getMe.
  async function getMe(userId, opts = {}) {
    if (typeof opts.getMe === 'function') return opts.getMe(userId);
    const user = await repository.findUserWithPharmacy(userId);
    if (!user) throw sessionError(401, 'USER_NOT_FOUND', 'Account no longer exists');
    return {
      user: opts.userDto ? opts.userDto(user) : { id: user.id, name: user.name, email: user.email, role: user.role },
      pharmacy: opts.pharmacyDto && user.Pharmacy ? opts.pharmacyDto(user.Pharmacy) : undefined,
    };
  }

  return {
    startSession,
    refreshSession,
    logout,
    revokeAllForUser,
    getMe,
    audience,
  };
}

module.exports = {
  createSessionService,
  defaultHashToken,
  defaultGenerateRefreshToken,
};