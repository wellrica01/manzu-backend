// tests/step-up-service.test.js
// FND-08c: the step-up service (FND-08a). The middleware tests (FND-08b)
// cover the token verification side; these cover the issuance side: PIN
// verification, throttle, lockout interaction, T3 rejection, failure writes,
// success token shape.

process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const bcrypt = require('bcrypt');

// mockPrisma is referenced by jest.mock factory, so it must be 'mock'-prefixed.
const mockPrisma = {
  $connect: jest.fn(() => Promise.resolve()),
  $disconnect: jest.fn(() => Promise.resolve()),
  $on: jest.fn(),
  $extends: jest.fn(function () { return mockPrisma; }),
};
jest.mock('../src/core/database/prisma', () => mockPrisma);

const mockRepo = {
  findPharmacyUserById: jest.fn(),
  findPharmacyUserByEmail: jest.fn(),
  findPharmacyUserByIdAndPharmacy: jest.fn(),
  updatePharmacyUser: jest.fn(),
  createPharmacyUser: jest.fn(),
  createPharmacyWithGPS: jest.fn(),
  findPharmacyByLicense: jest.fn(),
  deletePharmacyUser: jest.fn(),
  executeTransaction: jest.fn(),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-auth.repository', () => mockRepo);

const mockSecurity = {
  record: jest.fn(() => Promise.resolve()),
  notify: jest.fn(),
};
jest.mock('../src/core/audit/security-event', () => mockSecurity);

const mockThrottle = {
  hit: jest.fn(async () => ({ allowed: true, retryAfterMs: 0, count: 1, level: 0 })),
  reset: jest.fn(() => Promise.resolve()),
};
jest.mock('../src/core/throttle', () => mockThrottle);

jest.mock('../src/core/context/actor-context', () => ({
  currentActor: jest.fn(() => null),
  currentRequestId: jest.fn(() => null),
  runWithContext: jest.fn((_ctx, fn) => fn()),
}));

const jwt = require('jsonwebtoken');
const { getSecretFor } = require('../src/utils/env-validator');
const service = require('../src/domains/auth/pharmacy/stepup.service');

const PIN = '123456';
const REAL_HASH = bcrypt.hashSync(PIN, 10);

function user(overrides = {}) {
  return {
    id: 42,
    email: 'a@x.com',
    password: REAL_HASH,
    pharmacyId: 7,
    failedAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.updatePharmacyUser.mockResolvedValue({});
  mockThrottle.hit.mockResolvedValue({ allowed: true, retryAfterMs: 0, count: 1, level: 0 });
});

describe('stepup.service.issueStepUp (FND-08a/08c)', () => {
  test('missing userId: STEP_UP_INVALID', async () => {
    const r = await service.issueStepUp({ userId: null, sessionId: 'sess-1', pin: PIN, scope: 'x' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('STEP_UP_INVALID');
  });

  test('missing sessionId: STEP_UP_INVALID', async () => {
    const r = await service.issueStepUp({ userId: 42, sessionId: null, pin: PIN, scope: 'x' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('STEP_UP_INVALID');
  });

  test('missing pin: STEP_UP_INVALID', async () => {
    const r = await service.issueStepUp({ userId: 42, sessionId: 'sess-1', pin: '', scope: 'x' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('STEP_UP_INVALID');
  });

  test('missing scope: STEP_UP_INVALID', async () => {
    const r = await service.issueStepUp({ userId: 42, sessionId: 'sess-1', pin: PIN, scope: '' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('STEP_UP_INVALID');
  });

  test('T3 scope: APPROVAL_REQUIRED (FND-08 does not issue T3)', async () => {
    const r = await service.issueStepUp({ userId: 42, sessionId: 'sess-1', pin: PIN, scope: 'banking.manage' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('APPROVAL_REQUIRED');
    // Did not need to touch the DB for a T3 refusal.
    expect(mockRepo.findPharmacyUserById).not.toHaveBeenCalled();
  });

  test('throttle denial: RATE_LIMITED with retryAfterMs', async () => {
    mockThrottle.hit.mockResolvedValue({ allowed: false, retryAfterMs: 30000, count: 6, level: 1 });
    const r = await service.issueStepUp({ userId: 42, sessionId: 'sess-1', pin: PIN, scope: 'inventory.edit' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('RATE_LIMITED');
    expect(r.retryAfterMs).toBe(30000);
    expect(mockRepo.findPharmacyUserById).not.toHaveBeenCalled();
  });

  test('user not found: STEP_UP_INVALID', async () => {
    mockRepo.findPharmacyUserById.mockResolvedValue(null);
    const r = await service.issueStepUp({ userId: 42, sessionId: 'sess-1', pin: PIN, scope: 'inventory.edit' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('STEP_UP_INVALID');
  });

  test('already locked out: ACCOUNT_LOCKED with retryAfterMs', async () => {
    mockRepo.findPharmacyUserById.mockResolvedValue(user({
      failedAttempts: 8,
      lockedUntil: new Date(Date.now() + 60000),
    }));
    const r = await service.issueStepUp({ userId: 42, sessionId: 'sess-1', pin: PIN, scope: 'inventory.edit' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ACCOUNT_LOCKED');
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  test('wrong PIN: STEP_UP_INVALID, failedAttempts incremented, security event written', async () => {
    mockRepo.findPharmacyUserById.mockResolvedValue(user({ failedAttempts: 3 }));
    const r = await service.issueStepUp({ userId: 42, sessionId: 'sess-1', pin: '000000', scope: 'inventory.edit' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('STEP_UP_INVALID');
    expect(mockRepo.updatePharmacyUser).toHaveBeenCalledWith(42, expect.objectContaining({ failedAttempts: 4 }));
    expect(mockSecurity.record).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ action: 'security.stepup.denied' })
    );
  });

  test('wrong PIN at the lockout threshold sets lockedUntil', async () => {
    mockRepo.findPharmacyUserById.mockResolvedValue(user({ failedAttempts: 4 }));
    await service.issueStepUp({ userId: 42, sessionId: 'sess-1', pin: '000000', scope: 'inventory.edit' });
    const args = mockRepo.updatePharmacyUser.mock.calls[0][1];
    expect(args.failedAttempts).toBe(5);
    expect(args.lockedUntil).toBeInstanceOf(Date);
  });

  test('success: ok true, token verifies, claims match, failedAttempts reset', async () => {
    mockRepo.findPharmacyUserById.mockResolvedValue(user({ failedAttempts: 2 }));
    const r = await service.issueStepUp({ userId: 42, sessionId: 'sess-abc', pin: PIN, scope: 'inventory.edit' });
    expect(r.ok).toBe(true);
    expect(r.scope).toBe('inventory.edit');
    expect(r.tier).toBe('T2');
    expect(r.expiresAt).toBeTruthy();

    const decoded = jwt.verify(r.token, getSecretFor('stepup'), {
      algorithms: ['HS256'], issuer: 'manzu', audience: 'stepup',
    });
    expect(decoded.userId).toBe(42);
    expect(decoded.sid).toBe('sess-abc');
    expect(decoded.scope).toBe('inventory.edit');
    expect(decoded.tier).toBe('T2');
    expect(typeof decoded.jti).toBe('string');
    // exp - iat = 300 seconds (5 minutes)
    expect(decoded.exp - decoded.iat).toBe(300);

    // Failure counter was reset.
    expect(mockRepo.updatePharmacyUser).toHaveBeenCalledWith(42, { failedAttempts: 0, lockedUntil: null });
  });

  test('success does not reset a login lockout that expired (nothing to reset)', async () => {
    // failedAttempts = 0, lockedUntil null: no update should happen on success.
    mockRepo.findPharmacyUserById.mockResolvedValue(user());
    const r = await service.issueStepUp({ userId: 42, sessionId: 'sess-abc', pin: PIN, scope: 'inventory.edit' });
    expect(r.ok).toBe(true);
    expect(mockRepo.updatePharmacyUser).not.toHaveBeenCalled();
  });
});