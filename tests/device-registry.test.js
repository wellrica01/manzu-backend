// tests/device-registry.test.js
// FND-09: the device registry upserts on login and refresh, is best-effort,
// and is a no-op when the client does not send a device id (released builds).

process.env.THROTTLE_STORE = 'memory';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const mockRepo = {
  createRefreshToken: jest.fn(),
  findRefreshTokenByHash: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeFamily: jest.fn(),
  revokeAllForUser: jest.fn(),
  deleteStaleForUser: jest.fn(),
  findUserWithPharmacy: jest.fn(),
  upsertDevice: jest.fn(),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-session.repository', () => mockRepo);

const service = require('../src/domains/auth/pharmacy/pharmacy-session.service');

const user = {
  id: 6,
  name: 'Aisha',
  email: 'a@x.com',
  role: 'MANAGER',
  pharmacyId: 7,
  Pharmacy: { id: 7, status: 'VERIFIED', isActive: true },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.deleteStaleForUser.mockResolvedValue({ count: 0 });
  mockRepo.createRefreshToken.mockResolvedValue({});
  mockRepo.upsertDevice.mockResolvedValue({});
});

describe('device registry (FND-09)', () => {
  test('startSession upserts UserDevice when deviceId is provided', async () => {
    await service.startSession(user, 'Pixel 7', {}, { deviceId: 'abc-123', ip: '1.2.3.4' });
    expect(mockRepo.upsertDevice).toHaveBeenCalledTimes(1);
    const args = mockRepo.upsertDevice.mock.calls[0][0];
    expect(args.actorType).toBe('pharmacy_user');
    expect(args.actorId).toBe(6);
    expect(args.deviceId).toBe('abc-123');
    expect(args.label).toBe('Pixel 7');
    expect(args.lastIp).toBe('1.2.3.4');
  });

  test('startSession does not upsert when deviceId is missing (released builds)', async () => {
    await service.startSession(user, 'Pixel 7', {}, {});
    expect(mockRepo.upsertDevice).not.toHaveBeenCalled();
  });

  test('refreshSession upserts when deviceId is provided', async () => {
    mockRepo.findRefreshTokenByHash.mockResolvedValue({
      id: 1,
      familyId: 'fam-1',
      rotatedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      PharmacyUser: user,
    });
    mockRepo.rotateRefreshToken.mockResolvedValue(true);
    await service.refreshSession('refresh-token-xyz', 'Pixel 7', {}, { deviceId: 'abc-123', ip: '1.2.3.4' });
    expect(mockRepo.upsertDevice).toHaveBeenCalledTimes(1);
  });

  test('a failed upsert does not break the login', async () => {
    mockRepo.upsertDevice.mockRejectedValue(new Error('db'));
    const silent = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { token } = await service.startSession(user, 'Pixel 7', {}, { deviceId: 'abc-123', ip: null });
    expect(token).toBeTruthy();
    silent.mockRestore();
  });
});