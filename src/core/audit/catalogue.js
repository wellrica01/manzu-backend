// src/core/audit/catalogue.js
// The action names that appear in AuditEvent.action, and the allow-list of
// fields that may appear in `before` / `after` for each action (Doc 1 S5.2).
//
// Rule: a field that is not in REDACT[action] is dropped by redact.js.
// The special-case blacklist in redact.js (pin, password, token, etc.) applies
// on top of this allow-list, so a wrong allow-list entry cannot leak a secret.
//
// Seeded from utils/audit-logger.js AUDIT_ACTIONS so existing call sites keep
// working unchanged. New names for FND-03 are the security.* family.

const ACTIONS = {
  // Order lifecycle (existing names preserved)
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_UPDATED: 'ORDER_UPDATED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_COMPLETED: 'ORDER_COMPLETED',

  // Payment (existing)
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',

  // Refunds (existing)
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  REFUND_APPROVED: 'REFUND_APPROVED',
  REFUND_REJECTED: 'REFUND_REJECTED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  REFUND_FAILED: 'REFUND_FAILED',

  // Prescriptions (existing)
  PRESCRIPTION_UPLOADED: 'PRESCRIPTION_UPLOADED',
  PRESCRIPTION_VERIFIED: 'PRESCRIPTION_VERIFIED',
  PRESCRIPTION_REJECTED: 'PRESCRIPTION_REJECTED',
  PRESCRIPTION_EXPIRED: 'PRESCRIPTION_EXPIRED',

  // Stock (existing)
  STOCK_RESERVED: 'STOCK_RESERVED',
  STOCK_RELEASED: 'STOCK_RELEASED',
  STOCK_UPDATED: 'STOCK_UPDATED',

  // Pharmacy actions (existing)
  PHARMACY_ORDER_ACCEPTED: 'PHARMACY_ORDER_ACCEPTED',
  PHARMACY_ORDER_REJECTED: 'PHARMACY_ORDER_REJECTED',
  PHARMACY_ORDER_FULFILLED: 'PHARMACY_ORDER_FULFILLED',

  // Admin (existing)
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  ADMIN_LOGOUT: 'ADMIN_LOGOUT',
  ADMIN_ACTION: 'ADMIN_ACTION',

  // Payouts (existing, from core/logger twin)
  PAYOUT_INITIATED: 'PAYOUT_INITIATED',
  PAYOUT_COMPLETED: 'PAYOUT_COMPLETED',
  PAYOUT_FAILED: 'PAYOUT_FAILED',
  PAYOUT_RETRIED: 'PAYOUT_RETRIED',

  // Banking (existing, from core/logger twin)
  BANKING_SETUP: 'BANKING_SETUP',
  BANKING_UPDATED: 'BANKING_UPDATED',
  BANKING_VERIFIED: 'BANKING_VERIFIED',
  BANKING_VERIFICATION_FAILED: 'BANKING_VERIFICATION_FAILED',

  // New: authentication and session (FND-05, FND-07, FND-08)
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.login.failed',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_TOKEN_REFRESHED: 'auth.token.refreshed',
  AUTH_SESSION_REVOKED: 'auth.session.revoked',
  AUTH_PIN_CHANGED: 'auth.pin.changed',
  AUTH_ROLE_CHANGED: 'auth.role.changed',
  AUTH_USER_SUSPENDED: 'auth.user.suspended',
  AUTH_USER_REMOVED: 'auth.user.removed',
  AUTH_INVITE_SENT: 'auth.invite.sent',
  AUTH_INVITE_ACCEPTED: 'auth.invite.accepted',
  AUTH_USER_REACTIVATED: 'auth.user.reactivated',
  AUTH_PIN_RESET: 'auth.pin.reset',
  SETTINGS_UPDATED: 'settings.updated',

  // New: step-up (FND-08)
  STEP_UP_GRANTED: 'stepup.granted',
  STEP_UP_DENIED: 'security.stepup.denied',

  // New: capabilities and roles (FND-04, Doc 2, Doc 3)
  CAPABILITY_DENIED: 'security.capability.denied',
  FLAG_CHANGED: 'flag.changed',

  // New: security events (kind = 'security')
  RATE_LIMITED: 'security.rate_limited',
  SUSPICIOUS_TOKEN_REUSE: 'security.refresh_token.reused',
};

