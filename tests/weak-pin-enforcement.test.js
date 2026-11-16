// tests/weak-pin-enforcement.test.js
// P-07b: the blocklist refuses weak PINs at every PIN-set site.

process.env.PIN_PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';
process.env.INVITE_PEPPER = 'test-invite-pepper-0123456789abcdef0123456789abcdef';

const mockRepo = {
  findPharmacyUserByEmail: jest.fn(),
  findPharmacyUserById: jest.fn(),
  findPharmacyUserByIdAndPharmacy: jest.fn(),
  findInviteByHash: jest.fn(),
  updatePharmacyUser: jest.fn(),
  createPharmacyUser: jest.fn(),
  createPharmacyUserInvite: jest.fn(),
  incrementInviteAttempts: jest.fn(),
  executeTransaction: jest.fn(async (fn) => fn({ pharmacyUser: { update: jest.fn() }, pharmacyUserInvite: { update: jest.fn() } })),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-auth.repository', () => mockRepo);

const mockSessionService = {
  startSession: jest.fn(async () => ({ token: 'jwt', refreshToken: 'rt' })),
  revokeAllForUser: jest.fn(),
  bumpTokenVersionAndRevoke: jest.fn(),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-session.service', () => mockSessionService);

jest.mock('../src/utils/audit-logger', () => ({ createAuditLog: jest.fn() }));
jest.mock('../src/core/throttle', () => ({ check: jest.fn(), record: jest.fn() }));

const { hashPinV2 } = require('../src/utils/pin-crypto');
const pharmacyAuthService = require('../src/domains/auth/pharmacy/pharmacy-auth.service');

beforeEach(() => {
  jest.clearAllMocks();
});

test('changePharmacyUserPin refuses 123456', async () => {
  const userHash = await hashPinV2('482937');
  mockRepo.findPharmacyUserById.mockResolvedValue({
    id: 42, password: userHash, pinHashVersion: 2,
  });

  const result = await pharmacyAuthService.changePharmacyUserPin(42, '482937', '123456');
  expect(result.success).toBe(false);
  expect(result.message).toMatch(/too common|predictable/i);
  expect(mockRepo.updatePharmacyUser).not.toHaveBeenCalled();
});

test('changePharmacyUserPin refuses 111111', async () => {
  const userHash = await hashPinV2('482937');
  mockRepo.findPharmacyUserById.mockResolvedValue({
    id: 42, password: userHash, pinHashVersion: 2,
  });

  const result = await pharmacyAuthService.changePharmacyUserPin(42, '482937', '111111');
  expect(result.success).toBe(false);
});

test('changePharmacyUserPin accepts a random PIN and writes v2', async () => {
  const userHash = await hashPinV2('482937');
  mockRepo.findPharmacyUserById.mockResolvedValue({
    id: 42, password: userHash, pinHashVersion: 2,
  });
  mockRepo.updatePharmacyUser.mockResolvedValue({});

  const result = await pharmacyAuthService.changePharmacyUserPin(42, '482937', '706251');
  expect(result.success).toBe(true);
  const call = mockRepo.updatePharmacyUser.mock.calls[0];
  expect(call[1].pinHashVersion).toBe(2);
  expect(call[1].password).toMatch(/^\$2[aby]\$12\$/);
});

test('acceptInvite refuses 000000', async () => {
  // A valid invite must pass every check at lines 566-575 so the code reaches
  // the blocklist at line 577. The invite is otherwise normal.
  mockRepo.findInviteByHash.mockResolvedValue({
    id: 1,
    userId: 42,
    usedAt: null,
    attempts: 0,
    expiresAt: new Date(Date.now() + 3600 * 1000),
    PharmacyUser: { email: 'a@x.com' },
  });

  await expect(
    pharmacyAuthService.acceptInvite({ email: 'a@x.com', code: 'ABCDEFGH', pin: '000000', deviceInfo: {}, meta: {} })
  ).rejects.toMatchObject({ code: 'WEAK_PIN' });

  // Verify the invite was NOT consumed (blocklist refused before the transaction)
  expect(mockRepo.executeTransaction).not.toHaveBeenCalled();
});

test('addPharmacyUser refuses 654321', async () => {
  mockRepo.findPharmacyUserByEmail.mockResolvedValue(null);
  await expect(
    pharmacyAuthService.addPharmacyUser({ name: 'X', email: 'x@x.com', pin: '654321', role: 'STAFF', pharmacyId: 7 })
  ).rejects.toMatchObject({ code: 'WEAK_PIN' });
});