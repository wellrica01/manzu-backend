// src/utils/pin-blocklist.js
// P-07 (Doc 2 §5.3): reject PINs that are trivially guessable.
//
// Called at every hash-write site (register, add-user shadow, edit-user shadow,
// change-pin, invite-accept). Returns { blocked, reason? }. A blocked PIN is
// refused with WEAK_PIN; the reason is for server logs only, not the user.
//
// The caller must:
//   - already have checked /^\d{6}$/
//   - pass opts.phoneDigits when the user's or pharmacy's phone is known
//   - pass opts.siblingPins as a Set of other PINs in the same pharmacy
//     (requires hashing comparison — NOT raw equality — so the caller supplies
//     this only if it has already done that comparison. See P-07b for the
//     comparison helper.)

const BLOCKED_LITERALS = new Set([
  '000000', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999',
  '123456', '654321', '112233', '121212', '123123',
  '010101', '101010', '202020', '020202',
]);

function isAscending(pin) {
  for (let i = 1; i < pin.length; i++) {
    if (pin.charCodeAt(i) !== pin.charCodeAt(i - 1) + 1) return false;
  }
  return true;
}

function isDescending(pin) {
  for (let i = 1; i < pin.length; i++) {
    if (pin.charCodeAt(i) !== pin.charCodeAt(i - 1) - 1) return false;
  }
  return true;
}

function isRepeated(pin) {
  return pin.split('').every((c) => c === pin[0]);
}

/**
 * @param {string} pin
 * @param {object} [opts]
 * @param {string} [opts.phoneDigits]   last 6 digits of the user's or pharmacy's phone
 * @param {Set<string>} [opts.siblingPins]  other PINs in the same pharmacy (already verified)
 * @returns {{ blocked: boolean, reason?: string }}
 */
function isWeakPin(pin, opts = {}) {
  const str = String(pin);
  if (!/^\d{6}$/.test(str)) {
    return { blocked: true, reason: 'invalid_format' };
  }
  if (BLOCKED_LITERALS.has(str)) return { blocked: true, reason: 'common_pin' };
  if (isRepeated(str)) return { blocked: true, reason: 'repeated_digits' };
  if (isAscending(str)) return { blocked: true, reason: 'ascending' };
  if (isDescending(str)) return { blocked: true, reason: 'descending' };
  if (opts.phoneDigits && str === String(opts.phoneDigits).slice(-6)) {
    return { blocked: true, reason: 'phone_suffix' };
  }
  if (opts.siblingPins && opts.siblingPins.has(str)) {
    return { blocked: true, reason: 'sibling_collision' };
  }
  return { blocked: false };
}

module.exports = { isWeakPin, BLOCKED_LITERALS };