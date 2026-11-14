// tests/setup.js
// Minimal Jest setup. Restores the file referenced by package.json
// `setupFilesAfterEach` (NEW-05) without touching a real database.

process.env.NODE_ENV = 'test';
process.env.SENTRY_DSN = '';
process.env.SENTRY_ENVIRONMENT = 'test';
process.env.SENTRY_TRACES_SAMPLE_RATE = '0';
process.env.SENTRY_PROFILES_SAMPLE_RATE = '0';

// validateJWTSecret refuses weak secrets and refuses to start if the secret
// is missing. Tests that import app.js must satisfy both.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';
}

// Silence noise unless the developer asks for it.
if (process.env.TEST_VERBOSE !== '1') {
  const noop = () => {};
  global.console = {
    ...console,
    log: noop,
    info: noop,
    warn: noop,
    error: console.error,
  };
}

// Note: no afterEach here. Jest global calls belong in test files, not in
// a setup file that other tools may require. Jest config sets
// `clearMocks: true` (added to package.json in the same step) instead.
