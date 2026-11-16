// tests/pin-blocklist.test.js
// P-07a: PIN blocklist rules.

const { isWeakPin, BLOCKED_LITERALS } = require('../src/utils/pin-blocklist');

test('common literals are blocked', () => {
  for (const pin of ['000000', '123456', '654321', '111111', '112233']) {
    expect(isWeakPin(pin).blocked).toBe(true);
  }
});

test('every member of BLOCKED_LITERALS is blocked', () => {
  for (const pin of BLOCKED_LITERALS) {
    expect(isWeakPin(pin).blocked).toBe(true);
  }
});

test('repeated digits are blocked even if not in literals', () => {
  expect(isWeakPin('999999').blocked).toBe(true);
});

test('ascending run is blocked', () => {
  expect(isWeakPin('345678').blocked).toBe(true);
});

test('descending run is blocked', () => {
  expect(isWeakPin('987654').blocked).toBe(true);
});

test('phone suffix is blocked when supplied', () => {
  expect(isWeakPin('234567', { phoneDigits: '0803234567' }).blocked).toBe(true);
  // '482937' is not ascending, not descending, not repeated, not in BLOCKED_LITERALS.
  // Use it to prove the phone-suffix check doesn't false-positive on non-weak PINs.
  expect(isWeakPin('482937', { phoneDigits: '0803999999' }).blocked).toBe(false);
});

test('sibling collision is blocked when supplied', () => {
  const siblings = new Set(['482937']);
  expect(isWeakPin('482937', { siblingPins: siblings }).blocked).toBe(true);
  expect(isWeakPin('482938', { siblingPins: siblings }).blocked).toBe(false);
});

test('a plausible random PIN passes', () => {
  expect(isWeakPin('482937').blocked).toBe(false);
  expect(isWeakPin('706251').blocked).toBe(false);
});

test('non-6-digit input is blocked (fail-closed)', () => {
  expect(isWeakPin('12345').blocked).toBe(true);
  expect(isWeakPin('1234567').blocked).toBe(true);
  expect(isWeakPin('abcdef').blocked).toBe(true);
});