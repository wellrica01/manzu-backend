// tests/settings-routes-smoke.test.js
// P-06.6d: route registration smoke test.
//
// The service has unit tests; this proves the routes are actually MOUNTED on
// the router (i.e. before module.exports = router). If a future edit moves
// them after the export, supertest returns 404 and this test fails.
//
// expo-server-sdk is ESM-only and cannot be required from Jest's CJS loader;
// it is mocked here because routes/pharmacy.js -> push.service.js requires it.
// The mock does nothing - we are testing route registration, not push delivery.

jest.mock('expo-server-sdk', () => ({
  Expo: class Expo {
    sendPushNotificationsAsync() {
      return Promise.resolve({});
    }
  },
}));

const express = require('express');
const request = require('supertest');
const router = require('../src/routes/pharmacy');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/pharmacy', router);
  return app;
}

describe('settings routes are mounted', () => {
  const app = makeApp();

  test('GET /api/pharmacy/settings is registered (401/403 without auth, not 404)', async () => {
    const res = await request(app).get('/api/pharmacy/settings');
    expect(res.status).not.toBe(404);
    expect([401, 403]).toContain(res.status);
  });

  test('PATCH /api/pharmacy/settings is registered (401/403 without auth, not 404)', async () => {
    const res = await request(app).patch('/api/pharmacy/settings').send({ dailyDigest: false });
    expect(res.status).not.toBe(404);
    expect([401, 403]).toContain(res.status);
  });
});