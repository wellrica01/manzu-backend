// tests/pin-upgrade-on-login.test.js
// P-07b: a user with a v1 hash (pre-P-07) upgrades to v2 on their first
// successful login. A user already on v2 does not re-hash.

process.env.PIN_PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';

const mockRepo = {
  findPharmacyUserByEmail: jest.fn(),
  updatePharmacyUser: jest.fn(),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-auth.repository', () => mockRepo);

const mockSessionService = {
  startSession: jest.fn(async () => ({ token: 'jwt', refreshToken: 'rt' })),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-session.service', () => mockSessionService);

jest.mock('../src/utils/audit-logger', () => ({ createAuditLog: jest.fn() }));
jest.mock('../src/core/throttle', () => ({ check: jest.fn(), record: jest.fn() }));

const bcrypt = require('bcrypt');
const { hashPinV1, hashPinV2, verifyPin } = require('../src/utils/pin-crypto');
const pharmacyAuthService = require('../src/domains/auth/pharmacy/pharmacy-auth.service');

function makeUser(overrides = {}) {
  return {
    id: 42,
    email: 'test@example.com',
    name: 'Test User',
    role: 'MANAGER',
    pharmacyId: 7,
    failedAttempts: 0,
    lockedUntil: null,
    pinHashVersion: 1,
    password: null, // set per test
    Pharmacy: { id: 7, name: 'Test Pharmacy' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.updatePharmacyUser.mockResolvedValue({});
  mockSessionService.startSession.mockResolvedValue({ token: 'jwt', refreshToken: 'rt' });
});

test('v1 user upgrades to v2 on successful login', async () => {
  const v1Hash = await hashPinV1('123789');
  const user = makeUser({ password: v1Hash, pinHashVersion: 1 });
  mockRepo.findPharmacyUserByEmail.mockResolvedValue(user);

  await pharmacyAuthService.loginUser({ email: user.email, pin: '123789', deviceInfo: {}, meta: {} });

  // Verify an upgrade write happened with pinHashVersion: 2
  expect(mockRepo.updatePharmacyUser).toHaveBeenCalled();
  const upgradeCall = mockRepo.updatePharmacyUser.mock.calls.find(
    (c) => c[1] && c[1].pinHashVersion === 2
  );
  expect(upgradeCall).toBeDefined();
  expect(upgradeCall[0]).toBe(user.id);

  // Verify the written hash is v2 (bcrypt cost 12, pepper applied)
  const writtenHash = upgradeCall[1].password;
  expect(writtenHash).toMatch(/^\$2[aby]\$12\$/);
  expect(await verifyPin('123789', writtenHash, 2)).toBe(true);
});

test('v2 user with correct PIN does NOT re-hash', async () => {
  const v2Hash = await hashPinV2('123789');
  const user = makeUser({ password: v2Hash, pinHashVersion: 2 });
  mockRepo.findPharmacyUserByEmail.mockResolvedValue(user);

  await pharmacyAuthService.loginUser({ email: user.email, pin: '123789', deviceInfo: {}, meta: {} });

  const upgradeCall = mockRepo.updatePharmacyUser.mock.calls.find(
    (c) => c[1] && c[1].pinHashVersion === 2
  );
  expect(upgradeCall).toBeUndefined();
});

test('v1 user with wrong PIN does not upgrade', async () => {
  const v1Hash = await hashPinV1('123789');
  const user = makeUser({ password: v1Hash, pinHashVersion: 1 });
  mockRepo.findPharmacyUserByEmail.mockResolvedValue(user);

  await expect(
    pharmacyAuthService.loginUser({ email: user.email, pin: '999999', deviceInfo: {}, meta: {} })
  ).rejects.toThrow();

  const upgradeCall = mockRepo.updatePharmacyUser.mock.calls.find(
    (c) => c[1] && c[1].pinHashVersion === 2
  );
  expect(upgradeCall).toBeUndefined();
}, 30000);