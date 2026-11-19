/**
 * P-08: banking routes are mounted, gated, and shape responses.
 *
 * This is the P-13c lesson #2 canary for the banking block: a router-direct
 * test that mounts `src/routes/pharmacy` and calls the four banking routes.
 * If a future refactor unmounts the block (bad merge, route-prefix change),
 * this test returns 404 and fails loudly, which route-policy.test.js cannot
 * do (it reads source text, not the live router).
 *
 * The full createApp() path is deliberately not used: it loads prescription,
 * cart, and checkout routers, which pull in ESM-only packages (file-type,
 * parse5 via isomorphic-dompurify) that Jest 29 cannot resolve. The settings
 * smoke test faced the same constraint and mounted the router directly. See
 * route-module-load.test.js for the createApp()-equivalence that covers file
 * loading without these packages.
 */

jest.mock('expo-server-sdk', () => ({
  Expo: class Expo { sendPushNotificationsAsync() { return Promise.resolve({}); } },
}));

const express = require('express');
const request = require('supertest');

// Mock auth at the middleware layer so we do not need real JWTs.
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticatePharmacy: (req, res, next) => {
      req.user = { userId: 1, pharmacyId: 7, role: 'MANAGER', sid: 'sess-1' };
      next();
    },
  };
});

const router = require('../src/routes/pharmacy');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/pharmacy', router);
  return app;
}

describe('P-08 smoke: banking routes are mounted', () => {
  const app = makeApp();

  // The point of these three: if a route were unmounted, the response would be
  // 404. Any non-404 means the handler ran, and the handler will 400 on a
  // missing body. That proves registration.

  test('POST /api/pharmacy/banking/setup with empty body returns 400, not 404', async () => {
    const res = await request(app).post('/api/pharmacy/banking/setup').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('PUT /api/pharmacy/banking/update with empty body returns 400, not 404', async () => {
    const res = await request(app).put('/api/pharmacy/banking/update').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('POST /api/pharmacy/banking/cancel-change with non-integer changeId returns 400, not 404', async () => {
    const res = await request(app).post('/api/pharmacy/banking/cancel-change').send({ changeId: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('GET /api/pharmacy/banking/status is mounted (not 404)', async () => {
    const res = await request(app).get('/api/pharmacy/banking/status');
    expect(res.status).not.toBe(404);
  });

  test('GET /api/pharmacy/banking/banks is mounted (not 404)', async () => {
    const res = await request(app).get('/api/pharmacy/banking/banks');
    expect(res.status).not.toBe(404);
  });
});

describe('P-08 smoke: SEC_STEPUP_ENFORCE=enforce blocks without header', () => {
  const OLD_ENV = { ...process.env };

  beforeAll(() => {
    process.env.SEC_STEPUP_ENFORCE = 'enforce';
    // Fresh router require inside this block so the middleware reads new env.
    jest.resetModules();
    jest.mock('expo-server-sdk', () => ({
      Expo: class Expo { sendPushNotificationsAsync() { return Promise.resolve({}); } },
    }));
    jest.mock('../src/middleware/auth', () => {
      const actual = jest.requireActual('../src/middleware/auth');
      return {
        ...actual,
        authenticatePharmacy: (req, res, next) => {
          req.user = { userId: 1, pharmacyId: 7, role: 'MANAGER', sid: 'sess-1' };
          next();
        },
      };
    });
  });

  afterAll(() => {
    process.env = OLD_ENV;
    jest.resetModules();
  });

  test('POST /banking/setup without X-Step-Up returns 403 STEP_UP_REQUIRED', async () => {
    const express = require('express');
    const request = require('supertest');
    const freshRouter = require('../src/routes/pharmacy');
    const app = express();
    app.use(express.json());
    app.use('/api/pharmacy', freshRouter);

    const res = await request(app)
      .post('/api/pharmacy/banking/setup')
      .send({ accountNumber: '1234567890', bankCode: '011', bankName: 'First Bank' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('STEP_UP_REQUIRED');
  });
});