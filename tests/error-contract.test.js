// tests/error-contract.test.js
// Proves Doc 1 §5.4: every 4xx and 5xx carries { error, message, requestId },
// and a 500 never leaks err.message. Uses the real handler and the shared
// sendError — no DB, no server, no Sentry.

const express = require('express');
const request = require('supertest');

const { errorHandler } = require('../src/middleware/error-handler');
const { sendError } = require('../src/core/errors/send-error');
const { CODES, isKnownCode } = require('../src/core/errors/codes');

function buildApp(route) {
  const app = express();
  app.use((req, res, next) => { req.requestId = 'test-req'; next(); });
  route(app);
  app.use(errorHandler);
  return app;
}

describe('error contract', () => {
  it('sendError returns error, message, requestId, statusCode', async () => {
    const app = buildApp((a) => {
      a.get('/t', (req, res) => sendError(res, 400, 'VALIDATION_ERROR', 'Bad input'));
    });
    const r = await request(app).get('/t');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('VALIDATION_ERROR');
    expect(r.body.message).toBe('Bad input');
    expect(r.body.requestId).toBe('test-req');
    expect(r.body.statusCode).toBe(400);
  });

  it('sendError falls back to a known code when given garbage', async () => {
    const app = buildApp((a) => {
      a.get('/t', (req, res) => sendError(res, 429, 'NOT_A_REAL_CODE'));
    });
    const r = await request(app).get('/t');
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('RATE_LIMITED');
  });

  it('sendError carries details when given', async () => {
    const app = buildApp((a) => {
      a.get('/t', (req, res) => sendError(res, 400, 'VALIDATION_ERROR', 'Bad', { details: 'x' }));
    });
    const r = await request(app).get('/t');
    expect(r.body.details).toEqual({ details: 'x' });
  });

  it('handler scrubs err.message on 500', async () => {
    const app = buildApp((a) => {
      a.get('/t', (req, res, next) => {
        const e = new Error('SEKRET db connection string');
        e.statusCode = 500;
        next(e);
      });
    });
    const r = await request(app).get('/t');
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('SERVER_ERROR');
    expect(r.body.message).toBe('Something went wrong');
    expect(JSON.stringify(r.body)).not.toMatch(/SEKRET/);
  });

  it('handler maps AppError categories to codes', async () => {
    const app = buildApp((a) => {
      a.get('/t', (req, res, next) => {
        const e = new Error('who');
        e.statusCode = 401;
        e.category = 'AUTH';
        next(e);
      });
    });
    const r = await request(app).get('/t');
    expect(r.body.error).toBe('UNAUTHENTICATED');
    expect(r.body.message).toBe('who');
  });

  it('every CODES entry has numeric status and message', () => {
    for (const [name, info] of Object.entries(CODES)) {
      expect(isKnownCode(name)).toBe(true);
      expect(typeof info.status).toBe('number');
      expect(info.status).toBeGreaterThanOrEqual(400);
      expect(typeof info.message).toBe('string');
      expect(info.message.length).toBeGreaterThan(0);
    }
  });

  it('legacy codes are preserved for the current mobile build', () => {
    for (const k of ['NO_TOKEN', 'INVALID_FORMAT', 'INVALID_TOKEN', 'REFRESH_TOKEN_REUSED']) {
      expect(CODES[k]).toBeDefined();
      expect(CODES[k].legacy).toBe(true);
    }
  });
});
