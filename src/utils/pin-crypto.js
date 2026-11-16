// src/utils/pin-crypto.js
// P-07 (Doc 2 §5.3): versioned PIN hashing.
//
// Version 1 (legacy, pre-P-07): bcrypt(pin, cost=10), no pepper.
// Version 2 (P-07+):            bcrypt(hmac_sha256(PIN_PEPPER, pin), cost=12).
//
// Version 2 makes an offline table attack against a leaked PharmacyUser row
// require PIN_PEPPER *and* bcrypt cost 12. The pepper alone closes the
// "10^6 keyspace, bcrypt-10, hours to crack" gap in Doc 2 §2.2.
//
// Usage:
//   const hash = await hashPin(pin);                // writes CURRENT_VERSION (2)
//   const ok = await verifyPin(pin, hash, version); // dispatches on stored version
//   if (needsUpgrade(version)) { /* re-hash on next successful login */ }
//
// PIN_PEPPER is required in production (env-validator enforces boot). Tests must
// set it before importing any v2 hash path.

const crypto = require('crypto');
const bcrypt = require('bcrypt');

const V1_COST = 10;
const V2_COST = 12;

// Module-load dummy hashes. Computing these once avoids a per-request cost
// and gives verifyPin a fixed target to pad against.
const DUMMY_HASH = bcrypt.hashSync('dummy-pin-never-used', V1_COST);
const DUMMY_HASH_V2 = bcrypt.hashSync('dummy-v2-never-used', V2_COST);
const CURRENT_VERSION = 2;

function getPepper() {
  const pepper = process.env.PIN_PEPPER;
  if (!pepper || pepper.length < 32) {
    throw new Error('PIN_PEPPER missing or too short (must be >= 32 chars)');
  }
  return pepper;
}

function hmacSha256Base64(pepper, pin) {
  return crypto.createHmac('sha256', pepper).update(String(pin)).digest('base64');
}

async function hashPinV1(pin) {
  return bcrypt.hash(String(pin), V1_COST);
}

async function hashPinV2(pin) {
  const peppered = hmacSha256Base64(getPepper(), pin);
  return bcrypt.hash(peppered, V2_COST);
}

async function hashPin(pin, version = CURRENT_VERSION) {
  if (version === 1) return hashPinV1(pin);
  if (version === 2) return hashPinV2(pin);
  throw new Error(`hashPin: unknown version ${version}`);
}

// Dispatches on the *stored* version, so version-1 rows still log in.
async function verifyPin(pin, hash, version) {
  if (version === 2) {
    const peppered = hmacSha256Base64(getPepper(), pin);
    return bcrypt.compare(peppered, hash);
  }
  if (version === 1) {
    const real = await bcrypt.compare(String(pin), hash);
    // Pad v1 to v2 cost. The v1 branch is the only path that would
    // otherwise be fast, which would leak "this is a v1 user".
    await bcrypt.compare(String(pin), DUMMY_HASH_V2);
    return real;
  }
  // Unknown version: full v2 dummy compare, matching unknown-email cost.
  await bcrypt.compare(hmacSha256Base64(getPepper(), pin), DUMMY_HASH_V2);
  return false;
}
function needsUpgrade(version) {
  return Number(version) < CURRENT_VERSION;
}

module.exports = {
  DUMMY_HASH,
  DUMMY_HASH_V2,
  CURRENT_VERSION,
  V1_COST,
  V2_COST,
  hashPin,
  hashPinV1,
  hashPinV2,
  verifyPin,
  needsUpgrade,
};