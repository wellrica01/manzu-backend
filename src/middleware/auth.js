// auth.js
const jwt = require('jsonwebtoken');

// Placeholder logger; replace with Winston, Pino, or another logger in production
const logger = {
  info: console.log,
  error: console.error,
};

/**
 * Middleware: Authenticate JWT and attach user info to req.user
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    logger.error('Authentication failed: No Authorization header');
    return res.status(401).json({ error: 'NO_TOKEN', message: 'No token provided' });
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    logger.error('Authentication failed: Malformed Authorization header');
    return res.status(401).json({ error: 'INVALID_FORMAT', message: 'Authorization header must be in Bearer token format' });
  }

  try {
    // Enforce HS256 algorithm explicitly
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    // Attach user info to request
    req.user = decoded;

    logger.info('Token verified', { userId: decoded.userId, pharmacyId: decoded.pharmacyId, adminId: decoded.adminId, role: decoded.role });
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      logger.error('Authentication failed: Token expired');
      return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Token expired' });
    }
    logger.error('Authentication failed: Invalid token', { message: err.message });
    return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Invalid token' });
  }
}

/**
 * Middleware: Authorize by role(s)
 * Usage: authorizeRoles('ADMIN', 'SUPER_ADMIN')
 */
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      logger.error('Authorization failed: Insufficient permissions', { userId: req.user?.userId, adminId: req.user?.adminId, role: req.user?.role });
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have permission to perform this action' });
    }
    next();
  };
}

module.exports = { authenticate, authorizeRoles };
