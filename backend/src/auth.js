const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { auth } = require('./config');
const { pool } = require('./db');

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not set. Refusing to start in production.');
  }
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[reflex] JWT_SECRET not set; using a random development-only secret.');
}

const REFRESH_COOKIE = 'reflex_refresh';
let sessionTablePromise = null;

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: auth.accessTokenTtl });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function createRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function refreshMaxAgeMs() {
  return auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
}

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index < 0) return cookies;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    return cookies;
  }, {});
}

function setRefreshCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(refreshMaxAgeMs() / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearRefreshCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [`${REFRESH_COOKIE}=`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function ensureSessionTable() {
  if (!sessionTablePromise) {
    sessionTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        revoked_at TIMESTAMPTZ
      )
    `).then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)'))
      .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at)'));
  }
  return sessionTablePromise;
}

async function issueRefreshSession(userId) {
  await ensureSessionTable();
  const token = createRefreshToken();
  const hash = hashRefreshToken(token);
  await pool.query(
    'INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 * interval \'1 day\'))',
    [userId, hash, auth.refreshTokenTtlDays]
  );
  return token;
}

async function rotateRefreshSession(token) {
  await ensureSessionTable();
  const hash = hashRefreshToken(token);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, user_id, expires_at, revoked_at FROM auth_sessions WHERE token_hash=$1 FOR UPDATE`,
      [hash]
    );
    const session = rows[0];
    if (!session) { await client.query('ROLLBACK'); return null; }

    if (session.revoked_at || new Date(session.expires_at) <= new Date()) {
      if (session.revoked_at) {
        await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at, now()) WHERE user_id=$1 AND revoked_at IS NULL', [session.user_id]);
      }
      await client.query('ROLLBACK');
      return null;
    }

    const nextToken = createRefreshToken();
    const nextHash = hashRefreshToken(nextToken);
    await client.query('UPDATE auth_sessions SET revoked_at=now(), last_used_at=now() WHERE id=$1', [session.id]);
    await client.query(
      'INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 * interval \'1 day\'))',
      [session.user_id, nextHash, auth.refreshTokenTtlDays]
    );
    await client.query('COMMIT');
    return { userId: session.user_id, token: nextToken };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function revokeRefreshSession(token) {
  if (!token) return;
  await ensureSessionTable();
  await pool.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at, now()), last_used_at=now() WHERE token_hash=$1', [hashRefreshToken(token)]);
}

async function revokeAllRefreshSessions(userId) {
  await ensureSessionTable();
  await pool.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at, now()) WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
}

async function cleanupExpiredSessions() {
  await ensureSessionTable();
  await pool.query('DELETE FROM auth_sessions WHERE expires_at < now() OR (revoked_at IS NOT NULL AND revoked_at < now() - interval \'30 days\')');
}

function getRefreshToken(req) {
  return parseCookies(req.headers.cookie || '')[REFRESH_COOKIE] || null;
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

module.exports = {
  signToken,
  verifyToken,
  requireAuth,
  requireRole,
  JWT_SECRET,
  ensureSessionTable,
  issueRefreshSession,
  rotateRefreshSession,
  revokeRefreshSession,
  revokeAllRefreshSessions,
  cleanupExpiredSessions,
  getRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
};