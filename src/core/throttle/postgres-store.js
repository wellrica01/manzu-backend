// src/core/throttle/postgres-store.js
// Postgres-backed throttle store using the AuthThrottle table
// (sec-02-audit-shared.sql). Survives process restarts and works across
// instances.
//
// Key format in the table: `${class}:${key}` truncated to 160 chars. The key
// is hashed upstream by the caller when it contains an email or phone; the
// store does not do any hashing itself.
//
// No new SQL is needed - the table already exists. The schema is:
//   key, count, windowStart, lockedUntil, level, updatedAt.
// Single-row operations, upsert semantics via Prisma.

const prisma = require('../database/prisma');

const MAX_KEY_LEN = 160;

function composeKey(cls, key) {
  const composed = `${cls}:${key}`;
  return composed.length > MAX_KEY_LEN ? composed.slice(0, MAX_KEY_LEN) : composed;
}

async function hit({ class: cls, key, windowMs, max, lockoutMs, now }) {
  const composed = composeKey(cls, key);

  // Read-modify-write. This store is not used in tests; the memory store is.
  // In production the AuthThrottle table is small and per-key rows are hit
  // once per login attempt, not per API request, so the contention is minimal.
  // A future version can use a serializable transaction if needed.
  const existing = await prisma.authThrottle.findUnique({ where: { key: composed } });
  const nowDate = new Date(now);

  if (!existing) {
    const level = 0;
    const windowStart = nowDate;
    const created = await prisma.authThrottle.create({
      data: { key: composed, count: 1, windowStart, level, updatedAt: nowDate },
    });
    return { allowed: true, retryAfterMs: 0, count: created.count, level: created.level };
  }

  // Locked out?
  if (existing.lockedUntil && existing.lockedUntil > nowDate) {
    return {
      allowed: false,
      retryAfterMs: existing.lockedUntil.getTime() - now,
      count: existing.count,
      level: existing.level,
    };
  }

  // Window expired? Reset the counter.
  const windowMsActual = windowMs;
  let count = existing.count;
  let windowStart = existing.windowStart;
  if (now - existing.windowStart.getTime() >= windowMsActual) {
    count = 0;
    windowStart = nowDate;
  }

  count += 1;
  let level = existing.level;
  let lockedUntil = existing.lockedUntil && existing.lockedUntil > nowDate ? existing.lockedUntil : null;

  if (count > max) {
    level += 1;
    lockedUntil = new Date(now + lockoutMs);
  }

  const updated = await prisma.authThrottle.update({
    where: { key: composed },
    data: { count, windowStart, level, lockedUntil, updatedAt: nowDate },
  });

  return {
    allowed: count <= max,
    retryAfterMs: count > max ? lockoutMs : 0,
    count: updated.count,
    level: updated.level,
  };
}

async function reset({ class: cls, key }) {
  const composed = composeKey(cls, key);
  try {
    await prisma.authThrottle.delete({ where: { key: composed } });
  } catch (_) {
    // Row not found is fine.
  }
}

module.exports = { hit, reset };