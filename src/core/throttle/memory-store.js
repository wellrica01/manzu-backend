// src/core/throttle/memory-store.js
// In-memory throttle store. Fast, no dependencies, resets on process restart.
// Used in tests and local development. Production sets THROTTLE_STORE=postgres.
//
// Key format: `${class}:${key}`. Single Map, pruned opportunistically.

const STORE = new Map();
const PRUNE_THRESHOLD = 10_000;

function composeKey(cls, key) {
  return `${cls}:${key}`;
}

function pruneIfNeeded(now) {
  if (STORE.size <= PRUNE_THRESHOLD) return;
  for (const [k, v] of STORE) {
    if ((v.lockedUntil && v.lockedUntil <= now) || (!v.lockedUntil && now - v.windowStart > v.windowMs)) {
      STORE.delete(k);
    }
  }
}

async function hit({ class: cls, key, windowMs, max, lockoutMs, now }) {
  const composed = composeKey(cls, key);
  let state = STORE.get(composed);
  if (!state) {
    state = { windowStart: now, windowMs, count: 0, level: 0, lockedUntil: 0 };
    STORE.set(composed, state);
  }

  // If currently locked out, deny without incrementing.
  if (state.lockedUntil && state.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterMs: state.lockedUntil - now,
      count: state.count,
      level: state.level,
    };
  }

  // Expired window: reset.
  if (now - state.windowStart >= state.windowMs) {
    state.windowStart = now;
    state.count = 0;
  }

  // Lockout expired: clear it, bump level.
  if (state.lockedUntil && state.lockedUntil <= now) {
    state.lockedUntil = 0;
  }

  state.count += 1;

  if (state.count > max) {
    state.level += 1;
    state.lockedUntil = now + lockoutMs;
    pruneIfNeeded(now);
    return {
      allowed: false,
      retryAfterMs: lockoutMs,
      count: state.count,
      level: state.level,
    };
  }

  pruneIfNeeded(now);
  return { allowed: true, retryAfterMs: 0, count: state.count, level: state.level };
}

async function reset({ class: cls, key }) {
  STORE.delete(composeKey(cls, key));
}

function _resetAll() {
  STORE.clear();
}

module.exports = { hit, reset, _resetAll };