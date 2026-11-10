// Unit tests for the pharmacy session service (G1, G2, G11).
// No database and no network: the repository is mocked.
// Run with the inline config used for push-service.test.js (see that file's notes).

process.env.JWT_SECRET = 'test-secret';

const mockRepo = {
  createRefreshToken: jest.fn(),
  findRefreshTokenByHash: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeFamily: jest.fn(),
  revokeAllForUser: jest.fn(),
  deleteStaleForUser: jest.fn(),
  findUserWithPharmacy: jest.fn(),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-session.repository', () => mockRepo);

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const service = require('../src/domains/auth/pharmacy/pharmacy-session.service');

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

const pharmacy = { id: 7, name: 'Kano Care', status: 'VERIFIED', isActive: true, logoUrl: null };
const user = { id: 6, name: 'Aisha', email: 'a@x.com', role: 'MANAGER', pharmacyId: 7, Pharmacy: pharmacy };

function row(overrides = {}) {
  return {
    id: 1,
    userId: 6,
    familyId: 'fam-1',
    tokenHash: 'h',
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null,
    rotatedAt: null,
    deviceInfo: 'Android',
    PharmacyUser: user,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockRepo.deleteStaleForUser.mockResolvedValue({ count: 0 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('startSession', () => {
  test('stores only the SHA-256 hash of the refresh token, and returns a JWT the middleware accepts', async () => {
    mockRepo.createRefreshToken.mockResolvedValue({});
    const { token, refreshToken } = await service.startSession(user, 'Pixel 7');

    const stored = mockRepo.createRefreshToken.mock.calls[0][0];
    expect(stored.tokenHash).toBe(sha256(refreshToken));
    expect(stored.tokenHash).toHaveLength(64);
    expect(JSON.stringify(stored)).not.toContain(refreshToken);
    expect(stored.deviceInfo).toBe('Pixel 7');
    expect(stored.familyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);

    const decoded = jwt.verify(token, 'test-secret', { algorithms: ['HS256'] });
    expect(decoded).toMatchObject({ userId: 6, pharmacyId: 7, role: 'MANAGER' });
  });

  test('a failing cleanup never breaks login', async () => {
    mockRepo.createRefreshToken.mockResolvedValue({});
    mockRepo.deleteStaleForUser.mockRejectedValue(new Error('db hiccup'));
    await expect(service.startSession(user, null)).resolves.toHaveProperty('refreshToken');
  });
});

describe('refreshSession', () => {
  test('rotates: new tokens, hash of the new token stored, role read fresh from the database', async () => {
    const promoted = { ...user, role: 'PHARMACIST', Pharmacy: { ...pharmacy, status: 'SUSPENDED' } };
    mockRepo.findRefreshTokenByHash.mockResolvedValue(row({ PharmacyUser: promoted }));
    mockRepo.rotateRefreshToken.mockResolvedValue(true);

    const old = 'o'.repeat(43);
    const result = await service.refreshSession(old, null);

    expect(mockRepo.findRefreshTokenByHash).toHaveBeenCalledWith(sha256(old));
    const args = mockRepo.rotateRefreshToken.mock.calls[0];
    expect(args[1].tokenHash).toBe(sha256(result.refreshToken));
    expect(result.refreshToken).not.toBe(old);
    expect(jwt.verify(result.token, 'test-secret').role).toBe('PHARMACIST');
    expect(result.pharmacy).toMatchObject({ status: 'SUSPENDED', isActive: true });
    expect(result.user).toEqual({ id: 6, name: 'Aisha', email: 'a@x.com', role: 'PHARMACIST' });
  });

  test('unknown token -> 401 INVALID_REFRESH_TOKEN', async () => {
    mockRepo.findRefreshTokenByHash.mockResolvedValue(null);
    await expect(service.refreshSession('x'.repeat(43))).rejects.toMatchObject({ status: 401, code: 'INVALID_REFRESH_TOKEN' });
    expect(mockRepo.revokeFamily).not.toHaveBeenCalled();
  });

  test('an already-rotated token revokes the whole family', async () => {
    mockRepo.findRefreshTokenByHash.mockResolvedValue(row({ rotatedAt: new Date(), revokedAt: new Date() }));
    await expect(service.refreshSession('x'.repeat(43))).rejects.toMatchObject({ status: 401, code: 'REFRESH_TOKEN_REUSED' });
    expect(mockRepo.revokeFamily).toHaveBeenCalledWith('fam-1');
    expect(mockRepo.rotateRefreshToken).not.toHaveBeenCalled();
  });

  test('a logged-out token is rejected without touching the family', async () => {
    mockRepo.findRefreshTokenByHash.mockResolvedValue(row({ revokedAt: new Date() }));
    await expect(service.refreshSession('x'.repeat(43))).rejects.toMatchObject({ status: 401, code: 'INVALID_REFRESH_TOKEN' });
    expect(mockRepo.revokeFamily).not.toHaveBeenCalled();
  });

  test('expired token -> 401 REFRESH_TOKEN_EXPIRED', async () => {
    mockRepo.findRefreshTokenByHash.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(service.refreshSession('x'.repeat(43))).rejects.toMatchObject({ status: 401, code: 'REFRESH_TOKEN_EXPIRED' });
  });

  test('losing a race (rotate returns false) is treated as reuse', async () => {
    mockRepo.findRefreshTokenByHash.mockResolvedValue(row());
    mockRepo.rotateRefreshToken.mockResolvedValue(false);
    await expect(service.refreshSession('x'.repeat(43))).rejects.toMatchObject({ status: 401, code: 'REFRESH_TOKEN_REUSED' });
    expect(mockRepo.revokeFamily).toHaveBeenCalledWith('fam-1');
  });
});

describe('logout and revokeAll', () => {
  test('logout revokes the family of a known token', async () => {
    mockRepo.findRefreshTokenByHash.mockResolvedValue(row());
    await service.logout('x'.repeat(43));
    expect(mockRepo.revokeFamily).toHaveBeenCalledWith('fam-1');
  });

  test('logout with an unknown token succeeds quietly', async () => {
    mockRepo.findRefreshTokenByHash.mockResolvedValue(null);
    await expect(service.logout('x'.repeat(43))).resolves.toBeUndefined();
    expect(mockRepo.revokeFamily).not.toHaveBeenCalled();
  });

  test('revokeAllForUser delegates to the repository', async () => {
    await service.revokeAllForUser(6);
    expect(mockRepo.revokeAllForUser).toHaveBeenCalledWith(6);
  });
});

describe('getMe', () => {
  test('returns the agreed shape with pharmacy status', async () => {
    mockRepo.findUserWithPharmacy.mockResolvedValue(user);
    const me = await service.getMe(6);
    expect(me).toEqual({
      user: { id: 6, name: 'Aisha', email: 'a@x.com', role: 'MANAGER' },
      pharmacy: { id: 7, name: 'Kano Care', status: 'VERIFIED', isActive: true, logoUrl: null },
    });
    expect(JSON.stringify(me)).not.toMatch(/password/i);
  });

  test('a deleted user gets 401 USER_NOT_FOUND so the app signs out', async () => {
    mockRepo.findUserWithPharmacy.mockResolvedValue(null);
    await expect(service.getMe(6)).rejects.toMatchObject({ status: 401, code: 'USER_NOT_FOUND' });
  });
});

describe('deviceInfoFromRequest', () => {
  test('prefers the app label, falls back to the user agent, and caps the length', () => {
    const req = (body, ua) => ({ body, get: () => ua });
    expect(service.deviceInfoFromRequest(req({ deviceInfo: 'Pixel 7 / 1.0.0' }, 'okhttp'))).toBe('Pixel 7 / 1.0.0');
    expect(service.deviceInfoFromRequest(req({}, 'okhttp/4'))).toBe('okhttp/4');
    expect(service.deviceInfoFromRequest(req({ deviceInfo: 'a'.repeat(500) }, ''))).toHaveLength(200);
    expect(service.deviceInfoFromRequest(req({}, undefined))).toBeNull();
  });
});
