// src/domains/pharmacy/settings/settings.service.js
// P-06.6d: PharmacySetting business logic.
//
// - getSettings: returns the row if it exists, else the schema defaults
//   WITHOUT writing a row. Reads are pure.
// - updateSettings: validates ranges, upserts, emits SETTINGS_UPDATED
//   (fail-closed). First PATCH creates the row.
//
// Prisma types: discountCapPct is Decimal, refundLimitKobo is BigInt.
// Both are coerced to Number() for JSON safety - JSON.stringify throws on
// BigInt, and Decimal serializes to a string otherwise.

const repository = require('./settings.repository');
const { createAuditLog } = require('../../../utils/audit-logger');
const { HTTP_STATUS } = require('../../../config/constants');

// Defaults mirror sec-04-pharmacy-team.sql. Keep in sync with the schema.
const DEFAULTS = Object.freeze({
  requireDeviceApproval: false,
  staffOpeningHoursOnly: false,
  lockAfterSeconds: 60,
  discountCapPct: 0,
  voidWindowMinutes: 10,
  adjustThresholdUnits: 20,
  adjustApprovalUnits: 100,
  priceChangeCapPct: 30,
  refundLimitKobo: 5000000,
  bankHoldHours: 48,
  dailyDigest: true,
  updatedById: null,
});

const RANGES = Object.freeze({
  discountCapPct: { min: 0, max: 100 },
  voidWindowMinutes: { min: 0, max: 60 },
  priceChangeCapPct: { min: 5, max: 100 },
  refundLimitKobo: { min: 0, max: Number.MAX_SAFE_INTEGER },
  bankHoldHours: { min: 0, max: 168 },
  lockAfterSeconds: { min: 0, max: 300 },
  adjustThresholdUnits: { min: 0, max: 1000000 },
  adjustApprovalUnits: { min: 0, max: 1000000 },
});

function serialize(row) {
  return {
    pharmacyId: row.pharmacyId,
    requireDeviceApproval: row.requireDeviceApproval,
    staffOpeningHoursOnly: row.staffOpeningHoursOnly,
    lockAfterSeconds: row.lockAfterSeconds,
    discountCapPct: Number(row.discountCapPct),
    voidWindowMinutes: row.voidWindowMinutes,
    adjustThresholdUnits: row.adjustThresholdUnits,
    adjustApprovalUnits: row.adjustApprovalUnits,
    priceChangeCapPct: row.priceChangeCapPct,
    refundLimitKobo: Number(row.refundLimitKobo),
    bankHoldHours: row.bankHoldHours,
    dailyDigest: row.dailyDigest,
    updatedAt: row.updatedAt,
    updatedById: row.updatedById,
  };
}

function validateRanges(patch) {
  for (const [field, rule] of Object.entries(RANGES)) {
    if (patch[field] === undefined) continue;
    const value = patch[field];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      const error = new Error(field + ' must be a number');
      error.status = HTTP_STATUS.BAD_REQUEST;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (value < rule.min || value > rule.max) {
      const error = new Error(field + ' must be between ' + rule.min + ' and ' + rule.max);
      error.status = HTTP_STATUS.BAD_REQUEST;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
  }
}

async function getSettings(pharmacyId) {
  const row = await repository.findByPharmacyId(pharmacyId);
  if (row) return serialize(row);
  // No row: return the defaults without writing. The first PATCH creates the row.
  return { pharmacyId, ...DEFAULTS, updatedAt: null };
}

async function updateSettings(pharmacyId, patch, actorUserId) {
  validateRanges(patch);

  // Capture the before-state for the audit row: either the existing row, or defaults.
  const before = await getSettings(pharmacyId);

  const updated = await repository.upsert(pharmacyId, patch, actorUserId);
  const after = serialize(updated);

  // Fail-closed: a failed audit write propagates and the caller sees 500.
  // (The upsert has committed, but the manager knows the write did not land
  // as far as the audit trail is concerned. That is the fail-closed contract.)
  await createAuditLog({
    action: 'SETTINGS_UPDATED',
    entityType: 'PharmacySetting',
    entityId: pharmacyId,
    before: { value: before },
    after: { value: after },
  });

  return after;
}

module.exports = { getSettings, updateSettings, DEFAULTS, RANGES };
