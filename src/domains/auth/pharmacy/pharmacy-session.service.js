/**
 * PHARMACY SESSION SERVICE (G1, G2, G11)
 *
 * FND-06: thin wrapper over the shared factory in ../session/session-service.factory.
 * The factory owns the refresh-token rotation and reuse detection logic; this
 * file supplies the pharmacy repository and the pharmacy signing function.
 *
 * Behaviour is unchanged from FND-05b2. All exports keep the same names and
 * shapes: startSession, refreshSession, logout, revokeAllForUser, getMe,
 * deviceInfoFromRequest, signAccessToken, hashToken, userDto, pharmacyDto.
 *
 * Doc 3 will create its own instance with the admin repository and admin
 * signing function. The two instances never share a row.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const repository = require('./pharmacy-session.repository');
const { getSecretFor } = require('../../../utils/env-validator');
const { createSessionService, defaultHashToken } = require('../session/session-service.factory');

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS) > 0 ? Number(process.env.REFRESH_TOKEN_TTL_DAYS) : 30;
const ISSUER = 'manzu';
const AUDIENCE = 'pharmacy';

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

function deviceInfoFromRequest(req) {
  const own = req.body && typeof req.body.deviceInfo === 'string' ? req.body.deviceInfo : '';
  const label = (own || req.get('user-agent') || '').trim().slice(0, 200);
  return label || null;
}

/**
 * FND-09: the stable device identity. The mobile app generates a UUID once and
 * keeps it in SecureStore; it sends the UUID in X-Device-Id and (optionally)
 * req.body.deviceId. Released builds today do not send either, so this returns
 * null and the device registry is skipped. When it returns a UUID, the factory
 * upserts UserDevice on login and refresh.
 */
function deviceIdFromRequest(req) {
  const fromBody = req.body && typeof req.body.deviceId === 'string' ? req.body.deviceId.trim() : '';
  const fromHeader = typeof req.get === 'function' ? (req.get('x-device-id') || '').trim() : '';
  const raw = fromBody || fromHeader || null;
  if (!raw) return null;
  return raw.slice(0, 64);
}

function ipFromRequest(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') return forwarded.split(',')[0].trim().slice(0, 45);
  return (req.ip || (req.connection && req.connection.remoteAddress) || null);
}

// Instantiate the factory for pharmacy. All options are wired so the exported
// functions behave exactly as they did before FND-06.
const service = createSessionService({
  repository,
  signAccess: signAccessToken,
  hashToken: defaultHashToken,
  refreshTtlDays: REFRESH_TTL_DAYS,
  audience: 'pharmacy',
});

// Preserve the pre-FND-06 return shape: refreshSession returns user/pharmacy DTOs.
async function refreshSession(rawRefreshToken, deviceInfo, opts = {}, meta = {}) {
  return service.refreshSession(rawRefreshToken, deviceInfo, {
    ...opts,
    userDto,
    pharmacyDto,
  }, meta);
}

async function getMe(userId) {
  return service.getMe(userId, { userDto, pharmacyDto });
}

module.exports = {
  startSession: service.startSession,
  refreshSession,
  logout: service.logout,
  revokeAllForUser: service.revokeAllForUser,
  getMe,
  deviceInfoFromRequest,
  signAccessToken,
  hashToken: defaultHashToken,
  userDto,
  pharmacyDto,
};