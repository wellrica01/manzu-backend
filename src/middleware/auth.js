const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('No token provided');
    return res.status(401).json({ message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, pharmacyId, role } or { adminId, role }
    console.log('Token verified:', { userId: decoded.userId, pharmacyId: decoded.pharmacyId, adminId: decoded.adminId, role: decoded.role });
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    console.error('Invalid token:', { message: error.message });
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function authenticateAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    console.error('Unauthorized: Not an admin', { adminId: req.user?.adminId });
    return res.status(403).json({ message: 'Only admins can perform this action' });
  }
  next();
}

function authenticateManager(req, res, next) {
  if (!req.user || req.user.role !== 'manager') {
    console.error('Unauthorized: Not a manager', { userId: req.user?.userId });
    return res.status(403).json({ message: 'Only managers can perform this action' });
  }
  next();
}

module.exports = { authenticate, authenticateAdmin, authenticateManager };