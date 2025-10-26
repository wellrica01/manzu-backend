/**
 * CENTRALIZED ERROR HANDLER
 * 
 * Express error handling middleware
 * Moved from middleware to core for better organization
 */

const { HTTP_STATUS, ERROR_CODES } = require('../../config/constants');

/**
 * Error handler middleware
 * Must be registered last in middleware chain
 */
function errorHandler(err, req, res, next) {
  // Log error
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  // Report to Sentry
  if (global.Sentry) {
    global.Sentry.captureException(err, {
      tags: {
        path: req.path,
        method: req.method,
      },
      extra: {
        body: req.body,
        query: req.query,
        params: req.params,
      },
    });
  }

  // Determine status code
  const statusCode = err.statusCode || err.status || HTTP_STATUS.INTERNAL_ERROR;
  
  // Determine error code
  const errorCode = err.code || ERROR_CODES.INTERNAL_ERROR;

  // Build error response
  const response = {
    success: false,
    error: errorCode,
    message: err.message || 'Internal server error',
  };

  // Include validation errors if present
  if (err.errors) {
    response.errors = err.errors;
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res) {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    success: false,
    error: ERROR_CODES.NOT_FOUND,
    message: `Route ${req.method} ${req.path} not found`,
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
};