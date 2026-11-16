// tests/manager-lifecycle.test.js
// P-06.6c: LAST_MANAGER guard + transferManager proof.
//
// Covers:
//   - Last active manager cannot be suspended, soft-deleted, or demoted.
//   - With two managers, each of those succeeds.
//   - transferManager swaps roles, bumps both, emits two AUTH_ROLE_CHANGED.
//   - transferManager refuses self-transfer, non-ACTIVE target, non-MANAGER
//     source, and already-MANAGER target.
//
// Mocks match auth-session-revocation.test.js: repository, session service,
// audit-logger. executeTransaction is wired to a mock tx so the role update
// path can be asserted.

process.env.THROTTLE_STORE = 'memory';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const mockTx = {
  pharmacyUser: { update: jest.fn() },
};

const mockRepo = {
  findPharmacyUserByEmail: jest.fn(),
  updatePharmacyUser: jest.fn(),
  findPharmacyUserById: jest.fn(),
  findPharmacyUserByIdAndPharmacy: jest.fn(),
  createPharmacyUser: jest.fn(),
  createPharmacyWithGPS: jest.fn(),
  findPharmacyByLicense: jest.fn(),
  deletePharmacyUser: jest.fn(),
  countActiveManagers: jest.fn(),
  executeTransaction: jest.fn(async (cb) => cb(mockTx)),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-auth.repository', () => mockRepo);

const mockSession = {
  startSession: jest.fn(),
  revokeAllForUser: jest.fn(),
  bumpTokenVersionAndRevoke: jest.fn(),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-session.service', () => mockSession);

jest.mock('../src/utils/audit-logger', () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}));

const { createAuditLog } = require('../src/utils/audit-logger');
const authService = require('../src/domains/auth/pharmacy/pharmacy-auth.service');

const MANAGER_ID = 1;
const OTHER_MANAGER_ID = 2;
const TARGET_ID = 3;
const PHARMACY_ID = 7;

function userRow(overrides = {}) {
  return {
    id: TARGET_ID,
    name: 'Ade',
    email: 'ade@x.com',
    role: 'STAFF',
    status: 'ACTIVE',
    pharmacyId: PHARMACY_ID,
    password: 'hash',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(userRow());
  mockRepo.updatePharmacyUser.mockResolvedValue({});
  mockRepo.countActiveManagers.mockResolvedValue(2);
  mockSession.bumpTokenVersionAndRevoke.mockResolvedValue({ tokenVersion: 1, revokedCount: 1 });
  mockTx.pharmacyUser.update.mockResolvedValue({});
});

describe('LAST_MANAGER guard', () => {
  test('refuses to suspend the last ACTIVE manager', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(userRow({ role: 'MANAGER' }));
    mockRepo.countActiveManagers.mockResolvedValue(1);
    const err = await authService.suspendPharmacyUser(TARGET_ID, MANAGER_ID, PHARMACY_ID).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('LAST_MANAGER');
    expect(mockRepo.updatePharmacyUser).not.toHaveBeenCalled();
    expect(mockSession.bumpTokenVersionAndRevoke).not.toHaveBeenCalled();
  });

  test('refuses to soft-delete the last ACTIVE manager', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(userRow({ role: 'MANAGER' }));
    mockRepo.countActiveManagers.mockResolvedValue(1);
    const err = await authService.deletePharmacyUser(TARGET_ID, MANAGER_ID, PHARMACY_ID).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('LAST_MANAGER');
    expect(mockRepo.updatePharmacyUser).not.toHaveBeenCalled();
    expect(mockRepo.deletePharmacyUser).not.toHaveBeenCalled();
  });

  test('refuses to demote the last ACTIVE manager', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(userRow({ role: 'MANAGER' }));
    mockRepo.countActiveManagers.mockResolvedValue(1);
    const err = await authService.editPharmacyUser(TARGET_ID, {
      name: 'Ade', email: 'ade@x.com', role: 'PHARMACIST',
    }, MANAGER_ID, PHARMACY_ID).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('LAST_MANAGER');
    expect(mockRepo.updatePharmacyUser).not.toHaveBeenCalled();
  });

  test('allows suspending a manager when there are two', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(userRow({ role: 'MANAGER' }));
    mockRepo.countActiveManagers.mockResolvedValue(2);
    await authService.suspendPharmacyUser(TARGET_ID, MANAGER_ID, PHARMACY_ID);
    expect(mockRepo.updatePharmacyUser).toHaveBeenCalledWith(TARGET_ID, expect.objectContaining({ status: 'SUSPENDED' }));
  });

  test('allows soft-deleting a manager when there are two', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(userRow({ role: 'MANAGER' }));
    mockRepo.countActiveManagers.mockResolvedValue(2);
    await authService.deletePharmacyUser(TARGET_ID, MANAGER_ID, PHARMACY_ID);
    expect(mockRepo.updatePharmacyUser).toHaveBeenCalledWith(TARGET_ID, expect.objectContaining({ status: 'REMOVED' }));
  });

  test('allows demoting a manager when there are two', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(userRow({ role: 'MANAGER' }));
    mockRepo.countActiveManagers.mockResolvedValue(2);
    await authService.editPharmacyUser(TARGET_ID, {
      name: 'Ade', email: 'ade@x.com', role: 'PHARMACIST',
    }, MANAGER_ID, PHARMACY_ID);
    expect(mockRepo.updatePharmacyUser).toHaveBeenCalled();
  });
});

