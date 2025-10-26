/**
 * CUSTOM ERROR HANDLER MIDDLEWARE
 * 
 * Centralized error handling for Express
 * Integrates with Sentry for error tracking
 */

const { reportError, ErrorLevel, ErrorCategory } = require('../utils/error-reporter');

/**
 * Custom error classes
 */
class AppError extends Error {
  constructor(message, statusCode = 500, category = ErrorCategory.SYSTEM) {
    super(message);
    this.statusCode = statusCode;
    this.category = category;
    this.isOperational = true; // Operational errors vs programming errors
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400, ErrorCategory.VALIDATION);
    this.field = field;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401, ErrorCategory.AUTH);
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, ErrorCategory.AUTH);
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, ErrorCategory.SYSTEM);
  }
}

class PaymentError extends AppError {
  constructor(message, transactionId = null) {
    super(message, 402, ErrorCategory.PAYMENT);
    this.transactionId = transactionId;
  }
}

class StockError extends AppError {
  constructor(message, medicationId = null, pharmacyId = null) {
    super(message, 409, ErrorCategory.STOCK);
    this.medicationId = medicationId;
    this.pharmacyId = pharmacyId;
  }
}

class DatabaseError extends AppError {
  constructor(message, operation = null) {
    super(message, 500, ErrorCategory.DATABASE);
    this.operation = operation;
  }
}

class ExternalAPIError extends AppError {
  constructor(message, api = null, statusCode = 502) {
    super(message, statusCode, ErrorCategory.EXTERNAL_API);
    this.api = api;
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, ErrorCategory.RATE_LIMIT);
  }
}

/**
 * Determine error level based on status code and category
 */
function getErrorLevel(error) {
  // Critical errors
  if (error.category === ErrorCategory.PAYMENT) return ErrorLevel.CRITICAL;
  if (error.category === ErrorCategory.DATABASE) return ErrorLevel.CRITICAL;
  if (error.category === ErrorCategory.WEBHOOK) return ErrorLevel.CRITICAL;
  
  // Errors
  if (error.statusCode >= 500) return ErrorLevel.ERROR;
  if (error.category === ErrorCategory.EXTERNAL_API) return ErrorLevel.ERROR;
  
  // Warnings
  if (error.statusCode >= 400 && error.statusCode < 500) return ErrorLevel.WARNING;
  if (error.category === ErrorCategory.VALIDATION) return ErrorLevel.WARNING;
  if (error.category === ErrorCategory.RATE_LIMIT) return ErrorLevel.WARNING;
  
  return ErrorLevel.ERROR;
}

/**
 * Format error response for client
 */
function formatErrorResponse(error, includeStack = false) {
  const response = {
    message: error.message || 'An error occurred',
    statusCode: error.statusCode || 500
  };

  // Add field for validation errors
  if (error.field) {
    response.field = error.field;
  }

  // Add error code for categorization
  if (error.category) {
    response.code = error.category.toUpperCase();
  }

  // Include stack trace only in development
  if (includeStack && process.env.NODE_ENV !== 'production') {
    response.stack = error.stack;
  }

  return response;
}

/**
 * Main error handler middleware
 * Must be registered LAST in middleware chain
 */
function errorHandler(err, req, res, next) {
  // Log error details
  console.error('Error caught by handler:', {
    message: err.message,
    statusCode: err.statusCode,
    category: err.category,
    path: req.path,
    method: req.method
  });

  // Determine if this is an operational error
  const isOperational = err.isOperational || false;

  // Get error level
  const level = getErrorLevel(err);

  // Report to Sentry (only operational errors or critical issues)
  if (!isOperational || level === ErrorLevel.CRITICAL) {
    reportError(err, {
      level,
      category: err.category || ErrorCategory.SYSTEM,
      user: req.user,
      request: req,
      orderId: err.orderId || req.body?.orderId || req.query?.orderId,
      pharmacyId: err.pharmacyId || req.body?.pharmacyId || req.query?.pharmacyId,
      transactionId: err.transactionId || req.body?.transactionId,
      customContext: {
        isOperational,
        userAgent: req.get('user-agent'),
        referer: req.get('referer')
      }
    });
  }

  // Format response
  const statusCode = err.statusCode || 500;
  const includeStack = process.env.NODE_ENV !== 'production';
  const response = formatErrorResponse(err, includeStack);

  // Send response
  res.status(statusCode).json(response);
}

/**
 * Handle 404 errors (route not found)
 */
function notFoundHandler(req, res, next) {
  const error = new NotFoundError('Route');
  error.statusCode = 404;
  next(error);
}

/**
 * Async error wrapper
 * Wraps async route handlers to catch errors
 * 
 * Usage:
 * router.get('/route', asyncHandler(async (req, res) => {
 *   // async code
 * }));
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Handle unhandled promise rejections
 */
function handleUnhandledRejection() {
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    
    const error = new Error(`Unhandled Rejection: ${reason}`);
    reportError(error, {
      level: ErrorLevel.CRITICAL,
      category: ErrorCategory.SYSTEM,
      customContext: {
        reason: reason?.toString(),
        type: 'unhandledRejection'
      }
    });
  });
}

/**
 * Handle uncaught exceptions
 */
function handleUncaughtException() {
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    
    reportError(error, {
      level: ErrorLevel.CRITICAL,
      category: ErrorCategory.SYSTEM,
      customContext: {
        type: 'uncaughtException'
      }
    });

    // Give Sentry time to send the error
    setTimeout(() => {
      console.error('Uncaught exception - shutting down gracefully');
      process.exit(1);
    }, 1000);
  });
}

/**
 * Initialize error handlers
 */
function initializeErrorHandlers() {
  handleUnhandledRejection();
  handleUncaughtException();
  
  console.log('✅ Error handlers initialized');
}

module.exports = {
  // Custom error classes
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  PaymentError,
  StockError,
  DatabaseError,
  ExternalAPIError,
  RateLimitError,
  
  // Middleware
  errorHandler,
  notFoundHandler,
  asyncHandler,
  
  // Initialization
  initializeErrorHandlers
};
