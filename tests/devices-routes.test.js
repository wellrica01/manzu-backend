// tests/devices-routes.test.js
// P-13c: the device routes. Real router + real service, mocked repository,
// mocked session service, mocked audit. No DB, no network.

process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const mockRepo = {
  findDeviceById: jest.fn(),
  listDevicesForUser: jest.fn(),
  listDevicesForPharmacy: jest.fn(),
  approveDevice: jest.fn(),
  denyDevice: jest.fn(),
  revokeDevice: jest.fn(),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-session.repository', () => mockRepo);

const mockRevokeAll = jest.fn();
jest.mock('../src/domains/auth/pharmacy/pharmacy-session.service', () => ({
  revokeAllForUser: mockRevokeAll,
}));

const mockAudit = jest.fn();
jest.mock('../src/utils/audit-logger', () => ({ createAuditLog: mockAudit }));

// loadAndCheck uses tx.$queryRaw; the mock Tx must expose it.
const mockTx = {
  userDevice: { update: jest.fn(), findUnique: jest.fn() },
  pharmacyUser: { findUnique: jest.fn() },
  $queryRaw: jest.fn(),
};
jest.mock('../src/core/database/prisma', () => ({
  $transaction: (fn) => fn(mockTx),
  userDevice: { findMany: jest.fn() },
  $queryRaw: jest.fn(),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticatePharmacy: (req, _res, next) => { req.user = { userId: 6, pharmacyId: 7, role: 'MANAGER' }; next(); },
}));
jest.mock('../src/core/authz/require-capability', () => ({
  requireCapability: () => (_req, _res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const router = require('../src/routes/devices');

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => { req.requestId = 'test'; next(); });
  a.use(router);
  return a;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAudit.mockResolvedValue(undefined);
  mockRevokeAll.mockResolvedValue(undefined);
});

describe('device routes (P-13c)', () => {
  test('GET /auth/devices returns the caller\'s devices', async () => {
    mockRepo.listDevicesForUser.mockResolvedValue([{ id: 1, deviceId: 'abc' }]);
    const r = await request(app()).get('/auth/devices');
    expect(r.status).toBe(200);
    expect(r.body.devices).toHaveLength(1);
    expect(mockRepo.listDevicesForUser).toHaveBeenCalledWith({ actorType: 'pharmacy_user', actorId: 6 });
  });

  test('DELETE /auth/devices/:id 404s on another user\'s device', async () => {
    mockRepo.findDeviceById.mockResolvedValue({ id: 99, actorType: 'pharmacy_user', actorId: 999, deviceId: 'x' });
    const r = await request(app()).delete('/auth/devices/99');
    expect(r.status).toBe(404);
    expect(mockRepo.revokeDevice).not.toHaveBeenCalled();
  });

  test('DELETE /auth/devices/:id revokes own device and writes audit', async () => {
    mockRepo.findDeviceById.mockResolvedValue({ id: 1, actorType: 'pharmacy_user', actorId: 6, deviceId: 'abc' });
    const r = await request(app()).delete('/auth/devices/1');
    expect(r.status).toBe(200);
    expect(mockRepo.revokeDevice).toHaveBeenCalledWith({ id: 1, tx: mockTx });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'device.revoked' }));
  });

  test('POST /pharmacy/team/devices/:id/approve 404s on another pharmacy\'s device', async () => {
    // loadAndCheck's $queryRaw returns [] when the join finds no row in this pharmacy.
    mockTx.$queryRaw.mockResolvedValue([]);
    const r = await request(app()).post('/pharmacy/team/devices/5/approve');
    expect(r.status).toBe(404);
    expect(mockRepo.approveDevice).not.toHaveBeenCalled();
  });

  test('POST /pharmacy/team/devices/:id/approve approves and writes audit', async () => {
    mockTx.$queryRaw.mockResolvedValue([{ id: 5, deviceId: 'y', actorId: 42, actorType: 'pharmacy_user' }]);
    const r = await request(app()).post('/pharmacy/team/devices/5/approve');
    expect(r.status).toBe(200);
    expect(mockRepo.approveDevice).toHaveBeenCalledWith({ id: 5, approvedById: 6, tx: mockTx });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'device.approved' }));
  });

  test('POST /pharmacy/team/devices/:id/deny denies, audits, and revokes all sessions', async () => {
    mockTx.$queryRaw.mockResolvedValue([{ id: 5, deviceId: 'y', actorId: 42, actorType: 'pharmacy_user' }]);
    const r = await request(app()).post('/pharmacy/team/devices/5/deny');
    expect(r.status).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'device.denied' }));
    expect(mockRevokeAll).toHaveBeenCalledWith(42);
  });
});