// tests/token-version-bump.test.js
// Doc 2 §5.1 / P-04(c): the primitive that makes a role change, deletion or
// suspension end every live session within one request.
//
// session-revocation.test.js proves the *guard* refuses when tokenVersion
// or the refresh family changes. This file proves the *primitive* does the
// two writes the guard relies on, in one transaction, and that a token
// minted before the bump is refused after it.
//
// Uses the real authenticate() with a mock prisma.$queryRaw, same shape as
// session-revocation.test.js. No DB, no network. SEC_ENFORCE=enforce.

process.env.SEC_ENFORCE = 'enforce';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const jwt = require('jsonwebtoken');

const mockPrisma = {
  $connect: jest.fn(() => Promise.resolve()),
  $disconnect: jest.fn(() => Promise.resolve()),
  $on: jest.fn(),
  $extends: jest.fn(function () { return mockPrisma; }),
  $queryRaw: jest.fn(),
  // The primitive runs inside $transaction(cb); hand the cb the same mock
  // so tx.pharmacyUser / tx.pharmacyRefreshToken resolve.
  $transaction: jest.fn(function (cb) { return cb(mockPrisma); }),
  pharmacyUser: {
    update: jest.fn(),
  },
  pharmacyRefreshToken: {
    updateMany: jest.fn(),
  },
};
jest.mock('../src/core/database/prisma', () => mockPrisma);

jest.mock('../src/core/audit/security-event', () => ({
  record: jest.fn(() => Promise.resolve()),
  notify: jest.fn(),
}));

const { authenticate } = require('../src/middleware/auth');
const repository = require('../src/domains/auth/pharmacy/pharmacy-session.repository');

const USER_ID = 6;
const PHARMACY_ID = 7;

function pharmacyToken(overrides = {}) {
  return jwt.sign(
    {
      userId: USER_ID,
      pharmacyId: PHARMACY_ID,
      role: 'MANAGER',
      sid: 'sess-abc',
      tv: 0,
      jti: 'jti-abc',
      client: 'mobile',
      ...overrides,
    },
    process.env.JWT_SECRET,
    { expiresIn: 60, algorithm: 'HS256', issuer: 'manzu', audience: 'pharmacy' }
  );
}

function healthyRow(overrides = {}) {
  return {
    user_id: USER_ID,
    user_status: 'ACTIVE',
    token_version: 0,
    must_change_pin: false,
    role: 'MANAGER',
    pharmacy_id: PHARMACY_ID,
    locked_until: null,
    pharmacy_status: 'VERIFIED',
    pharmacy_is_active: true,
    family_alive: true,
    ...overrides,
  };
}

function fakeReq(token) {
  return {
    headers: { authorization: `Bearer ${token}` },
    requestId: 'req-test',
    path: '/api/pharmacy/dashboard',
    ip: '127.0.0.1',
  };
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status: jest.fn(function (code) { res.statusCode = code; return res; }),
    json: jest.fn(function (body) { res.body = body; return res; }),
    setHeader: jest.fn(function (k, v) { res.headers[k] = v; }),
  };
  return res;
}

async function runGuard(token) {
  const req = fakeReq(token);
  const res = fakeRes();
  await new Promise((resolve) => {
    authenticate(req, res, () => resolve());
    setTimeout(resolve, 50);
  });
  return { req, res };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SEC_ENFORCE = 'enforce';
  mockPrisma.$queryRaw.mockResolvedValue([healthyRow()]);
  mockPrisma.pharmacyUser.update.mockResolvedValue({ tokenVersion: 1 });
  mockPrisma.pharmacyRefreshToken.updateMany.mockResolvedValue({ count: 3 });
});

afterEach(() => {
  delete process.env.SEC_ENFORCE;
});

describe('bumpTokenVersionAndRevoke (P-04/c)', () => {
  test('bumps tokenVersion by 1 and revokes every live family in one transaction', async () => {
    const result = await repository.bumpTokenVersionAndRevoke(USER_ID);

    // The increment — not an absolute value.
    expect(mockPrisma.pharmacyUser.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.pharmacyUser.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });

    // The revoke filter — only live families, same predicate as revokeAllForUser.
    expect(mockPrisma.pharmacyRefreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.pharmacyRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });

    // Both writes happened inside $transaction.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction.mock.calls[0][0]).toBeInstanceOf(Function);

    // The return shape.
    expect(result).toEqual({ tokenVersion: 1, revokedCount: 3 });
  });

  test('does not mutate any other PharmacyUser field', async () => {
    await repository.bumpTokenVersionAndRevoke(USER_ID);
    const data = mockPrisma.pharmacyUser.update.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(['tokenVersion']);
  });

  test('end-to-end: token minted before the bump is refused after it', async () => {
    // Token was minted with tv:0.
    const token = pharmacyToken({ tv: 0 });

    // The primitive runs.
    await repository.bumpTokenVersionAndRevoke(USER_ID);

    // The DB now reports tokenVersion 1 and the family revoked.
    mockPrisma.$queryRaw.mockResolvedValue([healthyRow({ token_version: 1, family_alive: false })]);

    // The guard refuses on the next request.
    const { res } = await runGuard(token);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('SESSION_REVOKED');
  });

  test('rolls back nothing on success: update resolves before updateMany is called', async () => {
    // Ordering assertion: the update is awaited before updateMany runs.
    const order = [];
    mockPrisma.pharmacyUser.update.mockImplementationOnce(async () => {
      order.push('update');
      return { tokenVersion: 1 };
    });
    mockPrisma.pharmacyRefreshToken.updateMany.mockImplementationOnce(async () => {
      order.push('updateMany');
      return { count: 1 };
    });

    await repository.bumpTokenVersionAndRevoke(USER_ID);
    expect(order).toEqual(['update', 'updateMany']);
  });
});