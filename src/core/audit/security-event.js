// src/core/audit/security-event.js
// security.record(event) - never throws into the caller (Doc 1 S5.2).
// Writes AuditEvent with kind='security'. Rate-limited to one event per
// (actorId + action) per 60 seconds, in memory, until FND-07 swaps in the
// AuthThrottle store.
//
// Also exposes security.notify(event), the stub hook for FND-12 (alerting).
// notify is a no-op with a console sink today.

const { record } = require('./record');

const FLOOD_WINDOW_MS = 60 * 1000;
const seen = new Map(); // key -> timestamp

function shouldSkip(action, actorId) {
  const key = `${action}:${actorId || 'anon'}`;
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < FLOOD_WINDOW_MS) return true;
  seen.set(key, now);
  // opportunistic prune so the map does not grow forever
  if (seen.size > 10_000) {
    for (const [k, t] of seen) if (now - t > FLOOD_WINDOW_MS) seen.delete(k);
  }
  return false;
}

function actorIdForFlood(event) {
  if (event.actorId != null) return String(event.actorId);
  if (event.entityId != null) return String(event.entityId);
  return 'anon';
}

async function record_(prisma, event) {
  if (!event || !event.action) return null;
  try {
    if (shouldSkip(event.action, actorIdForFlood(event))) return null;
    return await record(prisma, {
      ...event,
      kind: 'security',
      severity: event.severity || 'warning',
    });
  } catch (err) {
    // Never throw into the caller.
    // eslint-disable-next-line no-console
    console.error('security.record failed', {
      action: event.action,
      error: err && err.message,
    });
    return null;
  }
}

// Stub for FND-12. FND-12 will replace console.log with an outbox writer.
function notify(event) {
  // eslint-disable-next-line no-console
  console.log('security.notify', {
    action: event && event.action,
    severity: event && event.severity,
  });
  return null;
}

module.exports = { record: record_, notify };