// Allow-list per action. Fields listed here are copied into before/after.
// Everything else is dropped.
const REDACT = {
  // Order actions: keep amounts and statuses, never customer contact.
  ORDER_CREATED:     { after:  ['status', 'pharmacyId', 'totalPrice', 'itemCount'] },
  ORDER_UPDATED:     { before: ['status'], after: ['status'] },
  ORDER_CANCELLED:   { before: ['status'], after: ['status', 'reason'] },
  ORDER_COMPLETED:   { before: ['status'], after: ['status'] },

  // Payments: amounts and statuses only, never card/phone/email.
  PAYMENT_INITIATED: { after:  ['status', 'amount', 'reference'] },
  PAYMENT_VERIFIED:  { before: ['status'], after: ['status', 'amount'] },
  PAYMENT_FAILED:    { after:  ['status', 'errorCode'] },

  // Refunds: amount and status, never the destination account.
  REFUND_REQUESTED:  { after:  ['status', 'amount', 'orderId'] },
  REFUND_APPROVED:   { before: ['status'], after: ['status'] },
  REFUND_REJECTED:   { before: ['status'], after: ['status', 'reason'] },
  REFUND_COMPLETED:  { before: ['status'], after: ['status', 'amount'] },
  REFUND_FAILED:     { after:  ['status', 'errorCode'] },

  // Prescriptions: status and IDs, never the image or customer contact.
  PRESCRIPTION_UPLOADED: { after:  ['status', 'orderId'] },
  PRESCRIPTION_VERIFIED: { before: ['status'], after: ['status'] },
  PRESCRIPTION_REJECTED: { before: ['status'], after: ['status', 'reason'] },
  PRESCRIPTION_EXPIRED:  { after:  ['status'] },

  // Stock: numbers and statuses only.
  STOCK_RESERVED:    { after:  ['quantity', 'medicationId', 'orderId'] },
  STOCK_RELEASED:    { after:  ['quantity', 'medicationId', 'orderId'] },
  STOCK_UPDATED:     { before: ['quantity'], after: ['quantity'] },

  // Pharmacy order lifecycle.
  PHARMACY_ORDER_ACCEPTED:  { before: ['status'], after: ['status'] },
  PHARMACY_ORDER_REJECTED:  { before: ['status'], after: ['status', 'reason'] },
  PHARMACY_ORDER_FULFILLED: { before: ['status'], after: ['status'] },

  // Admin: role and status only.
  ADMIN_LOGIN:   { after:  ['ip', 'userAgent'] },
  ADMIN_LOGOUT:  { after:  [] },
  ADMIN_ACTION:  { before: [], after: ['targetType', 'targetId'] },

  // Payout: amount and status, never the bank account.
  PAYOUT_INITIATED: { after:  ['status', 'amount', 'pharmacyId'] },
  PAYOUT_COMPLETED: { before: ['status'], after: ['status', 'amount'] },
  PAYOUT_FAILED:    { after:  ['status', 'errorCode'] },
  PAYOUT_RETRIED:   { after:  ['status', 'retryCount'] },

  // Banking: last4 only, ever. The SQL column accountNumber is never read.
  BANKING_SETUP:               { after:  ['bankCode', 'accountName', 'accountNumberLast4'] },
  BANKING_UPDATED:             { before: ['accountNumberLast4'], after: ['bankCode', 'accountName', 'accountNumberLast4'] },
  BANKING_VERIFIED:            { before: ['accountNumberLast4'], after: ['accountNumberLast4', 'verified'] },
  BANKING_VERIFICATION_FAILED: { after:  ['accountNumberLast4', 'errorCode'] },

  // Auth and session.
  AUTH_LOGIN:            { after:  ['ip', 'userAgent', 'deviceId'] },
  AUTH_LOGIN_FAILED:     { after:  ['ip', 'userAgent', 'reason'] },
  AUTH_LOGOUT:           { after:  [] },
  AUTH_TOKEN_REFRESHED:  { after:  ['ip', 'deviceId'] },
  AUTH_SESSION_REVOKED:  { after:  ['reason'] },
  AUTH_PIN_CHANGED:      { after:  ['ip'] },
  AUTH_ROLE_CHANGED:     { before: ['role'], after: ['role', 'changedById'] },
  AUTH_USER_SUSPENDED:   { before: ['status'], after: ['status', 'suspendedById', 'reason'] },
  AUTH_USER_REMOVED:     { before: ['status'], after: ['removedLabel'] },
  AUTH_INVITE_SENT:      { after:  ['role', 'invitedById'] },
  AUTH_INVITE_ACCEPTED:  { after:  ['ip', 'deviceId'] },
  AUTH_USER_REACTIVATED: { before: ['status'], after: ['status'] },
  AUTH_PIN_RESET:        { after:  ['pinChangedById'] },
  SETTINGS_UPDATED:      { before: ['value'], after: ['value'] },

  // Step-up.
  STEP_UP_GRANTED:  { after: ['scope', 'tier'] },
  STEP_UP_DENIED:   { after: ['scope', 'tier', 'reason'] },

  // Capability and flags.
  CAPABILITY_DENIED: { after: ['capability', 'mode'] },
  FLAG_CHANGED:      { before: ['value'], after: ['value'] },

  // Security events.
  RATE_LIMITED:            { after: ['class', 'key_hash'] },
  SUSPICIOUS_TOKEN_REUSE:  { after: ['familyIdHash'] },
};

