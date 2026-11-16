// tests/equal-time-login.test.js
// FND-07b2: unknown email and wrong PIN take the same time (SEC-04).
// The throttle store is memory, so no DB is touched.

process.env.THROTTLE_STORE = 'memory';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const bcrypt = require('bcrypt');

const mockRepo = {
  findPharmacyUserByEmail: jest.fn(),
  updatePharmacyUser: jest.fn(),
  findPharmacyUserById: jest.fn(),
  findPharmacyUserByIdAndPharmacy: jest.fn(),
  createPharmacyUser: jest.fn(),
  createPharmacyWithGPS: jest.fn(),
  findPharmacyByLicense: jest.fn(),
  deletePharmacyUser: jest.fn(),
  executeTransaction: jest.fn(),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-auth.repository', () => mockRepo);

jest.mock('../src/core/audit/security-event', () => ({
  record: jest.fn(() => Promise.resolve()),
  notify: jest.fn(),
}));

const mockSession = {
  startSession: jest.fn(),
  revokeAllForUser: jest.fn(),
  bumpTokenVersionAndRevoke: jest.fn(),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-session.service', () => mockSession);

const memoryStore = require('../src/core/throttle/memory-store');
const authService = require('../src/domains/auth/pharmacy/pharmacy-auth.service');

const REAL_HASH = bcrypt.hashSync('123456', 10);

function userRow(overrides = {}) {
  return {
    id: 1,
    email: 'a@x.com',
    password: REAL_HASH,
    pharmacyId: 7,
    failedAttempts: 0,
    lockedUntil: null,
    Pharmacy: { id: 7, status: 'VERIFIED', isActive: true },
    ...overrides,
  };
}

beforeEach(() => {
  memoryStore._resetAll();
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

function time(promise) {
  const start = process.hrtime.bigint();
  return promise.then(
    () => Number(process.hrtime.bigint() - start) / 1e6,
    () => Number(process.hrtime.bigint() - start) / 1e6
  );
}

describe('equal-time login (SEC-04)', () => {
  test('unknown email vs wrong PIN: within a factor of 3', async () => {
    mockRepo.findPharmacyUserByEmail.mockResolvedValue(null);
    const t1 = await time(authService.loginUser({ email: 'nobody@x.com', pin: '123456' }).catch((e) => e));

    memoryStore._resetAll();

    mockRepo.findPharmacyUserByEmail.mockResolvedValue(userRow());
    mockRepo.updatePharmacyUser.mockResolvedValue({});
    const t2 = await time(authService.loginUser({ email: 'a@x.com', pin: '000000' }).catch((e) => e));

    // Both did real bcrypt work.
    expect(t1).toBeGreaterThan(30);
    expect(t2).toBeGreaterThan(30);
    const ratio = t1 / t2;
    expect(ratio).toBeGreaterThan(1 / 3);
    expect(ratio).toBeLessThan(3);
  });

  test('both paths return the same 401 error', async () => {
    mockRepo.findPharmacyUserByEmail.mockResolvedValue(null);
    const err1 = await authService.loginUser({ email: 'nobody@x.com', pin: '123456' }).catch((e) => e);

    memoryStore._resetAll();
    mockRepo.findPharmacyUserByEmail.mockResolvedValue(userRow());
    mockRepo.updatePharmacyUser.mockResolvedValue({});
    const err2 = await authService.loginUser({ email: 'a@x.com', pin: '000000' }).catch((e) => e);

    expect(err1.status).toBe(401);
    expect(err2.status).toBe(401);
    expect(err1.code).toBe(err2.code);
    expect(err1.message).toBe(err2.message);
  });

  test('failed login increments failedAttempts and locks out at 5', async () => {
    mockRepo.findPharmacyUserByEmail.mockResolvedValue(userRow({ failedAttempts: 4 }));
    mockRepo.updatePharmacyUser.mockResolvedValue({});
    await authService.loginUser({ email: 'a@x.com', pin: '000000' }).catch((e) => e);
    const call = mockRepo.updatePharmacyUser.mock.calls[0];
    expect(call[0]).toBe(1);
    expect(call[1].failedAttempts).toBe(5);
    expect(call[1].lockedUntil).toBeInstanceOf(Date);
  });

  test('already-locked account rejects without bcrypt or DB write', async () => {
    mockRepo.findPharmacyUserByEmail.mockResolvedValue(userRow({
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 60_000),
    }));
    const err = await authService.loginUser({ email: 'a@x.com', pin: '123456' }).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.code).toBe('ACCOUNT_LOCKED');
    expect(mockRepo.updatePharmacyUser).not.toHaveBeenCalled();
  });

  test('successful login resets failedAttempts', async () => {
    mockRepo.findPharmacyUserByEmail.mockResolvedValue(userRow({ failedAttempts: 3 }));
    mockRepo.updatePharmacyUser.mockResolvedValue({});
    mockSession.startSession.mockResolvedValue({ token: 'jwt', refreshToken: 'rt' });
    const result = await authService.loginUser({ email: 'a@x.com', pin: '123456' });
    expect(result.token).toBe('jwt');
    expect(mockRepo.updatePharmacyUser).toHaveBeenCalledWith(1, { failedAttempts: 0, lockedUntil: null });
  });

  test('sixth attempt refused by account lockout after 5 failures', async () => {
    // 5 wrong PINs on a known account: each increments failedAttempts and the
    // 5th sets lockedUntil. The 6th attempt hits the DB and is refused by
    // isLocked(), not by a pre-DB throttle.
    const userRow = { id: 1, email: 'x@y.com', password: 'hash', pharmacyId: 7, failedAttempts: 0, lockedUntil: null };
    mockRepo.findPharmacyUserByEmail.mockResolvedValue(userRow);
    mockRepo.updatePharmacyUser.mockResolvedValue({});
    for (let i = 0; i < 5; i++) {
      await authService.loginUser({ email: 'x@y.com', pin: '000000' }).catch(() => {});
    }
    // After the 5th, the DB row would have lockedUntil; simulate by returning it.
    const lockedUntil = new Date(Date.now() + 60_000);
    mockRepo.findPharmacyUserByEmail.mockResolvedValue({ ...userRow, failedAttempts: 5, lockedUntil });
    const err = await authService.loginUser({ email: 'x@y.com', pin: '000000' }).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.code).toBe('ACCOUNT_LOCKED');
    expect(err.retryAfterMs).toBeGreaterThan(0);
  });

  test('5th failure writes lockedUntil ~1min from now (severity lockout)', async () => {
    const userRow = { id: 1, email: 'x@y.com', password: 'hash', pharmacyId: 7, failedAttempts: 4, lockedUntil: null };
    mockRepo.findPharmacyUserByEmail.mockResolvedValue(userRow);
    mockRepo.updatePharmacyUser.mockResolvedValue({});
    const before = Date.now();
    await authService.loginUser({ email: 'x@y.com', pin: '000000' }).catch(() => {});
    const call = mockRepo.updatePharmacyUser.mock.calls[0];
    expect(call[0]).toBe(1);
    expect(call[1].failedAttempts).toBe(5);
    expect(call[1].lockedUntil).toBeInstanceOf(Date);
    const delta = call[1].lockedUntil.getTime() - before;
    expect(delta).toBeGreaterThan(55_000);
    expect(delta).toBeLessThan(65_000);
  });

  test('8th failure emits security.record at warning (severity notify)', async () => {
    const security = require('../src/core/audit/security-event');
    security.record.mockClear();
    const userRow = { id: 1, email: 'x@y.com', password: 'hash', pharmacyId: 7, failedAttempts: 7, lockedUntil: null };
    mockRepo.findPharmacyUserByEmail.mockResolvedValue(userRow);
    mockRepo.updatePharmacyUser.mockResolvedValue({});
    await authService.loginUser({ email: 'x@y.com', pin: '000000' }).catch(() => {});
    expect(security.record).toHaveBeenCalledTimes(1);
    const evt = security.record.mock.calls[0][1];
    expect(evt.action).toBe('auth.account.lockout.warning');
    expect(evt.severity).toBe('warning');
  });

  test('12th failure emits security.notify at critical (severity critical)', async () => {
    const security = require('../src/core/audit/security-event');
    security.notify.mockClear();
    const userRow = { id: 1, email: 'x@y.com', password: 'hash', pharmacyId: 7, failedAttempts: 11, lockedUntil: null };
    mockRepo.findPharmacyUserByEmail.mockResolvedValue(userRow);
    mockRepo.updatePharmacyUser.mockResolvedValue({});
    await authService.loginUser({ email: 'x@y.com', pin: '000000' }).catch(() => {});
    expect(security.notify).toHaveBeenCalledTimes(1);
    const evt = security.notify.mock.calls[0][0];
    expect(evt.action).toBe('auth.account.locked');
    expect(evt.severity).toBe('critical');
  });
});