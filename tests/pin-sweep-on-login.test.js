// tests/pin-sweep-on-login.test.js
// P-07c (Doc 2 section 5.3): the first-sign-in sweep. A user with a v1
// hash whose PIN is now blocklisted gets mustChangePin: true in the same
// update as the v1->v2 hash upgrade.

process.env.PIN_PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';
process.env.THROTTLE_STORE = 'memory';

const bcrypt = require('bcrypt');

const mockRepo = {
  findPharmacyUserByEmail: jest.fn(),
  updatePharmacyUser: jest.fn(),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-auth.repository', () => mockRepo);

jest.mock('../src/domains/auth/pharmacy/pharmacy-session.service', () => ({
  startSession: jest.fn(async () => ({ token: 'jwt', refreshToken: 'rt' })),
}));

jest.mock('../src/core/audit/security-event', () => ({
  record: jest.fn(() => Promise.resolve()),
  notify: jest.fn(),
}));

jest.mock('../src/core/throttle', () => ({ check: jest.fn(), record: jest.fn() }));
jest.mock('../src/utils/audit-logger', () => ({ createAuditLog: jest.fn() }));

const memoryStore = require('../src/core/throttle/memory-store');
const pharmacyAuthService = require('../src/domains/auth/pharmacy/pharmacy-auth.service');
const { hashPinV2 } = require('../src/utils/pin-crypto');

async function userWithPin(pin, version) {
  return {
    id: 42,
    email: 'sweep@example.com',
    password: version === 1 ? bcrypt.hashSync(pin, 10) : await hashPinV2(pin),
    pharmacyId: 7,
    role: 'STAFF',
    failedAttempts: 0,
    lockedUntil: null,
    pinHashVersion: version,
    pinChangedAt: null,
    mustChangePin: false,
    Pharmacy: { id: 7, name: 'Test Pharmacy' },
  };
}

beforeEach(() => {
  memoryStore._resetAll();
  jest.clearAllMocks();
  mockRepo.updatePharmacyUser.mockResolvedValue({});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

test('v1 user with a weak PIN gets mustChangePin: true and the v2 upgrade in one write', async () => {
  // 123456 is in BLOCKED_LITERALS. The v1 hash is bcrypt cost 10.
  const user = await userWithPin('123456', 1);
  mockRepo.findPharmacyUserByEmail.mockResolvedValue(user);

  await pharmacyAuthService.loginUser({ email: user.email, pin: '123456', deviceInfo: {}, meta: {} });

  const upgradeCall = mockRepo.updatePharmacyUser.mock.calls.find(
    (c) => c[1] && c[1].pinHashVersion === 2
  );
  expect(upgradeCall).toBeDefined();
  expect(upgradeCall[1].mustChangePin).toBe(true);
  expect(upgradeCall[1].password).toMatch(/^\$2[aby]\$12\$/);
});

test('v1 user with a strong PIN gets the v2 upgrade but NOT mustChangePin', async () => {
  // 706251 is not in BLOCKED_LITERALS, not a run, not repeated.
  const user = await userWithPin('706251', 1);
  mockRepo.findPharmacyUserByEmail.mockResolvedValue(user);

  await pharmacyAuthService.loginUser({ email: user.email, pin: '706251', deviceInfo: {}, meta: {} });

  const upgradeCall = mockRepo.updatePharmacyUser.mock.calls.find(
    (c) => c[1] && c[1].pinHashVersion === 2
  );
  expect(upgradeCall).toBeDefined();
  expect(upgradeCall[1].mustChangePin).toBeUndefined();
});

test('v2 user is not swept (no update at all)', async () => {
  // Pre-populate: make sure no upgrade write fires for a v2 user.
  const user = await userWithPin('123456', 2);
  mockRepo.findPharmacyUserByEmail.mockResolvedValue(user);

  await pharmacyAuthService.loginUser({ email: user.email, pin: '123456', deviceInfo: {}, meta: {} });

  const upgradeCall = mockRepo.updatePharmacyUser.mock.calls.find(
    (c) => c[1] && c[1].pinHashVersion === 2
  );
  expect(upgradeCall).toBeUndefined();
});