/**
 * PHARMACY SESSION SERVICE (G1, G2, G11)
 *
 * - Access token: the same short-lived JWT as before ({ userId, pharmacyId, role }).
 *   Lifetime defaults to 1 day (JWT_ACCESS_EXPIRES_IN), so the web portal is unaffected.
 * - Refresh token: random 256-bit opaque string. Only its SHA-256 hash is stored.
 *   Every refresh rotates it. Presenting an already-rotated token revokes the
 *   whole family (that login chain), because it means two parties hold the same token.
 * - Role and pharmacy status are re-read from the database on every refresh and on /me.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const repository = require('./pharmacy-session.repository');

const ACCESS_TTL = process.env.JWT_ACCESS_EXPIRES_IN || '1d';
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS) > 0 ? Number(process.env.REFRESH_TOKEN_TTL_DAYS) : 30;

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

function signAccessToken(user) {
  return jwt.sign(
    { userId: user.id, pharmacyId: user.pharmacyId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TTL }
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
async function startSession(user, deviceInfo) {
  const refreshToken = generateRefreshToken();
  await repository.createRefreshToken({
    userId: user.id,
    familyId: crypto.randomUUID(),
    tokenHash: hashToken(refreshToken),
    expiresAt: refreshExpiry(),
    deviceInfo,
  });

  // Housekeeping must never break a login.
  repository.deleteStaleForUser(user.id).catch((err) => {
    console.error('Refresh token cleanup failed:', { message: err.message });
  });

  return { token: signAccessToken(user), refreshToken };
}

/** Trades a valid refresh token for a new access token and a new refresh token. */
async function refreshSession(rawRefreshToken, deviceInfo) {
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
    token: signAccessToken(user),
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
  // exported for tests
  hashToken,
  userDto,
  pharmacyDto,
};
