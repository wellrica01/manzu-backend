// tests/pin-crypto.test.js
// P-07a: versioned PIN hashing.

process.env.PIN_PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';

const {
  hashPin,
  hashPinV1,
  hashPinV2,
  verifyPin,
  needsUpgrade,
  CURRENT_VERSION,
  V1_COST,
  V2_COST,
} = require('../src/utils/pin-crypto');

test('v2 hash verifies only with the correct PIN', async () => {
  const hash = await hashPinV2('123789');
  expect(await verifyPin('123789', hash, 2)).toBe(true);
  expect(await verifyPin('123788', hash, 2)).toBe(false);
});

test('v2 hash is different from v1 hash of the same PIN', async () => {
  const v1 = await hashPinV1('123789');
  const v2 = await hashPinV2('123789');
  expect(v1).not.toBe(v2);
});

test('bcrypt cost is visible in the hash and matches the constants', async () => {
  const v1 = await hashPinV1('123789');
  const v2 = await hashPinV2('123789');
  expect(v1).toMatch(new RegExp(`^\\$2[aby]\\$${V1_COST}\\$`));
  expect(v2).toMatch(new RegExp(`^\\$2[aby]\\$${V2_COST}\\$`));
});

test('verifyPin dispatches on stored version (v1 rows still log in)', async () => {
  const v1 = await hashPinV1('123789');
  expect(await verifyPin('123789', v1, 1)).toBe(true);
  expect(await verifyPin('123789', v1, 2)).toBe(false);
});

test('hashPin defaults to CURRENT_VERSION = 2', async () => {
  expect(CURRENT_VERSION).toBe(2);
  const hash = await hashPin('123789');
  expect(hash).toMatch(new RegExp(`^\\$2[aby]\\$${V2_COST}\\$`));
});

test('v2 hash throws if PIN_PEPPER is unset', async () => {
  const saved = process.env.PIN_PEPPER;
  delete process.env.PIN_PEPPER;
  await expect(hashPinV2('123789')).rejects.toThrow(/PIN_PEPPER/);
  process.env.PIN_PEPPER = saved;
});

test('v2 verify throws if PIN_PEPPER is unset (do not silently fail-open)', async () => {
  const hash = await hashPinV2('123789');
  const saved = process.env.PIN_PEPPER;
  delete process.env.PIN_PEPPER;
  await expect(verifyPin('123789', hash, 2)).rejects.toThrow(/PIN_PEPPER/);
  process.env.PIN_PEPPER = saved;
});

test('needsUpgrade', () => {
  expect(needsUpgrade(1)).toBe(true);
  expect(needsUpgrade(2)).toBe(false);
  expect(needsUpgrade('1')).toBe(true);
});