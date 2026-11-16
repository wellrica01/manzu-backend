// src/domains/auth/pharmacy/actor-payload.js
// P-03 backend (Doc 2 section 3.5): the capability/limits/capVersion payload
// attached to /auth/login, /auth/refresh, /auth/me.
//
// The mobile client uses these to build navigation from server-supplied
// capabilities (rather than role strings) and to invalidate its local cache
// when capVersion changes.
//
// limits: only the numeric caps that the mobile app enforces at the UI layer
// (discounts, void window, price change, etc.). The full PharmacySetting row
// (booleans, audit columns) is not exposed.

const crypto = require('crypto');
const { ROLE_CAPABILITIES } = require('../../../core/authz/capabilities');
const settingsService = require('../../pharmacy/settings/settings.service');

const LIMIT_FIELDS = [
  'discountCapPct',
  'voidWindowMinutes',
  'adjustThresholdUnits',
  'adjustApprovalUnits',
  'priceChangeCapPct',
  'refundLimitKobo',
  'bankHoldHours',
];

async function buildActorPayload(user, pharmacy) {
  const caps = ROLE_CAPABILITIES[user.role] || new Set();
  const capabilities = Array.from(caps).sort();

  const settings = await settingsService.getSettings(pharmacy.id);
  const limits = {};
  for (const field of LIMIT_FIELDS) {
    limits[field] = settings[field];
  }

  const capVersion = crypto
    .createHash('sha256')
    .update(JSON.stringify({ capabilities, limits }))
    .digest('hex')
    .slice(0, 16);

  return { capabilities, limits, capVersion };
}

module.exports = { buildActorPayload, LIMIT_FIELDS };