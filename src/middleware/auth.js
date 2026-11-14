// auth.js - FND-05b3
//
// Changes from pre-FND-05:
//   authenticate() is now DB-validating. It does:
//     1. Bearer token extraction (unchanged)
//     2. HS256 signature verification (uses getSecretFor(audience), falls
//        back to JWT_SECRET for legacy tokens without iss)
//     3. iss/aud check for new tokens only (legacy tokens have no iss)
//     4. One SQL round-trip via prisma.$queryRaw that joins the user, the
//        pharmacy, and the refresh-token family in one statement
//     5. Status checks: account locked, account suspended, pharmacy suspended,
//        family revoked (only when sid is present), tokenVersion mismatch
//        (only when tv is present), PIN change required
//     6. req.user populated with the actor fields; req.user.id is aliased
//        from userId (pharmacy) or adminId (admin) for one release (SEC-11)
//     7. Actor context seeded via runWithContext so downstream middlewares
//        (requireCapability, audit.record, security.record) read the actor
//        from currentActor() without touching req
//
// Env:
//   SEC_ENFORCE      off | log | enforce  (default 'off')
//   SEC_ENFORCE_GROUPS  per-capability-group overrides
//
// Behaviour by mode:
//   off      - no DB check, no status check. This is what ships in the first
//              deploy of FND-05b3 so the mobile app keeps working while we
//              verify logs. authenticate() reverts to signature-only.
//   log      - DB check runs; a would-be denial writes a security event and
//              lets the request through. Use this for the 24-hour watch
//              between FND-05b3 deploy and the enforce flip.
//   enforce  - DB check runs; a denial returns the new 401/403 codes via
//              sendError. This is the target state.
//
// Because SEC_ENFORCE defaults to 'off', this commit is behaviour-neutral
// until the first deploy sets SEC_ENFORCE=log.

const jwt = require('jsonwebtoken');
const { getSecretFor } = require('../utils/env-validator');
const { sendError } = require('../core/errors/send-error');
const { runWithContext } = require('../core/context/actor-context');
const security = require('../core/audit/security-event');

const prisma = require('../core/database/prisma');

// Placeholder logger; replace with Winston, Pino, or another logger in production
const logger = {
  info: console.log,
  error: console.error,
};

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'SUPPORT']);

function mode() {
  return (process.env.SEC_ENFORCE || 'off').toLowerCase();
}

// ---------------------------------------------------------------------------
// Token decoding and verification
// ---------------------------------------------------------------------------

function extractBearer(req) {
  const header = req.headers && req.headers.authorization;
  if (!header) return { error: 'NO_TOKEN', message: 'No token provided' };
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return { error: 'INVALID_FORMAT', message: 'Authorization header must be in Bearer token format' };
  }
  return { token };
}

// Decodes the token unverified so we know its audience before choosing a
// secret. Safe: verify() runs immediately after.
function peekClaims(token) {
  try {
    return jwt.decode(token, { complete: false }) || {};
  } catch (_) {
    return {};
  }
}

// Chooses the verification secret. Legacy tokens (no iss) verify with
// JWT_SECRET for the one-lifetime transition. New tokens verify with the
// audience-specific secret, which falls back to JWT_SECRET in Phase 1.
function verificationSecret(claims) {
  if (!claims || !claims.iss) return process.env.JWT_SECRET;
  const audience = claims.aud;
  if (audience === 'pharmacy') return getSecretFor('pharmacy');
  if (audience === 'admin') return getSecretFor('admin');
  // Unknown audience: treat as legacy and hope JWT_SECRET is the right key.
  // The subsequent aud check below will refuse the token if it claims an
  // audience we do not recognise.
  return process.env.JWT_SECRET;
}

function verifyToken(token) {
  const claims = peekClaims(token);
  const secret = verificationSecret(claims);
  if (!secret) {
    return { error: 'INVALID_TOKEN', message: 'No signing secret configured' };
  }
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return { decoded, legacy: !decoded.iss };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { error: 'TOKEN_EXPIRED', message: 'Token expired' };
    }
    return { error: 'INVALID_TOKEN', message: 'Invalid token' };
  }
}

