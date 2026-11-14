// tests/session-revocation.test.js
// Doc 1 S3.4: every revocation trigger must make the guard refuse on the next
// request. FND-05b3's guard reads user status, pharmacy status, and the
// refresh-family liveness from the database on every request, so a role
// change or suspension is honoured without a tokenVersion bump - the DB
// read is the mechanism.
//
// This test proves the guard's behaviour against each trigger:
//   PIN change (via revokeAllForUser / family revocation)
//   Role change (DB read of role; guard does not use the token's role claim)
//   Suspend / disable user (DB read of PharmacyUser.status)
//   Remove user (findUnique returns nothing -> guard refuses)
//   Pharmacy suspended / closed (DB read of Pharmacy.isActive)
//   Refresh reuse (revokeFamily -> family_alive = false)
// Plus the tokenVersion mismatch and the legacy-token window.
//
// It uses the real authenticate() from middleware/auth.js with a mock
// prisma.$queryRaw. No DB, no network. SEC_ENFORCE=enforce so denials are
// returned rather than logged-and-passed.

process.env.SEC_ENFORCE = 'enforce';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const jwt = require('jsonwebtoken');

// mockPrisma is referenced from the jest.mock factory, so it must be
// 'mock'-prefixed.
const mockPrisma = {
  $connect: jest.fn(() => Promise.resolve()),
  $disconnect: jest.fn(() => Promise.resolve()),
  $on: jest.fn(),
  $extends: jest.fn(function () { return mockPrisma; }),
  $queryRaw: jest.fn(),
};
jest.mock('../src/core/database/prisma', () => mockPrisma);

// security-event is imported by the guard; make it inert.
jest.mock('../src/core/audit/security-event', () => ({
  record: jest.fn(() => Promise.resolve()),
  notify: jest.fn(),
}));

const { authenticate } = require('../src/middleware/auth');

const USER_ID = 6;
const PHARMACY_ID = 7;

// A pharmacy access token in the FND-05b2 shape (with sid / tv / iss / aud / jti).
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

// A legacy token: no iss, no sid, no tv. The guard accepts it (one-lifetime
// window) but still runs the DB-status checks.
function legacyToken(overrides = {}) {
  return jwt.sign(
    { userId: USER_ID, pharmacyId: PHARMACY_ID, role: 'MANAGER', ...overrides },
    process.env.JWT_SECRET,
    { expiresIn: 60, algorithm: 'HS256' }
  );
}

// The row shape the guard's $queryRaw returns. Every field is named after the
// aliases in middleware/auth.js.
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
    // If the guard calls next(), the promise resolves. If it responds, the
    // promise resolves too (we do not wait for a next that never comes).
    setTimeout(resolve, 50);
  });
  return { req, res };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SEC_ENFORCE = 'enforce';
  mockPrisma.$queryRaw.mockResolvedValue([healthyRow()]);
});

afterEach(() => {
  delete process.env.SEC_ENFORCE;
});

describe('guard revocation (Doc 1 S3.4)', () => {
  test('healthy user + active pharmacy: guard passes and sets req.user', async () => {
    const { req, res } = await runGuard(pharmacyToken());
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
    expect(req.user).toBeTruthy();
    expect(req.user.userId).toBe(USER_ID);
    expect(req.user.pharmacyId).toBe(PHARMACY_ID);
    expect(req.user.role).toBe('MANAGER');
    expect(req.user.sid).toBe('sess-abc');
    // SEC-11: the id alias is set.
    expect(req.user.id).toBe(USER_ID);
  });

  test('user SUSPENDED: ACCOUNT_SUSPENDED 403', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([healthyRow({ user_status: 'SUSPENDED' })]);
    const { res } = await runGuard(pharmacyToken());
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('ACCOUNT_SUSPENDED');
  });

  test('user DISABLED: ACCOUNT_SUSPENDED 403', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([healthyRow({ user_status: 'DISABLED' })]);
    const { res } = await runGuard(pharmacyToken());
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('ACCOUNT_SUSPENDED');
  });

  test('pharmacy suspended (isActive false): PHARMACY_SUSPENDED 403', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([healthyRow({ pharmacy_is_active: false })]);
    const { res } = await runGuard(pharmacyToken());
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('PHARMACY_SUSPENDED');
  });

  test('family revoked (refresh reuse or sign out everywhere): SESSION_REVOKED 401', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([healthyRow({ family_alive: false })]);
    const { res } = await runGuard(pharmacyToken());
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('SESSION_REVOKED');
  });

  test('tokenVersion mismatch: SESSION_REVOKED 401', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([healthyRow({ token_version: 5 })]);
    const { res } = await runGuard(pharmacyToken({ tv: 3 }));
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('SESSION_REVOKED');
  });

  test('user removed (findUnique returns nothing): SESSION_REVOKED', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const { res } = await runGuard(pharmacyToken());
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('SESSION_REVOKED');
  });

  test('role change: guard reads role from the DB, not the token', async () => {
    // Token still claims MANAGER, but the DB says STAFF (demotion).
    mockPrisma.$queryRaw.mockResolvedValue([healthyRow({ role: 'STAFF' })]);
    const { req, res } = await runGuard(pharmacyToken({ role: 'MANAGER' }));
    expect(res.statusCode).toBe(200);
    expect(req.user.role).toBe('STAFF'); // DB wins, not the token
  });

  test('mustChangePin: PIN_CHANGE_REQUIRED on a non-exempt route', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([healthyRow({ must_change_pin: true })]);
    const { res } = await runGuard(pharmacyToken());
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('PIN_CHANGE_REQUIRED');
  });

  test('mustChangePin: allowed on /api/auth/me', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([healthyRow({ must_change_pin: true })]);
    const req = fakeReq(pharmacyToken());
    req.path = '/api/auth/me';
    const res = fakeRes();
    await new Promise((resolve) => {
      authenticate(req, res, () => resolve());
      setTimeout(resolve, 50);
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
    expect(req.user).toBeTruthy();
  });

  test('lockedUntil in the future: ACCOUNT_LOCKED 403', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([healthyRow({ locked_until: new Date(Date.now() + 60_000) })]);
    const { res } = await runGuard(pharmacyToken());
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('ACCOUNT_LOCKED');
  });

  test('legacy token (no sid, no tv): DB checks still apply (status honoured)', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([healthyRow({ user_status: 'SUSPENDED' })]);
    const { res } = await runGuard(legacyToken());
    // Even a legacy token gets the status check. Only the claim-enforcement
    // window is skipped.
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('ACCOUNT_SUSPENDED');
  });

  test('legacy token: healthy user passes without tv/sid checks', async () => {
    const { req, res } = await runGuard(legacyToken());
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
    expect(req.user).toBeTruthy();
    expect(req.user.id).toBe(USER_ID); // id alias set even for legacy
  });
});