describe('transferManager', () => {
  test('swaps roles, bumps both, emits two AUTH_ROLE_CHANGED', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy
      .mockResolvedValueOnce(userRow({ id: MANAGER_ID, role: 'MANAGER' }))         // from
      .mockResolvedValueOnce(userRow({ id: TARGET_ID, role: 'PHARMACIST' }));     // to

    const result = await authService.transferManager(MANAGER_ID, TARGET_ID, MANAGER_ID, PHARMACY_ID);

    expect(mockRepo.executeTransaction).toHaveBeenCalledTimes(1);
    expect(mockTx.pharmacyUser.update).toHaveBeenCalledTimes(2);
    expect(mockTx.pharmacyUser.update).toHaveBeenCalledWith({ where: { id: TARGET_ID }, data: { role: 'MANAGER' } });
    expect(mockTx.pharmacyUser.update).toHaveBeenCalledWith({ where: { id: MANAGER_ID }, data: { role: 'PHARMACIST' } });

    expect(mockSession.bumpTokenVersionAndRevoke).toHaveBeenCalledWith(TARGET_ID);
    expect(mockSession.bumpTokenVersionAndRevoke).toHaveBeenCalledWith(MANAGER_ID);
    expect(mockSession.bumpTokenVersionAndRevoke).toHaveBeenCalledTimes(2);

    const events = createAuditLog.mock.calls.filter((c) => c[0].action === 'AUTH_ROLE_CHANGED');
    expect(events).toHaveLength(2);
    expect(events[0][0]).toMatchObject({
      action: 'AUTH_ROLE_CHANGED',
      entityId: TARGET_ID,
      before: { role: 'PHARMACIST' },
      after: { role: 'MANAGER', changedById: MANAGER_ID },
    });
    expect(events[1][0]).toMatchObject({
      action: 'AUTH_ROLE_CHANGED',
      entityId: MANAGER_ID,
      before: { role: 'MANAGER' },
      after: { role: 'PHARMACIST', changedById: MANAGER_ID },
    });

    expect(result.user).toEqual({ id: TARGET_ID, name: 'Ade', email: 'ade@x.com', role: 'MANAGER' });
  });

  test('refuses self-transfer', async () => {
    const err = await authService.transferManager(MANAGER_ID, MANAGER_ID, MANAGER_ID, PHARMACY_ID).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('INVALID_STATE');
    expect(mockRepo.executeTransaction).not.toHaveBeenCalled();
  });

  test('refuses non-ACTIVE target', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy
      .mockResolvedValueOnce(userRow({ id: MANAGER_ID, role: 'MANAGER' }))
      .mockResolvedValueOnce(userRow({ id: TARGET_ID, role: 'PHARMACIST', status: 'SUSPENDED' }));
    const err = await authService.transferManager(MANAGER_ID, TARGET_ID, MANAGER_ID, PHARMACY_ID).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('INVALID_STATE');
    expect(mockRepo.executeTransaction).not.toHaveBeenCalled();
  });

  test('refuses non-MANAGER source', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy
      .mockResolvedValueOnce(userRow({ id: MANAGER_ID, role: 'PHARMACIST' }))
      .mockResolvedValueOnce(userRow({ id: TARGET_ID, role: 'STAFF' }));
    const err = await authService.transferManager(MANAGER_ID, TARGET_ID, MANAGER_ID, PHARMACY_ID).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('INVALID_STATE');
    expect(mockRepo.executeTransaction).not.toHaveBeenCalled();
  });

  test('refuses already-MANAGER target', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy
      .mockResolvedValueOnce(userRow({ id: MANAGER_ID, role: 'MANAGER' }))
      .mockResolvedValueOnce(userRow({ id: TARGET_ID, role: 'MANAGER' }));
    const err = await authService.transferManager(MANAGER_ID, TARGET_ID, MANAGER_ID, PHARMACY_ID).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('INVALID_STATE');
    expect(mockRepo.executeTransaction).not.toHaveBeenCalled();
  });
});