// New tokens must carry iss=manzu and aud=pharmacy or aud=admin. Legacy
// tokens skip this check for one lifetime.
function checkAudience(decoded, expectedAudience) {
  if (!decoded.iss) return null; // legacy
  if (decoded.iss !== 'manzu') return { error: 'INVALID_TOKEN', message: 'Invalid issuer' };
  if (decoded.aud !== expectedAudience) return { error: 'INVALID_TOKEN', message: 'Invalid audience' };
  return null;
}

// ---------------------------------------------------------------------------
// Database lookup
// ---------------------------------------------------------------------------

// One SQL statement, one round-trip. Returns the state the guard needs.
// For a pharmacy token:
//   - user status, tokenVersion, mustChangePin, role, pharmacyId
//   - pharmacy status, isActive
//   - whether the family named by sid is still alive (null sid -> skip)
async function loadPharmacyActor(userId, sid) {
  const rows = await prisma.$queryRaw`
    SELECT
      u.id                         AS user_id,
      u.status                     AS user_status,
      u."tokenVersion"             AS token_version,
      u."mustChangePin"            AS must_change_pin,
      u.role                       AS role,
      u."pharmacyId"               AS pharmacy_id,
      u."lockedUntil"              AS locked_until,
      p.status                     AS pharmacy_status,
      p."isActive"                 AS pharmacy_is_active,
      CASE
        WHEN ${sid}::text IS NULL THEN true
        ELSE EXISTS (
          SELECT 1 FROM "PharmacyRefreshToken"
          WHERE "familyId" = ${sid} AND "userId" = u.id AND "revokedAt" IS NULL
        )
      END                          AS family_alive
    FROM "PharmacyUser" u
    JOIN "Pharmacy" p ON p.id = u."pharmacyId"
    WHERE u.id = ${userId}::int
    LIMIT 1
  `;
  return rows[0] || null;
}

