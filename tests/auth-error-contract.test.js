// tests/auth-error-contract.test.js
// FND-07b3: login responses carry the correct status, code, and Retry-After
// header for 401, 403, and 429; register has its own limiter class so it does
// not consume the login budget.

process.env.THROTTLE_STORE = 'memory';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const express = require('express');
const request = require('supertest');

const mockLogin = jest.fn();
const mockRegister = jest.fn();
const mockAdminLogin = jest.fn();
const mockChangePin = jest.fn();

jest.mock('../src/domains/auth/pharmacy/pharmacy-auth.service', () => ({
  loginUser: (...a) => mockLogin(...a),
  registerPharmacyAndUser: (...a) => mockRegister(...a),
  addPharmacyUser: jest.fn(),
  editPharmacyUser: jest.fn(),
  deletePharmacyUser: jest.fn(),
  changePharmacyUserPin: (...a) => mockChangePin(...a),
}));
jest.mock('../src/domains/auth/admin/admin-auth.service', () => ({
  loginAdmin: (...a) => mockAdminLogin(...a),
}));
jest.mock('../src/domains/auth/pharmacy/pharmacy-session.service', () => ({
  deviceInfoFromRequest: () => 'test-device',
  startSession: jest.fn(),
  revokeAllForUser: jest.fn(),
  getMe: jest.fn(),
  refreshSession: jest.fn(),
  logout: jest.fn(),
}));

const memoryStore = require('../src/core/throttle/memory-store');
const authRoutes = require('../src/routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

beforeEach(() => {
  memoryStore._resetAll();
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

function err(status, code, retryAfterMs) {
  const e = new Error('mocked');
  e.status = status;
  e.code = code;
  if (retryAfterMs) e.retryAfterMs = retryAfterMs;
  return e;
}

describe('login error contract (FND-07b3)', () => {
  test('401 INVALID_CREDENTIALS from the service reaches the client', async () => {
    mockLogin.mockRejectedValue(err(401, 'INVALID_CREDENTIALS'));
    const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', pin: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
    expect(res.headers['retry-after']).toBeUndefined();
  });

  test('429 RATE_LIMITED reaches the client with Retry-After', async () => {
    mockLogin.mockRejectedValue(err(429, 'RATE_LIMITED', 90000));
    const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', pin: '000000' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBe('90'); // ceil(90000/1000)
    expect(res.body.retryAfterSeconds).toBe(90);
  });

  test('403 ACCOUNT_LOCKED reaches the client with Retry-After', async () => {
    mockLogin.mockRejectedValue(err(403, 'ACCOUNT_LOCKED', 60000));
    const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', pin: '000000' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCOUNT_LOCKED');
    expect(res.headers['retry-after']).toBe('60');
  });

  test('admin login 429 also carries Retry-After', async () => {
    mockAdminLogin.mockRejectedValue(err(429, 'RATE_LIMITED', 30000));
    const res = await request(app).post('/api/auth/admin/login').send({ email: 'a@x.com', password: 'x' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
  });
});

describe('register has its own throttle (FND-07b3)', () => {
  test('register failures do not consume login throttle', async () => {
    // Use a fresh email so this test is not affected by the earlier login tests.
    // The throttle key is sha256(email), so a distinct email gets a distinct
    // login bucket - which is the point: register hits the register class, the
    // login email hits the login class. They do not interfere.

    // 5 register attempts. They hit registerLimiter (max 10) and Zod-reject
    // before reaching the service, so r.status is 400 either way. What matters
    // is that these 5 do not consume the login bucket for the email below.
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/auth/register').send({ pharmacy: {}, user: {} });
      expect(r.status).toBe(400);
    }

    // Fresh login email. Login throttle is empty for it.
    mockLogin.mockRejectedValue(err(401, 'INVALID_CREDENTIALS'));
    const r = await request(app).post('/api/auth/login').send({ email: 'fresh-throttle-check@x.com', pin: '000000' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('INVALID_CREDENTIALS');
  });
});