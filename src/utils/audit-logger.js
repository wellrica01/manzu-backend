/**
 * Centralized Audit Logging Utility (FND-03c shim)
 *
 * Kept as the public entry point so the 13 existing call sites and 8 imports
 * across the codebase do not need to change. Internally delegates to
 * src/core/audit/record.js, which writes to the append-only AuditEvent table.
 *
 * Behaviour preserved from the pre-FND-03 version:
 *   - Same createAuditLog({ action, entityType, entityId, userId, details,
 *     ipAddress, userAgent, tx }) signature.
 *   - Same exported constants (AUDIT_ACTIONS, ENTITY_TYPES) and helpers
 *     (auditFromRequest, queryAuditLogs, getAuditTrail, getIpAddress,
 *     getUserAgent).
 *   - Same return-null-on-error behaviour for callers that are not on the
 *     fail-closed set (core/audit/catalogue.js). Fail-closed actions throw
 *     and roll back the caller's transaction (Doc 1 S5.2).
 *
 * Deliberate changes from pre-FND-03:
 *   - No `new PrismaClient()` at module load (NEW-02: 25 stray clients). The
 *     shim uses the shared client, and the caller's tx when one is passed.
 *   - `details` is translated to the AuditEvent `after` column and runs
 *     through core/audit/redact.js. A call passing
 *     details: { accountNumber } becomes accountNumberLast4 in `after`
 *     (SEC-17). The full account number can no longer reach the row.
 *   - Actor resolution: (1) currentActor() from the request context wins,
 *     (2) the userId argument is used as an actor override when there is no
 *     context, (3) 'system'. This keeps audit rows populated for the 13
 *     pre-FND-05 service call sites (SEC-14), and closes automatically once
 *     FND-05 wires the request context - the userId argument becomes
 *     irrelevant at that point.
 *   - queryAuditLogs and getAuditTrail still read the legacy AuditLog table.
 *     The audit viewer in Doc 3 will read AuditEvent; the read side is not
 *     part of this PR.
 */

const sharedPrisma = require('../core/database/prisma');
const { record } = require('../core/audit/record');
const { currentActor } = require('../core/context/actor-context');

/**
 * Audit Actions Enum - unchanged; the same values the old module exported.
 * The canonical catalogue lives in src/core/audit/catalogue.js; this object
 * is kept so 4 services that read AUDIT_ACTIONS.* keep working unchanged.
 */
const AUDIT_ACTIONS = {
  // Order Actions
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_UPDATED: 'ORDER_UPDATED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_COMPLETED: 'ORDER_COMPLETED',

  // Payment Actions
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',

  // Refund Actions
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  REFUND_APPROVED: 'REFUND_APPROVED',
  REFUND_REJECTED: 'REFUND_REJECTED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  REFUND_FAILED: 'REFUND_FAILED',

  // Prescription Actions
  PRESCRIPTION_UPLOADED: 'PRESCRIPTION_UPLOADED',
  PRESCRIPTION_VERIFIED: 'PRESCRIPTION_VERIFIED',
  PRESCRIPTION_REJECTED: 'PRESCRIPTION_REJECTED',
  PRESCRIPTION_EXPIRED: 'PRESCRIPTION_EXPIRED',

  // Stock Actions
  STOCK_RESERVED: 'STOCK_RESERVED',
  STOCK_RELEASED: 'STOCK_RELEASED',
  STOCK_UPDATED: 'STOCK_UPDATED',

  // Pharmacy Actions
  PHARMACY_ORDER_ACCEPTED: 'PHARMACY_ORDER_ACCEPTED',
  PHARMACY_ORDER_REJECTED: 'PHARMACY_ORDER_REJECTED',
  PHARMACY_ORDER_FULFILLED: 'PHARMACY_ORDER_FULFILLED',

  // Admin Actions
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  ADMIN_LOGOUT: 'ADMIN_LOGOUT',
  ADMIN_ACTION: 'ADMIN_ACTION',
};

/**
 * Entity Types Enum - unchanged.
 */
const ENTITY_TYPES = {
  ORDER: 'Order',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
  PRESCRIPTION: 'Prescription',
  STOCK: 'Stock',
  PHARMACY: 'Pharmacy',
  USER: 'User',
  ADMIN: 'Admin',
};

/**
 * Create an audit log entry. Signature unchanged.
 */
async function createAuditLog({
  action,
  entityType,
  entityId,
  before = null,
  userId = null,
  details = {},
  ipAddress = null,
  userAgent = null,
  tx = null,
}) {
  try {
    const client = tx || sharedPrisma;

    // Legacy-services actor fallback: when the caller only has userId (pre-FND-05
    // service call sites), pass it as an explicit actor override so the row is
    // attributable. When the request context has an actor, currentActor() wins
    // inside record() and the override is ignored by buildRow's precedence.
    const hasContext = Boolean(currentActor());
    const options = !hasContext && userId != null
      ? { actor: { type: 'pharmacy_user', id: String(userId) } }
      : undefined;

    const hasDetails = details && Object.keys(details).length > 0;
    const event = {
      action,
      entityType,
      entityId,
      after: hasDetails ? details : undefined,
      before: before || undefined,
      ip: ipAddress || undefined,
      userAgent: userAgent || undefined,
    };

    return await record(client, event, options);
  } catch (error) {
    // Fail-closed actions have already thrown by here; this catch only fires
    // for best-effort actions and unexpected errors in the shim itself.
    console.error('Failed to create audit log:', {
      action,
      entityType,
      entityId,
      error: error && error.message,
    });
    return null;
  }
}

/**
 * Extract IP address from request.
 */
function getIpAddress(req) {
  return req.ip ||
         req.headers['x-forwarded-for']?.split(',')[0] ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         null;
}

/**
 * Extract user agent from request.
 */
function getUserAgent(req) {
  return req.headers['user-agent']?.substring(0, 500) || null;
}

/**
 * Create audit log from Express request. Kept for compatibility.
 * Uses req.user if present; when FND-05 wires the context, the context wins.
 */
async function auditFromRequest(req, params) {
  return createAuditLog({
    ...params,
    ipAddress: getIpAddress(req),
    userAgent: getUserAgent(req),
    userId: req.user?.id || req.userId || null,
  });
}

/**
 * Query audit logs with filters. Reads the legacy AuditLog table.
 * The audit viewer in Doc 3 will read AuditEvent.
 */
async function queryAuditLogs({
  entityType = null,
  entityId = null,
  action = null,
  userId = null,
  startDate = null,
  endDate = null,
  limit = 100,
  offset = 0,
}) {
  const where = {};

  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (action) where.action = action;
  if (userId) where.userId = userId;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  return sharedPrisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

/**
 * Get audit trail for a specific entity. Reads the legacy AuditLog table.
 */
async function getAuditTrail(entityType, entityId) {
  return sharedPrisma.auditLog.findMany({
    where: {
      entityType,
      entityId,
    },
    orderBy: { createdAt: 'asc' },
  });
}

module.exports = {
  createAuditLog,
  auditFromRequest,
  queryAuditLogs,
  getAuditTrail,
  getIpAddress,
  getUserAgent,
  AUDIT_ACTIONS,
  ENTITY_TYPES,
};