// src/middleware/rate-limiting.js
//
// FND-07b1: the four limiter middlewares now go through the throttle interface
// (src/core/throttle) instead of express-rate-limit. Same names, same mounts in
// app.js. On denial: 429, Retry-After header, RATE_LIMITED code (FND-02), and a
// security.rate_limited event (FND-03).
//
// The key for each limiter is either the client IP (for API, session, checkout)
// or the user (for auth, once authenticated - but auth is pre-auth so it uses IP).

const { RATE_LIMITS } = require('../config/rate-limits');
const throttle = require('../core/throttle');
const { sendError } = require('../core/errors/send-error');
const security = require('../core/audit/security-event');
const prisma = require('../core/database/prisma');

function clientKey(req) {
  return req.ip || req.headers['x-forwarded-for'] || 'unknown';
}

async function applyLimit(req, res, next, config, keyFn) {
  try {
    const result = await throttle.hit({
      class: config.class,
      key: keyFn(req),
      windowMs: config.windowMs,
      max: config.max,
      lockoutMinutes: config.lockoutMinutes,
    });

    if (result.allowed) return next();

    const retrySeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retrySeconds));

    // Fire-and-forget security event; never block the 429 on it.
    security.record(prisma, {
      action: 'security.rate_limited',
      entityType: 'Auth',
      entityId: config.class,
      severity: 'warning',
      after: { class: config.class, retryAfterSeconds: retrySeconds, level: result.level },
    }).catch(() => {});

    return sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.', {
      retryAfterSeconds: retrySeconds,
    });
  } catch (err) {
    // Throttle store failed (e.g. Postgres down). Never let that take the
    // whole API down - fail open on the throttle, but log.
    console.error('throttle error, failing open:', { message: err.message, class: config.class });
    return next();
  }
}

function apiLimiter(req, res, next) {
  return applyLimit(req, res, next, RATE_LIMITS.api, clientKey);
}

function authLimiter(req, res, next) {
  return applyLimit(req, res, next, RATE_LIMITS.auth, clientKey);
}

function sessionLimiter(req, res, next) {
  return applyLimit(req, res, next, RATE_LIMITS.session, clientKey);
}

function checkoutLimiter(req, res, next) {
  return applyLimit(req, res, next, RATE_LIMITS.checkout, clientKey);
}

console.log('Rate limiting configured:');
console.log(`  - General API: ${RATE_LIMITS.api.max} requests / ${RATE_LIMITS.api.windowMs / 60000} min`);
console.log(`  - Authentication: ${RATE_LIMITS.auth.max} attempts / ${RATE_LIMITS.auth.windowMs / 60000} min`);
console.log(`  - Session: ${RATE_LIMITS.session.max} requests / ${RATE_LIMITS.session.windowMs / 60000} min`);
console.log(`  - Checkout: ${RATE_LIMITS.checkout.max} attempts / ${RATE_LIMITS.checkout.windowMs / 60000 / 60} hour`);

module.exports = {
  apiLimiter,
  authLimiter,
  sessionLimiter,
  checkoutLimiter,
};