const { ZodError } = require('zod');

function handleError(res, error) {
  console.error('Route error:', {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.errors.map(e => ({
        path: e.path,
        message: e.message
      }))
    });
  }

  // Fallback for other errors
  const status = error.status || error.statusCode || 500;
  const message = (error.status || error.statusCode)
    ? error.message
    : 'Internal server error';

  return res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
}

module.exports = { handleError };
