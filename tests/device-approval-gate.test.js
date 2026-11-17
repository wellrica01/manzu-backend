// tests/device-approval-gate.test.js
// P-13b: the device-approval gate in authenticate.
// Uses the real authenticate() with a mocked prisma.$queryRaw, same shape
// as tests/token-version-bump.test.js. The mock returns a row with the two
// new columns; the tests assert the gate's decision on that row.

process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';
process.env.SEC_ENFORCE = 'enforce';

const mockQueryRaw = jest.fn();
jest.mock('../src/core/database/prisma', () => ({ $queryRaw: mockQueryRaw }));
jest.mock('../src/core/audit/security-event', () => ({ record: jest.fn() }));

const { authenticate } = require('../src/middleware/auth');
const jwt = require('jsonwebtoken');

function makeToken(claims) {
  return jwt.sign({ iss: 'manzu', aud: 'pharmacy', ...claims }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

function makeReqRes({ token, deviceId }) {
  const req = {
    headers: { authorization: 'Bearer ' + token },
    path: '/api/pharmacy/dashboard',
    method: 'GET',
    ip: '1.2.3.4',
    client: { deviceId: deviceId || null, appVersion: null, minAppVersion: '0.0.0' },
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
  return { req, res };
}

function baseRow(overrides) {
  return {
    user_id: 6,
    user_status: 'ACTIVE',
    token_version: 0,
    must_change_pin: false,
    role: 'STAFF',
    pharmacy_id: 7,
    locked_until: null,
    pharmacy_status: 'VERIFIED',
    pharmacy_is_active: true,
    family_alive: true,
    device_approval_required: false,
    device_ok: true,
    ...overrides,
  };
}

const baseClaims = { userId: 6, pharmacyId: 7, role: 'STAFF', sid: null, tv: 0 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('device-approval gate (P-13b)', () => {
  test('no PharmacySetting row + untrusted device + enforce -> 200 (COALESCE false)', async () => {
    mockQueryRaw.mockResolvedValue([baseRow({ device_approval_required: false, device_ok: false })]);
    const { req, res } = makeReqRes({ token: makeToken(baseClaims), deviceId: 'dev-1' });
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(next).toHaveBeenCalled();
  });

  test('first-ever device, untrusted, setting on, enforce -> 200 (bootstrap)', async () => {
    mockQueryRaw.mockResolvedValue([baseRow({ device_approval_required: true, device_ok: true })]);
    const { req, res } = makeReqRes({ token: makeToken(baseClaims), deviceId: 'first-dev' });
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(next).toHaveBeenCalled();
  });

  test('second untrusted device, setting on, enforce -> 403 DEVICE_APPROVAL_REQUIRED', async () => {
    mockQueryRaw.mockResolvedValue([baseRow({ device_approval_required: true, device_ok: false })]);
    const { req, res } = makeReqRes({ token: makeToken(baseClaims), deviceId: 'second-dev' });
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'DEVICE_APPROVAL_REQUIRED' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('no X-Device-Id header (released build) -> 200 even with setting on', async () => {
    mockQueryRaw.mockResolvedValue([baseRow({ device_approval_required: true, device_ok: true })]);
    const { req, res } = makeReqRes({ token: makeToken(baseClaims), deviceId: null });
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(next).toHaveBeenCalled();
  });

  test('gate uses req.client.deviceId, not body.deviceId (P-D6 header-only)', async () => {
    mockQueryRaw.mockResolvedValue([baseRow({ device_approval_required: true, device_ok: true })]);
    const { req, res } = makeReqRes({ token: makeToken(baseClaims), deviceId: 'trusted-header' });
    req.body = { deviceId: 'untrusted-body' };
    const next = jest.fn();
    await authenticate(req, res, next);
    const callArgs = mockQueryRaw.mock.calls[0];
    const values = callArgs.slice(1);
    // The header value appears twice (the two ${deviceId} slots); the body value never appears.
    expect(values).toHaveLength(5);
    const deviceIds = values.filter((v) => v === 'trusted-header');
    expect(deviceIds).toHaveLength(2);
    expect(values).not.toContain('untrusted-body');
  });

  test('PIN change required takes precedence over device gate', async () => {
    mockQueryRaw.mockResolvedValue([baseRow({ must_change_pin: true, device_approval_required: true, device_ok: false })]);
    const { req, res } = makeReqRes({ token: makeToken(baseClaims), deviceId: 'dev-1' });
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'PIN_CHANGE_REQUIRED' }));
    expect(next).not.toHaveBeenCalled();
  });
});
