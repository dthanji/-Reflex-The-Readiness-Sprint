const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { auth } = require('./config');

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not set. Refusing to start in production.');
  }
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[reflex] JWT_SECRET not set; using a random development-only secret.');
}

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: auth.accessTokenTtl });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try { req.user = verifyToken(token); next(); }
  catch (err) { return res.status(401).json({ error: 'Invalid or expired token' }); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    next();
  };
}

module.exports = { signToken, verifyToken, requireAuth, requireRole, JWT_SECRET };
