/**
 * DEVELOPMENT-ONLY MIDDLEWARE
 * 
 * Automatically disables debug/development endpoints in production
 * Returns 404 (not 403) to avoid information disclosure
 */

/**
 * Middleware to restrict endpoint to development environment only
 * 
 * Usage:
 * router.get('/debug', developmentOnly, async (req, res) => { ... });
 * 
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next function
 */
function developmentOnly(req, res, next) {
  const isDevelopment = process.env.NODE_ENV === 'development' || 
                        process.env.NODE_ENV === 'test';
  
  if (!isDevelopment) {
    // Return 404 instead of 403 to avoid information disclosure
    // Attackers shouldn't know the endpoint exists
    return res.status(404).json({ 
      message: 'Not found' 
    });
  }
  
  // Log access to development endpoints
  console.warn(`⚠️  Development endpoint accessed: ${req.method} ${req.path}`);
  
  next();
}

/**
 * Middleware to restrict endpoint to local development only (localhost)
 * Even stricter than developmentOnly - only works on localhost
 * 
 * Usage:
 * router.get('/debug', localOnly, async (req, res) => { ... });
 */
function localOnly(req, res, next) {
  const isLocal = req.hostname === 'localhost' || 
                  req.hostname === '127.0.0.1' ||
                  req.hostname === '::1';
  
  if (!isLocal) {
    return res.status(404).json({ 
      message: 'Not found' 
    });
  }
  
  console.warn(`⚠️  Local-only endpoint accessed: ${req.method} ${req.path} from ${req.ip}`);
  
  next();
}

/**
 * Middleware to completely disable an endpoint
 * Always returns 404
 * 
 * Usage:
 * router.get('/old-endpoint', disabled, async (req, res) => { ... });
 */
function disabled(req, res, next) {
  return res.status(404).json({ 
    message: 'Not found' 
  });
}

module.exports = {
  developmentOnly,
  localOnly,
  disabled
};
