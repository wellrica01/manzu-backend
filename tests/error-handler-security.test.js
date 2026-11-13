
const { errorHandler } = require('../src/middleware/error-handler');

describe('Error handler security - Phase 0.5', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
    requestId: 'test-request-123',
    path: '/test',
    method: 'GET',
    get: jest.fn().mockReturnValue(null),
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    next = jest.fn();

    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('hides internal error details and includes requestId for 500 errors', () => {
    const error = new Error('Database password exposed');

    error.statusCode = 500;

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);

    const response = res.json.mock.calls[0][0];

    expect(response.message).toBe('Internal server error');
    expect(response.requestId).toBe('test-request-123');
    expect(JSON.stringify(response)).not.toContain('Database password exposed');
    expect(response.stack).toBeUndefined();
  });

  test('preserves safe validation messages for 400 errors', () => {
    const error = new Error('Email address is invalid');

    error.statusCode = 400;

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);

    const response = res.json.mock.calls[0][0];

    expect(response.message).toBe('Email address is invalid');
    expect(response.requestId).toBe('test-request-123');
    expect(response.stack).toBeUndefined();
  });

  test('does not expose stack traces for server errors', () => {
    const error = new Error('Sensitive internal failure');

    error.statusCode = 503;

    errorHandler(error, req, res, next);

    const response = res.json.mock.calls[0][0];

    expect(response.message).toBe('Internal server error');
    expect(response.requestId).toBe('test-request-123');
    expect(response.stack).toBeUndefined();
  });
});
