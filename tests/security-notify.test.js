// tests/security-notify.test.js
// FND-12: security.notify sends a Sentry alert for critical events, no alert
// for info/warning, and rate-limits repeated critical events per
// (action, entityId) per 15 minutes.

const mockCapture = jest.fn();
const mockWithScope = jest.fn((cb) => {
  const scope = {
    setLevel: jest.fn(),
    setTag: jest.fn(),
    setUser: jest.fn(),
    setExtras: jest.fn(),
    setContext: jest.fn(),
  };
  cb(scope);
  mockCapture();
});

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  withScope: (...a) => mockWithScope(...a),
}));

// Reset the module cache so the fresh mock is picked up.
jest.resetModules();
const security = require('../src/core/audit/security-event');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('security.notify (FND-12)', () => {
  test('info severity: no Sentry call', () => {
    security.notify({ action: 'test.info', severity: 'info' });
    expect(mockWithScope).not.toHaveBeenCalled();
  });

  test('warning severity: no Sentry call', () => {
    security.notify({ action: 'test.warning', severity: 'warning' });
    expect(mockWithScope).not.toHaveBeenCalled();
  });

  test('critical severity: one Sentry call', () => {
    security.notify({
      action: 'test.critical',
      severity: 'critical',
      entityType: 'PharmacyUser',
      entityId: 42,
    });
    expect(mockWithScope).toHaveBeenCalledTimes(1);
  });

  test('critical flood: rate-limited to one per (action, entityId) per 15min', () => {
    for (let i = 0; i < 5; i++) {
      security.notify({
        action: 'test.flood',
        severity: 'critical',
        entityType: 'PharmacyUser',
        entityId: 99,
      });
    }
    // The first call goes through; the other four are rate-limited.
    expect(mockWithScope).toHaveBeenCalledTimes(1);
  });

  test('different entityId: not rate-limited by another entity', () => {
    security.notify({ action: 'test.multi', severity: 'critical', entityType: 'PharmacyUser', entityId: 1 });
    security.notify({ action: 'test.multi', severity: 'critical', entityType: 'PharmacyUser', entityId: 2 });
    expect(mockWithScope).toHaveBeenCalledTimes(2);
  });

  test('never throws on malformed input', () => {
    expect(() => security.notify(null)).not.toThrow();
    expect(() => security.notify({})).not.toThrow();
    expect(() => security.notify({ action: 'x', severity: 'critical' })).not.toThrow();
  });
});