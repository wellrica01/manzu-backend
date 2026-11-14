// tests/idempotency.test.js
// FND-10b: the idempotency middleware in each mode. Uses a mock prisma model
// so no database is touched.

process.env.SEC_IDEMPOTENCY_MODE = 'enforce';

const mockPrisma = {
  idempotencyKey: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $connect: jest.fn(() => Promise.resolve()),
  $disconnect: jest.fn(() => Promise.resolve()),
  $on: jest.fn(),
  $extends: jest.fn(function () { return mockPrisma; }),
};
jest.mock('../src/core/database/prisma', () => mockPrisma);

const express = require('express');
const request = require('supertest');

// Mock the actor context so currentActor returns a pharmacy user.
jest.mock('../src/core/context/actor-context', () => ({
  currentActor: jest.fn(() => ({ type: 'pharmacy_user', id: 7, pharmacyId: 3 })),
  currentRequestId: jest.fn(() => 'req-1'),
  runWithContext: jest.fn((_ctx, fn) => fn()),
}));

const { idempotency } = require('../src/middleware/idempotency');
const { sendError } = require('../src/core/errors/send-error');

const actorCtx = require('../src/core/context/actor-context');

function buildApp(handler) {
  const app = express();
  app.use(express.json());
  app.use(idempotency());
  app.post('/write', handler);
  app.use((err, req, res, _next) => sendError(res, 500, 'SERVER_ERROR'));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SEC_IDEMPOTENCY_MODE = 'enforce';
  mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
  mockPrisma.idempotencyKey.create.mockResolvedValue({});
  mockPrisma.idempotencyKey.update.mockResolvedValue({});
  mockPrisma.idempotencyKey.delete.mockResolvedValue({});
  actorCtx.currentActor.mockReturnValue({ type: 'pharmacy_user', id: 7, pharmacyId: 3 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.SEC_IDEMPOTENCY_MODE;
});

describe('idempotency middleware (FND-10b)', () => {
  test('off mode: no DB work, handler runs normally', async () => {
    process.env.SEC_IDEMPOTENCY_MODE = 'off';
    const app = buildApp((req, res) => res.json({ ok: true }));
    const r = await request(app).post('/write').set('Idempotency-Key', 'k1').send({ amount: 100 });
    expect(r.status).toBe(200);
    expect(mockPrisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  test('no Idempotency-Key header: handler runs without any DB work', async () => {
    const app = buildApp((req, res) => res.json({ ok: true }));
    const r = await request(app).post('/write').send({ amount: 100 });
    expect(r.status).toBe(200);
    expect(mockPrisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
  });

  test('no actor (unauthenticated): skip idempotency', async () => {
    actorCtx.currentActor.mockReturnValue(null);
    const app = buildApp((req, res) => res.json({ ok: true }));
    const r = await request(app).post('/write').set('Idempotency-Key', 'k1').send({ amount: 100 });
    expect(r.status).toBe(200);
    expect(mockPrisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
  });

  test('first call: create IN_PROGRESS, run handler, update COMPLETED', async () => {
    const app = buildApp((req, res) => res.json({ ok: true, amount: req.body.amount }));
    const r = await request(app)
      .post('/write')
      .set('Idempotency-Key', 'k1')
      .send({ amount: 100 });
    expect(r.status).toBe(200);
    expect(mockPrisma.idempotencyKey.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.idempotencyKey.create.mock.calls[0][0].data;
    expect(data.key).toBe('k1');
    expect(data.actorType).toBe('pharmacy_user');
    expect(data.actorId).toBe('7');
    expect(data.state).toBe('IN_PROGRESS');
    // The finish handler runs asynchronously; give it a tick.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockPrisma.idempotencyKey.update).toHaveBeenCalled();
    const updateData = mockPrisma.idempotencyKey.update.mock.calls[0][0].data;
    expect(updateData.state).toBe('COMPLETED');
    expect(updateData.responseStatus).toBe(200);
    expect(updateData.responseBody).toEqual({ ok: true, amount: 100 });
  });

  test('replay: COMPLETED row returns cached response with Idempotent-Replay', async () => {
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'k1',
      actorType: 'pharmacy_user',
      actorId: '7',
      requestHash: 'hash-matches',
      state: 'COMPLETED',
      responseStatus: 200,
      responseBody: { ok: true, replay: true },
      createdAt: new Date(),
    });
    // The test must produce a hash that matches 'hash-matches'. Easier:
    // don't care about exact match, override the check by using a body that
    // will fail mismatch and expect 422 instead. But we want the replay path.
    // Simplest: mock the hash function by giving the same body as before.
    // In practice: use _testHooks to compute the real hash for the body.
    const { hashRequest } = require('../src/middleware/idempotency')._testHooks;
    const fakeReq = { method: 'POST', originalUrl: '/write', body: { amount: 100 } };
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'k1',
      actorType: 'pharmacy_user',
      actorId: '7',
      requestHash: hashRequest(fakeReq),
      state: 'COMPLETED',
      responseStatus: 200,
      responseBody: { ok: true, replay: true },
      createdAt: new Date(),
    });
    const app = buildApp((req, res) => res.json({ ok: 'fresh' }));
    const r = await request(app)
      .post('/write')
      .set('Idempotency-Key', 'k1')
      .send({ amount: 100 });
    expect(r.status).toBe(200);
    expect(r.body.replay).toBe(true);
    expect(r.headers['idempotent-replay']).toBe('true');
  });

  test('mismatched hash: 422 IDEMPOTENCY_MISMATCH', async () => {
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'k1',
      actorType: 'pharmacy_user',
      actorId: '7',
      requestHash: 'some-other-hash',
      state: 'COMPLETED',
      responseStatus: 200,
      responseBody: { ok: true },
      createdAt: new Date(),
    });
    const app = buildApp((req, res) => res.json({ ok: true }));
    const r = await request(app)
      .post('/write')
      .set('Idempotency-Key', 'k1')
      .send({ amount: 999 });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('IDEMPOTENCY_MISMATCH');
  });

  test('concurrent IN_PROGRESS: 409 CONFLICT within the grace window', async () => {
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'k1',
      actorType: 'pharmacy_user',
      actorId: '7',
      requestHash: 'hash-matches',
      state: 'IN_PROGRESS',
      responseStatus: null,
      responseBody: null,
      createdAt: new Date(Date.now() - 5000), // 5s old
    });
    const app = buildApp((req, res) => res.json({ ok: true }));
    // The request body doesn't matter - state check hits first, but we need
    // a hash match to get past the mismatch check. Use the real hash.
    const { hashRequest } = require('../src/middleware/idempotency')._testHooks;
    const body = { amount: 100 };
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'k1',
      actorType: 'pharmacy_user',
      actorId: '7',
      requestHash: hashRequest({ method: 'POST', originalUrl: '/write', body }),
      state: 'IN_PROGRESS',
      createdAt: new Date(Date.now() - 5000),
    });
    const r = await request(app)
      .post('/write')
      .set('Idempotency-Key', 'k1')
      .send(body);
    expect(r.status).toBe(409);
  });

  test('failed (non-2xx) response deletes the row so the client can retry', async () => {
    const app = buildApp((req, res) => res.status(400).json({ error: 'VALIDATION_ERROR', message: 'bad' }));
    const r = await request(app)
      .post('/write')
      .set('Idempotency-Key', 'k1')
      .send({ amount: 100 });
    expect(r.status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockPrisma.idempotencyKey.delete).toHaveBeenCalled();
  });
});