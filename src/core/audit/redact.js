// src/core/audit/redact.js
// Applies catalogue.REDACT[action] to a before/after object.
// Two layers of defence:
//   1. allow-list: only fields named in REDACT[action].before/after survive.
//   2. blacklist: any field matching SECRET_KEYS is dropped at any depth,
//      regardless of what the allow-list said.
// accountNumber is special-cased to accountNumberLast4.

const { REDACT } = require('./catalogue');

// Fields that must never appear in an audit event, regardless of action.
const SECRET_KEYS = new Set([
  'pin', 'currentPin', 'newPin',
  'password', 'currentPassword', 'newPassword',
  'token', 'accessToken', 'refreshToken', 'idToken', 'jwt',
  'mfaSecret', 'mfaSecretEnc',
  'authorization', 'cookie', 'setCookie',
  'apiKey', 'apiSecret', 'secret',
  'accountNumber',
  'cardNumber', 'cvv',
]);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Returns the last 4 characters of a string, or null.
function last4(v) {
  if (typeof v !== 'string' || v.length < 4) return null;
  return v.slice(-4);
}

// Deep-clean an object using SECRET_KEYS. Non-objects pass through.
// Arrays are iterated; scalars are returned as-is.
function scrubSecrets(value, depth) {
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, depth + 1));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.has(k)) {
      if (k === 'accountNumber') {
        const l = last4(v);
        if (l) out.accountNumberLast4 = l;
      }
      continue;
    }
    out[k] = scrubSecrets(v, depth + 1);
  }
  return out;
}

// Keep only the fields named in the allow-list, then scrub secrets.
// Special case: if the allow-list asks for `accountNumberLast4` but the input
// carries `accountNumber`, pass `accountNumber` through so scrubSecrets can
// derive the last-4. The raw value is still dropped before the row is written -
// scrubSecrets turns it into `accountNumberLast4` only.
function pickAllowed(value, allowList) {
  if (!isPlainObject(value)) return undefined;
  if (!Array.isArray(allowList) || allowList.length === 0) return undefined;
  const out = {};
  const wantsLast4 = allowList.includes('accountNumberLast4');
  for (const k of allowList) {
    if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = value[k];
  }
  if (wantsLast4 && !out.accountNumberLast4 && Object.prototype.hasOwnProperty.call(value, 'accountNumber')) {
    out.accountNumber = value.accountNumber;
  }
  return Object.keys(out).length ? out : undefined;
}

// Public entry point. Returns { before?, after? } with fields removed.
// If the action has no REDACT entry, both sides are scrubbed by SECRET_KEYS
// only - a safe default that still cannot leak a secret.
function redactFor(action, before, after) {
  const rule = REDACT[action] || {};
  const outBefore = rule.before ? pickAllowed(before, rule.before) : undefined;
  const outAfter = rule.after ? pickAllowed(after, rule.after) : undefined;
  return {
    before: outBefore ? scrubSecrets(outBefore, 0) : undefined,
    after: outAfter ? scrubSecrets(outAfter, 0) : undefined,
  };
}

module.exports = { redactFor, scrubSecrets, SECRET_KEYS };