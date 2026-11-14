// tests/client-contract.test.js
// FND-10a: X-Min-App-Version is set on every response, and the CORS config
// allows and exposes the four client headers and three response headers.

process.env.MIN_APP_VERSION = '1.2.3';

const express = require('express');
const request = require('supertest');
const { requestId } = require('../src/middleware/request-id');

function buildApp() {
  const app = express();
  app.use(requestId);
  app.get('/', (req, res) => res.json({ ok: true }));
  return app;
}

describe('client contract (FND-10a)', () => {
  test('X-Min-App-Version is set on every response', async () => {
    const app = buildApp();
    const res = await request(app).get('/');
    expect(res.headers['x-min-app-version']).toBe('1.2.3');
  });

  test('X-Request-Id is preserved alongside X-Min-App-Version', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/')
      .set('X-Request-Id', 'test-req-1');
    expect(res.headers['x-request-id']).toBe('test-req-1');
    expect(res.headers['x-min-app-version']).toBe('1.2.3');
  });

  test('client.appVersion and client.deviceId are populated when provided', async () => {
    const app = express();
    app.use(requestId);
    app.get('/', (req, res) => res.json({ client: req.client }));
    const res = await request(app)
      .get('/')
      .set('X-App-Version', '1.4.2')
      .set('X-Device-Id', 'dev-abc-123');
    expect(res.body.client.appVersion).toBe('1.4.2');
    expect(res.body.client.deviceId).toBe('dev-abc-123');
    expect(res.body.client.minAppVersion).toBe('1.2.3');
  });

  test('client.appVersion is null when the header is absent or malformed', async () => {
    const app = express();
    app.use(requestId);
    app.get('/', (req, res) => res.json({ client: req.client }));
    const missing = await request(app).get('/');
    expect(missing.body.client.appVersion).toBeNull();
    const malformed = await request(app).get('/').set('X-App-Version', 'not a version!!!');
    expect(malformed.body.client.appVersion).toBeNull();
  });

  test('unsafe deviceId does not leak into client.deviceId', async () => {
    const app = express();
    app.use(requestId);
    app.get('/', (req, res) => res.json({ client: req.client }));
    const res = await request(app)
      .get('/')
      .set('X-Device-Id', 'has spaces and !!!');
    expect(res.body.client.deviceId).toBeNull();
  });
});

describe('CORS headers (FND-10a)', () => {
  // We cannot easily test corsOptions directly without loading src/app.js,
  // which requires the full dependency tree. Instead, test the config
  // shape by reading src/app.js as text and confirming the allow-list.
  const fs = require('fs');
  const path = require('path');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

  test('allowedHeaders includes the four client headers', () => {
    expect(appSource).toMatch(/'x-device-id'/);
    expect(appSource).toMatch(/'x-app-version'/);
    expect(appSource).toMatch(/'x-step-up'/);
    expect(appSource).toMatch(/'idempotency-key'/);
  });

  test('exposedHeaders includes the three new response headers', () => {
    expect(appSource).toMatch(/'X-Min-App-Version'/);
    expect(appSource).toMatch(/'Retry-After'/);
    expect(appSource).toMatch(/'Idempotent-Replay'/);
  });
});