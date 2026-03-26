const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function resolveUserFromHeader(header = '') {
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-passwordHash');
    return user || null;
  } catch {
    return null;
  }
}

async function auth(req, res, next) {
  const user = await resolveUserFromHeader(req.headers.authorization || '');
  if (!user) return res.status(401).json({ message: 'Authentication required' });
  req.user = user;
  next();
}

async function optionalAuth(req, _res, next) {
  req.user = await resolveUserFromHeader(req.headers.authorization || '');
  next();
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access only' });
  }
  next();
}

module.exports = { auth, optionalAuth, adminOnly };
