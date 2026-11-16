// tests/pin-timing.test.js
// P-07b (Option X-rigorous): the timing oracle between unknown email,
// known v1 user, and known v2 user must be closed during the v1->v2
// migration window. This test asserts the padding is in place.
//
// bcrypt timing is naturally variable on CI, so the tolerance is broad.
// The test fails if padding is removed entirely (v1 drops to ~250ms
// while v2 stays ~1000ms), which is the regression we care about.

process.env.PIN_PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';

const { hashPinV1, hashPinV2, verifyPin, DUMMY_HASH_V2 } = require('../src/utils/pin-crypto');

async function timeIt(fn) {
  const t0 = Date.now();
  await fn();
  return Date.now() - t0;
}

test('v1 verify is padded to within a similar time of v2 verify', async () => {
  const v1 = await hashPinV1('123789');
  const v2 = await hashPinV2('123789');

  // Warm the JIT/crypto pool so the first call does not skew the sample.
  await verifyPin('000000', v1, 1);
  await verifyPin('000000', v2, 2);

  const t1 = await timeIt(() => verifyPin('wrong1', v1, 1));
  const t2 = await timeIt(() => verifyPin('wrong2', v2, 2));

  // Both should be in the same ballpark (within 2x). Without padding, t1
  // would be ~4x smaller than t2.
  const ratio = t2 / Math.max(t1, 1);
  expect(ratio).toBeLessThan(2.0);
  expect(ratio).toBeGreaterThan(0.5);
}, 30000);

test('unknown-email path uses DUMMY_HASH_V2 and matches v2 timing', async () => {
  const v2 = await hashPinV2('123789');
  await verifyPin('000000', v2, 2); // warm

  const tUnknown = await timeIt(() => verifyPin('wrong1', DUMMY_HASH_V2, 2));
  const tV2 = await timeIt(() => verifyPin('wrong2', v2, 2));

  const ratio = tV2 / Math.max(tUnknown, 1);
  expect(ratio).toBeLessThan(2.0);
  expect(ratio).toBeGreaterThan(0.5);
}, 30000);