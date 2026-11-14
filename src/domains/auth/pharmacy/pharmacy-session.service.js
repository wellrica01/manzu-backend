/**
 * PHARMACY SESSION SERVICE (G1, G2, G11) - FND-05b2
 *
 * Changes from pre-FND-05:
 *
 * - Access token now carries: { userId, pharmacyId, role, sid, tv, iss, aud, jti, client }.
 *   The legacy claims userId, pharmacyId, role are preserved so the current
 *   authenticate middleware (and any released mobile build that decodes the
 *   token locally) sees the same fields. The new claims are read by the
 *   DB-validating guard in FND-05b3.
 *
 * - sid      = the refresh-token familyId. Ties the access token to one login
 *              chain, so the guard can revoke one device by revoking a family.
 * - tv       = PharmacyUser.tokenVersion at signing time. The guard compares
 *              this against the row; a mismatch means the token is stale
 *              (role changed, PIN changed, user suspended).
 * - iss/aud  = 'manzu' / 'pharmacy'. Future admin tokens will use aud='admin';
 *              the guard will not accept cross-audience tokens.
 * - jti      = unique token id, used by step-up tokens (FND-08) and any
 *              future revocation list.
 * - client   = 'mobile' | 'web', informational today. Doc 1 S3.2 anticipates
 *              different access TTLs per client; FND-05b2 uses a single 15m
 *              TTL and FND-10 will split it once the client sends its own id.
 *
 * - Access TTL is 15 minutes. JWT_ACCESS_EXPIRES_IN is no longer consulted;
 *   leaving it in .env has no effect. Web portal users will refresh more
 *   often; Doc 2 P-17 retires the web portal, so the cost is bounded.
 *
 * - The signing secret comes from getSecretFor('pharmacy') (FND-05b1). In
 *   Phase 1 with no split secrets set, that returns JWT_SECRET, so behaviour
 *   is identical until the split is deployed.
 *
 * - Refresh token: unchanged. Random 256-bit opaque string. Only the SHA-256
 *   hash is stored. Every refresh rotates it. Presenting an already-rotated
 *   token revokes the whole family.
 *
 * - Role and pharmacy status are re-read from the database on refresh and /me,
 *   as before.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const repository = require('./pharmacy-session.repository');
const { getSecretFor } = require('../../../utils/env-validator');

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS) > 0 ? Number(process.env.REFRESH_TOKEN_TTL_DAYS) : 30;
const ISSUER = 'manzu';
const AUDIENCE = 'pharmacy';

function sessionError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function refreshExpiry() {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Sign a pharmacy access token.
 * @param {object} user - PharmacyUser row (id, pharmacyId, role, tokenVersion)
 * @param {string} familyId - refresh-token familyId; becomes the sid claim
 * @param {object} [opts]
 * @param {string} [opts.client] - 'mobile' | 'web'; defaults 'mobile'
 */
function signAccessToken(user, familyId, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      userId: user.id,
      pharmacyId: user.pharmacyId,
      role: user.role,
      sid: familyId,
      tv: user.tokenVersion ?? 0,
      jti: crypto.randomUUID(),
      client: opts.client || 'mobile',
    },
    getSecretFor('pharmacy'),
    {
      expiresIn: ACCESS_TTL,
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: AUDIENCE,
    }
  );
}

function userDto(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role && user.role.toUpperCase() };
}

function pharmacyDto(pharmacy) {
  return { id: pharmacy.id, name: pharmacy.name, status: pharmacy.status, isActive: pharmacy.isActive, logoUrl: pharmacy.logoUrl || null };
}

/** What to show in a future "your devices" list: the app's own label, else the User-Agent. */
function deviceInfoFromRequest(req) {
  const own = req.body && typeof req.body.deviceInfo === 'string' ? req.body.deviceInfo : '';
  const label = (own || req.get('user-agent') || '').trim().slice(0, 200);
  return label || null;
}

/** New login chain: access token + first refresh token. */
async function startSession(user, deviceInfo, opts = {}) {
  const refreshToken = generateRefreshToken();
  const familyId = crypto.randomUUID();
  await repository.createRefreshToken({
    userId: user.id,
    familyId,
    tokenHash: hashToken(refreshToken),
    expiresAt: refreshExpiry(),
    deviceInfo,
  });

  // Housekeeping must never break a login.
  repository.deleteStaleForUser(user.id).catch((err) => {
    console.error('Refresh token cleanup failed:', { message: err.message });
  });

  return { token: signAccessToken(user, familyId, opts), refreshToken };
}

/** Trades a valid refresh token for a new access token and a new refresh token. */
async function refreshSession(rawRefreshToken, deviceInfo, opts = {}) {
  const row = await repository.findRefreshTokenByHash(hashToken(rawRefreshToken));
  if (!row) throw sessionError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');

  if (row.rotatedAt) {
    await repository.revokeFamily(row.familyId);
    throw sessionError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token was already used. Please sign in again.');
  }
  if (row.revokedAt) throw sessionError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  if (row.expiresAt <= new Date()) throw sessionError(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token expired. Please sign in again.');

  const user = row.PharmacyUser;
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

  return {
    token: signAccessToken(user, row.familyId, opts),
    refreshToken: newRefreshToken,
    user: userDto(user),
    pharmacy: pharmacyDto(user.Pharmacy),
  };
}

/** Revokes the login chain the token belongs to. Idempotent: unknown tokens are ignored. */
async function logout(rawRefreshToken) {
  const row = await repository.findRefreshTokenByHash(hashToken(rawRefreshToken));
  if (row) await repository.revokeFamily(row.familyId);
}

/** Signs out every device of a user (PIN changed, etc.). */
async function revokeAllForUser(userId) {
  await repository.revokeAllForUser(userId);
}

/** G1: who am I, straight from the database. A deleted user gets a 401 so the app signs out. */
async function getMe(userId) {
  const user = await repository.findUserWithPharmacy(userId);
  if (!user) throw sessionError(401, 'USER_NOT_FOUND', 'Account no longer exists');
  return { user: userDto(user), pharmacy: pharmacyDto(user.Pharmacy) };
}

module.exports = {
  startSession,
  refreshSession,
  logout,
  revokeAllForUser,
  getMe,
  deviceInfoFromRequest,
  // exported for tests and for FND-05b3's guard, which needs the same signing helper
  signAccessToken,
  hashToken,
  userDto,
  pharmacyDto,
};