async function loadAdminActor(adminId, sid) {
  const rows = await prisma.$queryRaw`
    SELECT
      a.id                         AS admin_id,
      a.role                       AS role,
      a."disabledAt"               AS disabled_at,
      a."lockedUntil"              AS locked_until,
      a."tokenVersion"             AS token_version,
      CASE
        WHEN ${sid}::text IS NULL THEN true
        ELSE EXISTS (
          SELECT 1 FROM "AdminRefreshToken"
          WHERE "familyId" = ${sid} AND "adminId" = a.id AND "revokedAt" IS NULL
        )
      END                          AS family_alive
    FROM "AdminUser" a
    WHERE a.id = ${adminId}::int
    LIMIT 1
  `;
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Denial handling
// ---------------------------------------------------------------------------

// In 'off' mode: everything passes, no DB lookup happens (see authenticate).
// In 'log' mode: denial logged, request passes.
// In 'enforce' mode: denial returned with the shared error contract.
function deny(req, res, code, message, extra) {
  const current = mode();
  if (current === 'enforce') {
    return sendError(res, httpStatusFor(code), code, message, extra);
  }
  // 'log' mode: record and continue. Never block on logging failures.
  security.record(prisma, {
    action: 'security.capability.denied',
    entityType: 'Auth',
    entityId: code,
    severity: 'warning',
    after: { code, path: req.path, method: req.method },
  }).catch(() => {});
  return null; // caller calls next()
}

function httpStatusFor(code) {
  switch (code) {
    case 'ACCOUNT_LOCKED':
    case 'ACCOUNT_SUSPENDED':
    case 'PHARMACY_SUSPENDED':
    case 'PIN_CHANGE_REQUIRED':
      return 403;
    case 'SESSION_REVOKED':
    case 'TOKEN_EXPIRED':
    case 'INVALID_TOKEN':
    case 'NO_TOKEN':
    case 'INVALID_FORMAT':
    case 'UNAUTHENTICATED':
      return 401;
    default:
      return 401;
  }
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

async function authenticate(req, res, next) {
  const current = mode();

  // Fast path: SEC_ENFORCE=off. Signature-only, exactly as before FND-05.
  // Nothing below runs, so existing behaviour (and existing tests) are
  // unchanged until a deploy flips SEC_ENFORCE to 'log'.
  if (current === 'off') {
    const { token, error, message } = extractBearer(req);
    if (error) return sendError(res, httpStatusFor(error), error, message);
    const verify = verifyToken(token);
    if (verify.error) return sendError(res, httpStatusFor(verify.error), verify.error, verify.message);
    // Legacy token during SEC_ENFORCE=off gets exactly the old behaviour:
    // claims on req.user, no alias. When we move to 'log' below, the alias
    // appears; when we move to 'enforce', the DB checks appear.
    req.user = verify.decoded;
    return next();
  }

  const { token, error, message } = extractBearer(req);
  if (error) return sendError(res, httpStatusFor(error), error, message);

  const verify = verifyToken(token);
  if (verify.error) return sendError(res, httpStatusFor(verify.error), verify.error, verify.message);

  const decoded = verify.decoded;

  // Audience check: pharmacy tokens are aud=pharmacy, admin are aud=admin.
  // We infer the token type from which claim is present, then check aud
  // matches. Legacy tokens skip.
  const isPharmacyClaim = decoded.userId != null && decoded.adminId == null;
  const isAdminClaim = decoded.adminId != null && decoded.userId == null;
  if (!isPharmacyClaim && !isAdminClaim) {
    return deny(req, res, 'INVALID_TOKEN', 'Token missing user or admin identity') || next();
  }
  const expectedAud = isPharmacyClaim ? 'pharmacy' : 'admin';
  const audError = checkAudience(decoded, expectedAud);
  if (audError) return deny(req, res, audError.error, audError.message) || next();

  // Load the actor state. One round-trip.
  let row;
  try {
    row = isPharmacyClaim
      ? await loadPharmacyActor(decoded.userId, decoded.sid || null)
      : await loadAdminActor(decoded.adminId, decoded.sid || null);
  } catch (err) {
    // Database unavailable. Do NOT fail open. In log mode we still let the
    // request through (the point of log mode is to observe, not enforce);
    // in enforce mode we deny.
    logger.error('authenticate: DB lookup failed', { message: err.message });
    if (current === 'enforce') {
      return sendError(res, 503, 'SERVER_ERROR', 'Authentication service unavailable');
    }
    req.user = decoded;
    return next();
  }

  if (!row) {
    return deny(req, res, isPharmacyClaim ? 'SESSION_REVOKED' : 'UNAUTHENTICATED',
      'Account no longer exists') || next();
  }

  // Lock and status checks, in order.
  const now = new Date();
  if (row.locked_until && new Date(row.locked_until) > now) {
    return deny(req, res, 'ACCOUNT_LOCKED', 'Account locked') || next();
  }
  if (isPharmacyClaim) {
    if (row.user_status && row.user_status !== 'ACTIVE' && row.user_status !== 'INVITED') {
      return deny(req, res, 'ACCOUNT_SUSPENDED', 'Account suspended') || next();
    }
    // Pharmacy.status in this codebase is a workflow state (PENDING / VERIFIED /
    // SUSPENDED), not a permission. isActive is the operational flag: a
    // SUSPENDED pharmacy has isActive=false, a PENDING one does not. Checking
    // status !== 'ACTIVE' would 403 every pharmacy in production today
    // (5 VERIFIED + 2 PENDING), which is why the check is on isActive only.
    if (row.pharmacy_is_active === false) {
      return deny(req, res, 'PHARMACY_SUSPENDED', 'Pharmacy suspended') || next();
    }
  } else {
    if (row.disabled_at) {
      return deny(req, res, 'ACCOUNT_SUSPENDED', 'Admin account disabled') || next();
    }
  }

  // Family revocation check (only for tokens carrying sid).
  if (decoded.sid && row.family_alive === false) {
    return deny(req, res, 'SESSION_REVOKED', 'Session ended') || next();
  }

  // tokenVersion check (only for tokens carrying tv).
  if (decoded.tv != null && Number(decoded.tv) !== Number(row.token_version ?? 0)) {
    return deny(req, res, 'SESSION_REVOKED', 'Session ended') || next();
  }

  // PIN change required: block everything except /auth/change-password,
  // /auth/me, /auth/logout.
  if (isPharmacyClaim && row.must_change_pin) {
    const exempt = new Set(['/api/auth/change-password', '/api/auth/me', '/api/auth/logout']);
    if (!exempt.has(req.path)) {
      return deny(req, res, 'PIN_CHANGE_REQUIRED', 'PIN change required') || next();
    }
  }

  // Build the actor. req.user keeps the legacy shape plus the alias plus the
  // new claims, so the pre-FND-05 routes and the post-FND-05 routes both
  // work without a rewrite.
  const actor = isPharmacyClaim
    ? {
        type: 'pharmacy_user',
        userId: decoded.userId,
        id: decoded.userId, // SEC-11 alias
        pharmacyId: decoded.pharmacyId,
        role: row.role || decoded.role,
        sid: decoded.sid || null,
        tv: decoded.tv ?? null,
        client: decoded.client || null,
      }
    : {
        type: 'admin',
        adminId: decoded.adminId,
        id: decoded.adminId, // SEC-11 alias
        role: row.role || decoded.role,
        sid: decoded.sid || null,
        tv: decoded.tv ?? null,
        client: decoded.client || null,
      };

  req.user = actor;

  // Seed the AsyncLocalStorage context. Downstream middlewares
  // (requireCapability, audit.record, security.record) can read
  // currentActor() without touching req.
  runWithContext(
    {
      requestId: req.requestId,
      actor: {
        type: actor.type,
        id: actor.type === 'pharmacy_user' ? actor.userId : actor.adminId,
        pharmacyId: actor.pharmacyId,
        role: actor.role,
        sessionId: actor.sid,
        deviceId: req.headers['x-device-id'] || null,
        ip: req.ip,
        userAgent: (req.headers['user-agent'] || '').slice(0, 300),
        label: null,
      },
    },
    () => next()
  );
}

// ---------------------------------------------------------------------------
// Unchanged helpers (kept byte-identical to pre-FND-05b3)
// ---------------------------------------------------------------------------

function isAdminToken(user) {
  return Boolean(user && user.adminId && !user.pharmacyId);
}

function isPharmacyToken(user) {
  return Boolean(user && user.userId && user.pharmacyId && !user.adminId);
}

function hasRole(user, allowedRoles) {
  if (!user || !allowedRoles.includes(user.role)) return false;
  return ADMIN_ROLES.has(user.role) ? isAdminToken(user) : isPharmacyToken(user);
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!hasRole(req.user, allowedRoles)) {
      logger.error('Authorization failed: Insufficient permissions', { userId: req.user?.userId, adminId: req.user?.adminId, role: req.user?.role });
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have permission to perform this action' });
    }
    next();
  };
}

function requireTokenType(check, label) {
  return (req, res, next) => {
    if (!check(req.user)) {
      logger.error(`Authorization failed: ${label} token required`, { userId: req.user?.userId, adminId: req.user?.adminId });
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have permission to perform this action' });
    }
    next();
  };
}

const authenticatePharmacy = [authenticate, requireTokenType(isPharmacyToken, 'Pharmacy')];
const authenticateAdmin = [authenticate, requireTokenType(isAdminToken, 'Admin')];

module.exports = { authenticate, authenticatePharmacy, authenticateAdmin, authorizeRoles };