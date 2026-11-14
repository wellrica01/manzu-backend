// tests/require-stepup.test.js
// FND-08b: the requireStepUp middleware. Uses mocked prisma and throttle so
// no DB is touched. Tokens are signed with the same getSecretFor('stepup')
// the service uses.

process.env.SEC_STEPUP_ENFORCE = 'enforce';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const mockPrisma = {
  $connect: jest.fn(() => Promise.resolve()),
  $disconnect: jest.fn(() => Promise.resolve()),
  $on: jest.fn(),
  $extends: jest.fn(function () { return mockPrisma; }),
};
jest.mock('../src/core/database/prisma', () => mockPrisma);

jest.mock('../src/core/audit/security-event', () => ({
  record: jest.fn(() => Promise.resolve()),
  notify: jest.fn(),
}));

jest.mock('../src/core/context/actor-context', () => ({
  currentActor: jest.fn(() => ({ type: 'pharmacy_user', id: 6, pharmacyId: 7, role: 'MANAGER', sessionId: 'sess-abc' })),
  currentRequestId: jest.fn(() => 'req-1'),
  runWithContext: jest.fn((_ctx, fn) => fn()),
}));

// Mock the throttle so T3 single-use is testable: first hit allowed, subsequent denied.
let mockThrottleCalls = 0;
jest.mock('../src/core/throttle', () => ({
  hit: jest.fn(async () => {
    mockThrottleCalls += 1;
    return { allowed: mockThrottleCalls === 1, retryAfterMs: 1000, count: mockThrottleCalls, level: 0 };
  }),
  reset: jest.fn(() => Promise.resolve()),
}));

const jwt = require('jsonwebtoken');
const { getSecretFor } = require('../src/utils/env-validator');
const { requireStepUp } = require('../src/core/authz/require-stepup');
const actorCtx = require('../src/core/context/actor-context');

function signStepUp({ userId = 6, sid = 'sess-abc', scope = 'banking.manage', tier = 'T2', jti = 'jti-1', expSec = 300 } = {}) {
  return jwt.sign(
    { userId, sid, scope, tier, jti },
    getSecretFor('stepup'),
    { expiresIn: expSec, algorithm: 'HS256', issuer: 'manzu', audience: 'stepup' }
  );
}

function buildApp(scope) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.post('/write', requireStepUp(scope), (req, res) => res.json({ ok: true }));
  app.use((err, req, res, _next) => res.status(500).json({ error: 'SERVER_ERROR' }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockThrottleCalls = 0;
  process.env.SEC_STEPUP_ENFORCE = 'enforce';
  actorCtx.currentActor.mockReturnValue({ type: 'pharmacy_user', id: 6, pharmacyId: 7, role: 'MANAGER', sessionId: 'sess-abc' });
});

afterEach(() => {
  delete process.env.SEC_STEPUP_ENFORCE;
});

describe('requireStepUp (FND-08b)', () => {
  test('off mode passes through without checking', async () => {
    process.env.SEC_STEPUP_ENFORCE = 'off';
    const request = require('supertest');
    const app = buildApp('banking.manage');
    const r = await request(app).post('/write').send({});
    expect(r.status).toBe(200);
  });

  test('valid token: 200', async () => {
    const request = require('supertest');
    const app = buildApp('banking.manage');
    const r = await request(app)
      .post('/write')
      .set('X-Step-Up', signStepUp({ scope: 'banking.manage' }))
      .send({});
    expect(r.status).toBe(200);
  });

  test('missing header: 403 STEP_UP_REQUIRED', async () => {
    const request = require('supertest');
    const app = buildApp('banking.manage');
    const r = await request(app).post('/write').send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('STEP_UP_REQUIRED');
  });

  test('wrong scope: 403 STEP_UP_REQUIRED', async () => {
    const request = require('supertest');
    const app = buildApp('banking.manage');
    const r = await request(app)
      .post('/write')
      .set('X-Step-Up', signStepUp({ scope: 'other.scope' }))
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('STEP_UP_REQUIRED');
  });

  test('wrong session (sid mismatch): 403 STEP_UP_INVALID', async () => {
    const request = require('supertest');
    const app = buildApp('banking.manage');
    const r = await request(app)
      .post('/write')
      .set('X-Step-Up', signStepUp({ sid: 'other-session' }))
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('STEP_UP_INVALID');
  });

  test('missing sid on token: 403 STEP_UP_INVALID (strict)', async () => {
    const request = require('supertest');
    const app = buildApp('banking.manage');
    // Token without a sid claim.
    const bad = jwt.sign(
      { userId: 6, scope: 'banking.manage', tier: 'T2', jti: 'x' },
      getSecretFor('stepup'),
      { expiresIn: 300, algorithm: 'HS256', issuer: 'manzu', audience: 'stepup' }
    );
    const r = await request(app).post('/write').set('X-Step-Up', bad).send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('STEP_UP_INVALID');
  });

  test('expired token: 403 STEP_UP_REQUIRED', async () => {
    const request = require('supertest');
    const app = buildApp('banking.manage');
    const expired = signStepUp({ expSec: -10 });
    const r = await request(app).post('/write').set('X-Step-Up', expired).send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('STEP_UP_REQUIRED');
  });

  test('invalid signature: 403 STEP_UP_INVALID', async () => {
    const request = require('supertest');
    const app = buildApp('banking.manage');
    const bad = jwt.sign({ userId: 6, sid: 'sess-abc', scope: 'banking.manage', tier: 'T2', jti: 'x' }, 'wrong-secret', { expiresIn: 300, algorithm: 'HS256', issuer: 'manzu', audience: 'stepup' });
    const r = await request(app).post('/write').set('X-Step-Up', bad).send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('STEP_UP_INVALID');
  });

  test('T3 token: first use succeeds, second use is rejected', async () => {
    const request = require('supertest');
    const app = buildApp('banking.manage');
    const t3 = signStepUp({ tier: 'T3', jti: 'unique-t3-1' });
    const first = await request(app).post('/write').set('X-Step-Up', t3).send({});
    expect(first.status).toBe(200);
    const second = await request(app).post('/write').set('X-Step-Up', t3).send({});
    expect(second.status).toBe(403);
    expect(second.body.error).toBe('STEP_UP_INVALID');
  });

  test('T2 token can be reused within its TTL', async () => {
    const request = require('supertest');
    const app = buildApp('banking.manage');
    const t2 = signStepUp({ tier: 'T2', jti: 'unique-t2-1' });
    const first = await request(app).post('/write').set('X-Step-Up', t2).send({});
    expect(first.status).toBe(200);
    const second = await request(app).post('/write').set('X-Step-Up', t2).send({});
    expect(second.status).toBe(200);
  });

  test('log mode: missing header passes through', async () => {
    process.env.SEC_STEPUP_ENFORCE = 'log';
    const request = require('supertest');
    const app = buildApp('banking.manage');
    const r = await request(app).post('/write').send({});
    expect(r.status).toBe(200);
  });
});