// src/core/throttle/index.js
// The throttle interface (Doc 1 S5.3). One function, two implementations:
//
//   throttle.hit({ class, key, windowMs, max, lockoutMinutes? })
//     -> { allowed: boolean, retryAfterMs: number, level: number, count: number }
//
// The store is selected by env: THROTTLE_STORE=memory|postgres.
// Default is memory (used in tests and local development). Production sets
// THROTTLE_STORE=postgres; the AuthThrottle table already exists (sec-02).
//
// The interface is deliberately tiny. Any call site that wants to count
// failures, block a key, or check whether a key is currently locked out calls
// hit() and reads the result. The store owns the state.

const memoryStore = require('./memory-store');
const postgresStore = require('./postgres-store');

function pickStore() {
  const name = String(process.env.THROTTLE_STORE || 'memory').toLowerCase();
  if (name === 'postgres') return postgresStore;
  return memoryStore;
}

/**
 * Count one hit for this key inside the window.
 * Returns the current state and whether this hit is allowed.
 *
 * opts:
 *   class       - 'login' | 'stepup' | 'pin_change' | 'team' | ...
 *   key         - the identifier (email, user id, ip, hashed email...)
 *   windowMs    - the observation window
 *   max         - the max hits inside the window before denying
 *   lockoutMinutes - if set, once denied, the key stays locked out for this long
 *
 * Returns:
 *   allowed       - true if the caller may proceed
 *   retryAfterMs  - if not allowed, ms until the caller may retry (0 otherwise)
 *   count         - how many hits are currently in the window
 *   level         - how many times this key has been locked out (0, 1, ...)
 */
async function hit(opts) {
  const store = pickStore();
  if (!opts || !opts.class || !opts.key) {
    throw new TypeError('throttle.hit: class and key are required');
  }
  const windowMs = Number(opts.windowMs) > 0 ? Number(opts.windowMs) : 15 * 60 * 1000;
  const max = Number(opts.max) > 0 ? Number(opts.max) : 5;
  const lockoutMs = Number(opts.lockoutMinutes) > 0 ? Number(opts.lockoutMinutes) * 60 * 1000 : windowMs;
  return store.hit({
    class: opts.class,
    key: opts.key,
    windowMs,
    max,
    lockoutMs,
    now: Date.now(),
  });
}

async function reset(opts) {
  const store = pickStore();
  if (!opts || !opts.class || !opts.key) return;
  await store.reset({ class: opts.class, key: opts.key });
}

module.exports = { hit, reset };