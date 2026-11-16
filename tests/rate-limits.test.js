// tests/rate-limits.test.js
// P-04 follow-on (Doc 2 section 5.4): the login rate-limit config.
//
// Locks the spec into CI:
//   - the IP bucket is a distinct class 'auth_ip', max 30 / 15 min
//   - the old 'auth' key is gone (no accidental dual bucket)
//   - CLASSES includes 'auth_ip'
//   - AUTH_RATE_LIMIT (compat export) points at auth_ip
//   - authLimiter actually calls throttle.hit with class 'auth_ip', max 30,
//     keyed on the client IP, and returns 429 RATE_LIMITED on deny.
//
// Uses the real memory store, spied so the arguments are inspectable.
// Same technique as throttle.test.js (real store, _resetAll between tests).

process.env.THROTTLE_STORE = 'memory';

jest.mock('../src/core/audit/security-event', () => ({
  record: jest.fn(() => Promise.resolve()),
  notify: jest.fn(),
}));

const throttle = require('../src/core/throttle');
const memoryStore = require('../src/core/throttle/memory-store');
const security = require('../src/core/audit/security-event');
const { RATE_LIMITS, CLASSES, AUTH_RATE_LIMIT } = require('../src/config/rate-limits');
const { authLimiter } = require('../src/middleware/rate-limiting');

beforeEach(() => {
  memoryStore._resetAll();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('rate-limit config (Doc 2 section 5.4)', () => {
  test('auth_ip is the per-IP bucket: class auth_ip, max 30 / 15 min', () => {
    const cfg = RATE_LIMITS.auth_ip;
    expect(cfg).toBeTruthy();
    expect(cfg.class).toBe('auth_ip');
    expect(cfg.max).toBe(30);
    expect(cfg.windowMs).toBe(15 * 60 * 1000);
    expect(cfg.lockoutMinutes).toBe(15);
    expect(cfg.countAll).toBe(true);
  });

  test('the old `auth` key no longer exists', () => {
    expect(RATE_LIMITS.auth).toBeUndefined();
  });

  test('CLASSES includes auth_ip and not auth', () => {
    expect(CLASSES).toContain('auth_ip');
    expect(CLASSES).not.toContain('auth');
    expect(CLASSES).toContain('login');
  });

  test('AUTH_RATE_LIMIT compat export points at auth_ip', () => {
    expect(AUTH_RATE_LIMIT).toBe(RATE_LIMITS.auth_ip);
    expect(AUTH_RATE_LIMIT.class).toBe('auth_ip');
  });
});

describe('authLimiter wiring', () => {
  function fakeReq(ip) {
    return { ip, headers: {} };
  }
  function fakeRes() {
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      setHeader: jest.fn(function (k, v) { res.headers[k] = v; }),
      status: jest.fn(function (c) { res.statusCode = c; return res; }),
      json: jest.fn(function (b) { res.body = b; return res; }),
    };
    return res;
  }

  test('calls throttle.hit with class auth_ip, max 30, key = client IP', async () => {
    const hitSpy = jest.spyOn(throttle, 'hit').mockResolvedValue({
      allowed: true, retryAfterMs: 0, count: 1, level: 0,
    });
    const req = fakeReq('1.2.3.4');
    const res = fakeRes();
    const next = jest.fn();

    await authLimiter(req, res, next);

    expect(hitSpy).toHaveBeenCalledTimes(1);
    const args = hitSpy.mock.calls[0][0];
    expect(args.class).toBe('auth_ip');
    expect(args.key).toBe('1.2.3.4');
    expect(args.max).toBe(30);
    expect(args.windowMs).toBe(15 * 60 * 1000);
    expect(args.lockoutMinutes).toBe(15);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  test('on deny, returns 429 RATE_LIMITED with Retry-After and records a security event', async () => {
    jest.spyOn(throttle, 'hit').mockResolvedValue({
      allowed: false, retryAfterMs: 30_000, count: 31, level: 1,
    });
    const req = fakeReq('5.6.7.8');
    const res = fakeRes();
    const next = jest.fn();

    await authLimiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('30');
    expect(res.body.error).toBe('RATE_LIMITED');
    expect(security.record).toHaveBeenCalledTimes(1);
    const evt = security.record.mock.calls[0][1];
    expect(evt.action).toBe('security.rate_limited');
    expect(evt.entityId).toBe('auth_ip');
  });

  test('on throttle store failure, fails open (calls next, does not throw)', async () => {
    jest.spyOn(throttle, 'hit').mockRejectedValue(new Error('store down'));
    const req = fakeReq('9.9.9.9');
    const res = fakeRes();
    const next = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await authLimiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});