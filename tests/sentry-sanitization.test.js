const { sanitizeData } = require('../src/utils/error-reporter');

describe('Sentry data sanitization', () => {
  test('redacts sensitive fields regardless of naming convention', () => {
    const result = sanitizeData({
      password: 'secret',
      api_key: 'api-secret',
      accountNumber: '1234567890',
      bank_account: '9876543210',
      authorization: 'Bearer token',
      pin: '1234'
    });

    expect(Object.values(result)).toEqual([
      '[REDACTED]',
      '[REDACTED]',
      '[REDACTED]',
      '[REDACTED]',
      '[REDACTED]',
      '[REDACTED]'
    ]);
  });

  test('recursively sanitizes nested objects and arrays', () => {
    const result = sanitizeData({
      request: {
        body: [{ password: 'secret', status: 'active' }]
      }
    });

    expect(result.request.body[0]).toEqual({
      password: '[REDACTED]',
      status: 'active'
    });
  });

  test('masks email addresses', () => {
    expect(sanitizeData({ email: 'person@example.com' }).email)
      .toBe('pe***@example.com');
  });

  test('preserves unrelated diagnostic fields', () => {
    const result = sanitizeData({
      shipping: 'express',
      monkey: 'animal',
      status: 'active'
    });

    expect(result).toEqual({
      shipping: 'express',
      monkey: 'animal',
      status: 'active'
    });
  });
});
