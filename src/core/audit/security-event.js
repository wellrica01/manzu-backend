// src/core/audit/security-event.js
// security.record(event) - never throws into the caller (Doc 1 S5.2).
// Writes AuditEvent with kind='security'. Rate-limited to one event per
// (actorId + action) per 60 seconds, in memory, until FND-07 swaps in the
// AuthThrottle store (already did, but this layer is independent).
//
// security.notify(event) - FND-12. Sends an alert when severity is 'critical'.
// Console sink always; Sentry sink via reportError when Sentry is configured.
// Rate-limited per (action, entityId) per 15 minutes so a burst does not flood
// Sentry. Never throws.
//
// When Guide B lands (outbox), notify is where the outbox write goes in; today
// it calls reportError directly.

const { record } = require('./record');
const { reportError, ErrorLevel, ErrorCategory } = require('../../utils/error-reporter');

const FLOOD_WINDOW_MS = 60 * 1000;
const seen = new Map(); // key -> timestamp

const ALERT_WINDOW_MS = 15 * 60 * 1000;
const alerted = new Map(); // key -> timestamp

function shouldSkip(action, actorId) {
  const key = `${action}:${actorId || 'anon'}`;
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < FLOOD_WINDOW_MS) return true;
  seen.set(key, now);
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

function alertKey(event) {
  return `${event.action || 'unknown'}:${event.entityId != null ? event.entityId : 'none'}`;
}

function shouldAlertNow(event) {
  const key = alertKey(event);
  const now = Date.now();
  const last = alerted.get(key);
  if (last && now - last < ALERT_WINDOW_MS) return false;
  alerted.set(key, now);
  if (alerted.size > 5_000) {
    for (const [k, t] of alerted) if (now - t > ALERT_WINDOW_MS) alerted.delete(k);
  }
  return true;
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
    console.error('security.record failed', {
      action: event.action,
      error: err && err.message,
    });
    return null;
  }
}

// Map the security event's category to the error-reporter categories we have.
function categoryFor(event) {
  if (event.category === 'RATE_LIMIT') return ErrorCategory.RATE_LIMIT;
  if (event.category === 'PAYMENT') return ErrorCategory.PAYMENT;
  // Default: auth-related security events group with auth.
  return ErrorCategory.AUTH;
}

/**
 * FND-12: send an alert for a critical security event.
 * Console sink always; Sentry sink via reportError when Sentry is configured.
 * Rate-limited per (action, entityId) per 15 minutes.
 *
 * Safe to call from inside a request or a job. Never throws. Never blocks the
 * caller - all work is synchronous or fire-and-forget.
 */
function notify(event) {
  if (!event || !event.action) return null;

  console.log('security.notify', {
    action: event.action,
    severity: event.severity,
    entityType: event.entityType,
    entityId: event.entityId,
  });

  if (event.severity !== 'critical') return null;

  if (!shouldAlertNow(event)) {
    return null;
  }

  try {
    const alertError = new Error(`Security alert: ${event.action}`);
    alertError.name = 'SecurityAlert';
    reportError(alertError, {
      level: ErrorLevel.CRITICAL,
      category: categoryFor(event),
      customContext: {
        securityAction: event.action,
        securityEntityType: event.entityType,
        securityEntityId: event.entityId,
        securitySeverity: event.severity,
        after: event.after,
      },
    });
  } catch (err) {
    console.error('security.notify -> reportError failed', { message: err && err.message });
  }
  return null;
}

module.exports = { record: record_, notify };