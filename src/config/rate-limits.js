// src/config/rate-limits.js
//
// FND-07b1: rate limits are now declared as per-class settings consumed by the
// throttle interface (src/core/throttle). The middleware in
// middleware/rate-limiting.js reads these and calls throttle.hit.
//
// The comment/max mismatch from SEC-31 is fixed here: the general API tier is
// 1000 requests per 15 minutes (was `max: 1000` but commented "100 requests").

const RATE_LIMITS = {
  // General API tier: every request to /api counts.
  api: {
    class: 'read',
    windowMs: 15 * 60 * 1000,
    max: 1000,
    lockoutMinutes: 15,
    countAll: true,
  },

  // Login IP bucket: 30 attempts per 15 min, keyed on the client IP.
  // Doc 2 section 5.4: successful logins do NOT reset this counter (an
  // attacker interleaving a real login must not reset it). The per-account
  // ladder (5 / 8 / 12 failures, notify at 8, alert at 12) lives on the
  // PharmacyUser row in pharmacy-auth.service.js.
  auth_ip: {
    class: 'auth_ip',
    windowMs: 15 * 60 * 1000,
    max: 30,
    lockoutMinutes: 15,
    countAll: true,
  },

  // Session endpoints (refresh / logout). Separate from auth: a stale token
  // must not eat the login attempt budget.
  session: {
    class: 'read',
    windowMs: 15 * 60 * 1000,
    max: 300,
    lockoutMinutes: 15,
    countAll: true,
  },

  // Checkout: expensive, abuse-prone.
  checkout: {
    class: 'sale',
    windowMs: 60 * 60 * 1000,
    max: 10,
    lockoutMinutes: 60,
    countAll: true,
  },

  // Register: a distinct class from 'login', so login attempts do not consume
  // the registration budget and vice versa. That is the SEC-03 counting fix:
  // the old authLimiter counted every /api/auth request against a single
  // bucket. Higher max than login: legitimate users register once; bots do
  // not. FND-07b3.
  register: {
    class: 'register',
    windowMs: 60 * 60 * 1000,
    max: 10,
    lockoutMinutes: 60,
    countAll: true,
  },
};

// Class names referenced across the codebase. Listed here so a reader can see
// the whole set; Doc 2 sets the per-class numbers when it lands.
const CLASSES = Object.freeze([
  'login',
  'auth_ip',
  'stepup',
  'pin_change',
  'team',
  'export',
  'bank_verify',
  'bank_update',
  'sale',
  'void',
  'stock_adjust',
  'price_edit',
  'bulk',
  'read',
]);

module.exports = {
  RATE_LIMITS,
  CLASSES,
  // Backwards-compatible named exports. app.js does not import these directly,
  // but keeping them avoids a search-and-replace in the future.
  API_RATE_LIMIT: RATE_LIMITS.api,
  AUTH_RATE_LIMIT: RATE_LIMITS.auth_ip,
  SESSION_RATE_LIMIT: RATE_LIMITS.session,
  CHECKOUT_RATE_LIMIT: RATE_LIMITS.checkout,
  REGISTER_RATE_LIMIT: RATE_LIMITS.register,
};