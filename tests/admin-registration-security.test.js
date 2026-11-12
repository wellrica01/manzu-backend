
const express = require('express');
const request = require('supertest');

jest.mock('../src/domains/auth/admin/admin-auth.service', () => ({
  loginAdmin: jest.fn(),
}));

jest.mock('../src/domains/auth/pharmacy/pharmacy-auth.service', () => ({}));

jest.mock('../src/domains/auth/pharmacy/pharmacy-session.service', () => ({
  deviceInfoFromRequest: jest.fn(),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticatePharmacy: (req, res, next) => next(),
  authorizeRoles: () => (req, res, next) => next(),
}));

const adminAuthService = require('../src/domains/auth/admin/admin-auth.service');
const authRoutes = require('../src/routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Admin registration security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('public admin registration endpoint is unavailable', async () => {
    const response = await request(app)
      .post('/api/auth/admin/register')
      .send({
        name: 'Test Admin',
        email: 'test-admin@example.com',
        password: 'A-Strong-Test-Password-123',
      });

    expect(response.status).toBe(404);
    expect(adminAuthService.loginAdmin).not.toHaveBeenCalled();
  });

  test('admin login endpoint remains available', async () => {
    adminAuthService.loginAdmin.mockResolvedValue({
      token: 'test-token',
      admin: {
        id: 123,
        email: 'admin@example.com',
        name: 'Test Admin',
        role: 'ADMIN',
      },
    });

    const response = await request(app)
      .post('/api/auth/admin/login')
      .send({
        email: 'admin@example.com',
        password: 'A-Strong-Test-Password-123',
      });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Admin login successful');
    expect(response.body.token).toBe('test-token');
    expect(response.body.admin).toEqual({
      id: 123,
      email: 'admin@example.com',
      name: 'Test Admin',
      role: 'ADMIN',
    });

    expect(adminAuthService.loginAdmin).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'A-Strong-Test-Password-123',
    });
  });
});
