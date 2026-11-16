// tests/auth-session-revocation.test.js
// Doc 2 §5.1 / P-04(c): the service call sites that end a session.
//
// token-version-bump.test.js proves the *primitive* (tokenVersion bump +
// refresh family revoke in one transaction).
// session-revocation.test.js proves the *guard* refuses on the next request.
// This file proves the *call sites*: editPharmacyUser, deletePharmacyUser
// and suspendPharmacyUser actually invoke the primitive at the right time
// and for the right reasons.
//
// Mocks match equal-time-login.test.js: mock the repository and the session
// service, require the real auth service, no DB, no network.

process.env.THROTTLE_STORE = 'memory';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';
process.env.PIN_PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';

const mockRepo = {
  findPharmacyUserByEmail: jest.fn(),
  updatePharmacyUser: jest.fn(),
  findPharmacyUserById: jest.fn(),
  findPharmacyUserByIdAndPharmacy: jest.fn(),
  createPharmacyUser: jest.fn(),
  createPharmacyWithGPS: jest.fn(),
  findPharmacyByLicense: jest.fn(),
  deletePharmacyUser: jest.fn(),
  countActiveManagers: jest.fn().mockResolvedValue(2),
  executeTransaction: jest.fn(),
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
const TARGET_ID = 2;
const PHARMACY_ID = 7;

function targetUser(overrides = {}) {
  return {
    id: TARGET_ID,
    name: 'Ade',
    email: 'ade@x.com',
    role: 'STAFF',
    pharmacyId: PHARMACY_ID,
    password: 'hash',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(targetUser());
  mockRepo.updatePharmacyUser.mockImplementation(async (id, data) => ({ ...targetUser(), ...data }));
  mockRepo.deletePharmacyUser.mockResolvedValue({});
  mockSession.bumpTokenVersionAndRevoke.mockResolvedValue({ tokenVersion: 1, revokedCount: 1 });
});

describe('editPharmacyUser ends the session on role / PIN / email change', () => {
  test('role change (no PIN) bumps tokenVersion and revokes families', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(targetUser({ role: 'STAFF' }));
    await authService.editPharmacyUser(TARGET_ID, {
      name: 'Ade', email: 'ade@x.com', role: 'PHARMACIST',
    }, MANAGER_ID, PHARMACY_ID);

    expect(mockSession.bumpTokenVersionAndRevoke).toHaveBeenCalledTimes(1);
    expect(mockSession.bumpTokenVersionAndRevoke).toHaveBeenCalledWith(TARGET_ID);
    // The old revokeAllForUser call is gone (replaced by the bump).
    expect(mockSession.revokeAllForUser).not.toHaveBeenCalled();
  });

  test('PIN set bumps tokenVersion and revokes families', async () => {
    await authService.editPharmacyUser(TARGET_ID, {
      name: 'Ade', email: 'ade@x.com', pin: '706251', role: 'STAFF',
    }, MANAGER_ID, PHARMACY_ID);

    expect(mockSession.bumpTokenVersionAndRevoke).toHaveBeenCalledTimes(1);
    expect(mockSession.bumpTokenVersionAndRevoke).toHaveBeenCalledWith(TARGET_ID);
  });

  test('email change bumps tokenVersion', async () => {
    await authService.editPharmacyUser(TARGET_ID, {
      name: 'Ade', email: 'new@x.com', role: 'STAFF',
    }, MANAGER_ID, PHARMACY_ID);

    expect(mockSession.bumpTokenVersionAndRevoke).toHaveBeenCalledTimes(1);
  });


  test('role change emits AUTH_ROLE_CHANGED audit event', async () => {
    createAuditLog.mockClear();
    mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(targetUser({ role: 'STAFF' }));
    await authService.editPharmacyUser(TARGET_ID, {
      name: 'Ade', email: 'ade@x.com', role: 'PHARMACIST',
    }, MANAGER_ID, PHARMACY_ID);
    const call = createAuditLog.mock.calls.find((c) => c[0].action === 'AUTH_ROLE_CHANGED');
    expect(call).toBeTruthy();
    expect(call[0].before).toEqual({ role: 'STAFF' });
    expect(call[0].after).toEqual({ role: 'PHARMACIST', changedById: MANAGER_ID });
  });
  test('name-only change does NOT bump', async () => {
    await authService.editPharmacyUser(TARGET_ID, {
      name: 'Adebayo', email: 'ade@x.com', role: 'STAFF',
    }, MANAGER_ID, PHARMACY_ID);

    expect(mockSession.bumpTokenVersionAndRevoke).not.toHaveBeenCalled();
  });

  test('role set to the same value does NOT bump', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(targetUser({ role: 'STAFF' }));
    await authService.editPharmacyUser(TARGET_ID, {
      name: 'Ade', email: 'ade@x.com', role: 'STAFF',
    }, MANAGER_ID, PHARMACY_ID);

    expect(mockSession.bumpTokenVersionAndRevoke).not.toHaveBeenCalled();
  });
});

