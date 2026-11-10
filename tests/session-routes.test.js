// HTTP-level tests for /api/auth/refresh, /logout and /me using the real router.
// The session service is mocked; no database, no network.

process.env.JWT_SECRET = 'test-secret';

const mockService = {
  refreshSession: jest.fn(),
  logout: jest.fn(),
  getMe: jest.fn(),
  deviceInfoFromRequest: jest.fn(() => 'test-device'),
};
jest.mock('../src/domains/auth/pharmacy/pharmacy-session.service', () => mockService);

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const sessionRoutes = require('../src/routes/session');

const app = express();
app.use(express.json());
app.use('/api/auth', sessionRoutes);

const REFRESH = 'r'.repeat(43);
const pharmacyJwt = (extra = {}) => jwt.sign({ userId: 6, pharmacyId: 7, role: 'MANAGER', ...extra }, 'test-secret');

function authError(code) {
  const e = new Error(code);
  e.status = 401;
  e.code = code;
  return e;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/auth/refresh', () => {
  test('400 when the body has no refreshToken', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(mockService.refreshSession).not.toHaveBeenCalled();
  });

  test('200 returns the new session', async () => {
    mockService.refreshSession.mockResolvedValue({ token: 'jwt', refreshToken: 'new', user: { id: 6 }, pharmacy: { id: 7 } });
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: REFRESH });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token: 'jwt', refreshToken: 'new' });
    expect(mockService.refreshSession).toHaveBeenCalledWith(REFRESH, 'test-device');
  });

  test('401 with the error code the app can act on', async () => {
    mockService.refreshSession.mockRejectedValue(authError('REFRESH_TOKEN_REUSED'));
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: REFRESH });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('REFRESH_TOKEN_REUSED');
  });

  test('500 on unexpected errors, without leaking details or the token', async () => {
    mockService.refreshSession.mockRejectedValue(new Error('db exploded'));
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: REFRESH });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('db exploded');
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(REFRESH);
  });
});

describe('POST /api/auth/logout', () => {
  test('200 and revokes', async () => {
    mockService.logout.mockResolvedValue();
    const res = await request(app).post('/api/auth/logout').send({ refreshToken: REFRESH });
    expect(res.status).toBe(200);
    expect(mockService.logout).toHaveBeenCalledWith(REFRESH);
  });

  test('400 without a refreshToken', async () => {
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  test('401 NO_TOKEN without a bearer token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NO_TOKEN');
  });

  test('403 for an admin token', async () => {
    const adminJwt = jwt.sign({ adminId: 1, role: 'ADMIN' }, 'test-secret');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminJwt}`);
    expect(res.status).toBe(403);
  });

  test('200 with user and pharmacy for a pharmacy token', async () => {
    mockService.getMe.mockResolvedValue({ user: { id: 6 }, pharmacy: { id: 7, status: 'VERIFIED' } });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${pharmacyJwt()}`);
    expect(res.status).toBe(200);
    expect(res.body.pharmacy.status).toBe('VERIFIED');
    expect(mockService.getMe).toHaveBeenCalledWith(6);
  });

  test('401 USER_NOT_FOUND when the account was deleted', async () => {
    mockService.getMe.mockRejectedValue(authError('USER_NOT_FOUND'));
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${pharmacyJwt()}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('USER_NOT_FOUND');
  });
});
