// src/core/audit/record.js
// audit.record(tx, event) - the transactional writer.
// Reads the actor from currentActor() (FND-01), applies redaction, writes
// AuditEvent. Fail-closed per catalogue.FAIL_CLOSED, best-effort otherwise.
//
// Event shape:
//   { action, entityType, entityId?, before?, after?, outcome?, severity?,
//     visibility?, kind?, clientAt? }
//
// The `tx` argument must be a PrismaClient or a Prisma transaction client.
// There is no default: transactional audit is explicit by design.

const { currentActor, currentRequestId } = require('../context/actor-context');
const { redactFor } = require('./redact');
const { isFailClosed } = require('./catalogue');

const ACTOR_TYPE_VALUES = new Set(['pharmacy_user', 'admin', 'customer', 'bot', 'system']);
const OUTCOME_VALUES = new Set(['success', 'failure', 'denied']);
const SEVERITY_VALUES = new Set(['info', 'warning', 'error', 'critical']);

function buildRow(event) {
  const {
    action,
    entityType,
    entityId = null,
    before,
    after,
    outcome = 'success',
    severity = 'info',
    visibility = 'both',
    kind = 'audit',
    clientAt = null,
  } = event || {};

  if (!action || typeof action !== 'string') {
    throw new TypeError('audit.record: action is required and must be a string');
  }
  if (!entityType || typeof entityType !== 'string') {
    throw new TypeError('audit.record: entityType is required and must be a string');
  }
  if (!OUTCOME_VALUES.has(outcome)) {
    throw new TypeError(`audit.record: invalid outcome ${outcome}`);
  }
  if (!SEVERITY_VALUES.has(severity)) {
    throw new TypeError(`audit.record: invalid severity ${severity}`);
  }

  const actor = currentActor();
  const actorType = actor && ACTOR_TYPE_VALUES.has(actor.type) ? actor.type : 'system';

  const redacted = redactFor(action, before, after);

  return {
    action,
    kind,
    outcome,
    severity,
    visibility,
    actorType,
    actorId: actor && actor.id != null ? String(actor.id) : null,
    actorRole: actor && actor.role ? String(actor.role).slice(0, 24) : null,
    actorLabel: actor && actor.label ? String(actor.label).slice(0, 120) : null,
    pharmacyId: actor && actor.pharmacyId != null ? actor.pharmacyId : null,
    entityType,
    entityId: entityId != null ? String(entityId).slice(0, 64) : null,
    before: redacted.before,
    after: redacted.after,
    sessionId: actor && actor.sessionId ? String(actor.sessionId).slice(0, 36) : null,
    deviceId: actor && actor.deviceId ? String(actor.deviceId).slice(0, 64) : null,
    ip: actor && actor.ip ? String(actor.ip).slice(0, 45) : null,
    userAgent: actor && actor.userAgent ? String(actor.userAgent).slice(0, 300) : null,
    requestId: currentRequestId() || null,
    clientAt,
  };
}

// Transactional writer. Callers inside a $transaction pass tx.
// If the action is fail-closed, this throws on write error and the caller's
// transaction rolls back (Doc 1 S5.2).
async function record(tx, event) {
  if (!tx || !tx.auditEvent || typeof tx.auditEvent.create !== 'function') {
    throw new TypeError('audit.record: tx must be a Prisma client or transaction client');
  }

  const row = buildRow(event);

  if (isFailClosed(row.action)) {
    // Fail-closed: throw, caller's transaction rolls back.
    return tx.auditEvent.create({ data: row });
  }

  // Best-effort: a failed audit write must not break the main flow.
  try {
    return await tx.auditEvent.create({ data: row });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('audit.record (best-effort) failed', {
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      error: err && err.message,
    });
    return null;
  }
}

module.exports = { record, buildRow };