describe('deletePharmacyUser revokes before delete', () => {
  test('bump is called before the soft-delete update', async () => {
    await authService.deletePharmacyUser(TARGET_ID, MANAGER_ID, PHARMACY_ID);

    expect(mockSession.bumpTokenVersionAndRevoke).toHaveBeenCalledTimes(1);
    expect(mockSession.bumpTokenVersionAndRevoke).toHaveBeenCalledWith(TARGET_ID);

    // P-06.6c: soft delete. The row is updated (status REMOVED), not deleted.
    expect(mockRepo.deletePharmacyUser).not.toHaveBeenCalled();
    expect(mockRepo.updatePharmacyUser).toHaveBeenCalledWith(TARGET_ID, expect.objectContaining({
      status: 'REMOVED',
      removedLabel: 'Ade',
    }));
    const updateCall = mockRepo.updatePharmacyUser.mock.calls[0];
    expect(updateCall[1].removedAt).toBeInstanceOf(Date);

    // Order: bump must come before the soft-delete update.
    const bumpOrder = mockSession.bumpTokenVersionAndRevoke.mock.invocationCallOrder[0];
    const updateOrder = mockRepo.updatePharmacyUser.mock.invocationCallOrder[0];
    expect(bumpOrder).toBeLessThan(updateOrder);
  });

  test('self-delete still refused; neither bump nor delete runs', async () => {
    const err = await authService.deletePharmacyUser(MANAGER_ID, MANAGER_ID, PHARMACY_ID).catch((e) => e);
    expect(err.status).toBe(403);
    expect(mockSession.bumpTokenVersionAndRevoke).not.toHaveBeenCalled();
    expect(mockRepo.deletePharmacyUser).not.toHaveBeenCalled();
  });
});

describe('suspendPharmacyUser sets status and ends the session', () => {
  test('sets status=SUSPENDED, suspendedAt, suspendedById, then bumps', async () => {
    await authService.suspendPharmacyUser(TARGET_ID, MANAGER_ID, PHARMACY_ID);

    expect(mockRepo.updatePharmacyUser).toHaveBeenCalledTimes(1);
    const updateCall = mockRepo.updatePharmacyUser.mock.calls[0];
    expect(updateCall[0]).toBe(TARGET_ID);
    expect(updateCall[1].status).toBe('SUSPENDED');
    expect(updateCall[1].suspendedAt).toBeInstanceOf(Date);
    expect(updateCall[1].suspendedById).toBe(MANAGER_ID);

    expect(mockSession.bumpTokenVersionAndRevoke).toHaveBeenCalledTimes(1);

    // Order: update status, then bump.
    const upOrder = mockRepo.updatePharmacyUser.mock.invocationCallOrder[0];
    const bumpOrder = mockSession.bumpTokenVersionAndRevoke.mock.invocationCallOrder[0];
    expect(upOrder).toBeLessThan(bumpOrder);
  });


  test('suspend emits AUTH_USER_SUSPENDED audit event', async () => {
    createAuditLog.mockClear();
    mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(targetUser({ status: 'ACTIVE' }));
    await authService.suspendPharmacyUser(TARGET_ID, MANAGER_ID, PHARMACY_ID);
    const call = createAuditLog.mock.calls.find((c) => c[0].action === 'AUTH_USER_SUSPENDED');
    expect(call).toBeTruthy();
    expect(call[0].before).toEqual({ status: 'ACTIVE' });
    expect(call[0].after).toEqual({ status: 'SUSPENDED', suspendedById: MANAGER_ID });
  });
  test('self-suspend refused; no update, no bump', async () => {
    const err = await authService.suspendPharmacyUser(MANAGER_ID, MANAGER_ID, PHARMACY_ID).catch((e) => e);
    expect(err.status).toBe(403);
    expect(mockRepo.updatePharmacyUser).not.toHaveBeenCalled();
    expect(mockSession.bumpTokenVersionAndRevoke).not.toHaveBeenCalled();
  });

  test('unknown user: 404, no update, no bump', async () => {
    mockRepo.findPharmacyUserByIdAndPharmacy.mockResolvedValue(null);
    const err = await authService.suspendPharmacyUser(TARGET_ID, MANAGER_ID, PHARMACY_ID).catch((e) => e);
    expect(err.status).toBe(404);
    expect(mockRepo.updatePharmacyUser).not.toHaveBeenCalled();
    expect(mockSession.bumpTokenVersionAndRevoke).not.toHaveBeenCalled();
  });
});