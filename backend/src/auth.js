const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Fail loudly in production if no secret is configured — no silent fallback
// to a value that's sitting in a public GitHub repo. In development, generate
// a random per-process secret so the app still boots for local testing, but
// warn clearly since tokens won't survive a restart.
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is not set. Refusing to start in production without it — ' +
      'set a long random value via your environment/secrets manager.'
    );
  }
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[reflex] WARNING: JWT_SECRET not set. Using a random secret for this ' +
    'process only — all tokens will be invalidated on restart. Set ' +
    'JWT_SECRET in your environment before deploying.'
  );
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole, JWT_SECRET };