// Actions that must be recorded in the SAME transaction as the change
// (Doc 1 S5.2, "fail-closed"). If the audit write fails, the change rolls back.
// Everything not in this set uses best-effort.
const FAIL_CLOSED = new Set([
  'PAYMENT_INITIATED', 'PAYMENT_VERIFIED', 'PAYMENT_FAILED',
  'REFUND_REQUESTED', 'REFUND_APPROVED', 'REFUND_REJECTED', 'REFUND_COMPLETED', 'REFUND_FAILED',
  'BANKING_SETUP', 'BANKING_UPDATED', 'BANKING_VERIFIED', 'BANKING_VERIFICATION_FAILED',
  'PAYOUT_INITIATED', 'PAYOUT_COMPLETED', 'PAYOUT_FAILED', 'PAYOUT_RETRIED',
  'AUTH_LOGIN', 'AUTH_LOGIN_FAILED', 'AUTH_LOGOUT', 'AUTH_TOKEN_REFRESHED',
  'AUTH_SESSION_REVOKED', 'AUTH_PIN_CHANGED',
  'AUTH_ROLE_CHANGED', 'AUTH_USER_SUSPENDED', 'AUTH_USER_REMOVED',
  'AUTH_INVITE_SENT', 'AUTH_INVITE_ACCEPTED', 'AUTH_USER_REACTIVATED', 'AUTH_PIN_RESET', 'SETTINGS_UPDATED',
  'STEP_UP_GRANTED', 'STEP_UP_DENIED',
  'ADMIN_LOGIN', 'ADMIN_LOGOUT', 'ADMIN_ACTION',
  'PRESCRIPTION_VERIFIED', 'PRESCRIPTION_REJECTED',
  'CAPABILITY_DENIED', 'FLAG_CHANGED',
]);

function isFailClosed(action) {
  return FAIL_CLOSED.has(action);
}

module.exports = { ACTIONS, REDACT, FAIL_CLOSED, isFailClosed };