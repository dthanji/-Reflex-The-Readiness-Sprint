const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const {
  signToken,
  ensureSessionTable,
  issueRefreshSession,
  rotateRefreshSession,
  revokeRefreshSession,
  cleanupExpiredSessions,
  getRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
} = require('../auth');

const router = express.Router();

async function authenticateResponse(res, user) {
  const token = signToken(user);
  const refreshToken = await issueRefreshSession(user.id);
  setRefreshCookie(res, refreshToken);
  return { user, token };
}

router.post('/register', async (req, res) => {
  const { name, phone, password, role } = req.body;
  if (!name || !phone || !password || !role) {
    return res.status(400).json({ error: 'name, phone, password, role are required' });
  }
  if (!['retailer', 'dispatcher', 'rider'].includes(role)) {
    return res.status(400).json({ error: 'role must be retailer, dispatcher, or rider' });
  }
  try {
    await ensureSessionTable();
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, phone, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, phone, role`,
      [name, phone, hash, role]
    );
    const user = rows[0];
    res.status(201).json(await authenticateResponse(res, user));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Phone number already registered' });
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'phone and password are required' });
  try {
    await ensureSessionTable();
    await cleanupExpiredSessions();
    const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const safeUser = { id: user.id, name: user.name, phone: user.phone, role: user.role };
    res.json(await authenticateResponse(res, safeUser));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const current = getRefreshToken(req);
    if (!current) return res.status(401).json({ error: 'No refresh session' });
    const rotated = await rotateRefreshSession(current);
    if (!rotated) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh session expired or revoked' });
    }
    const { rows } = await pool.query('SELECT id, name, phone, role FROM users WHERE id=$1', [rotated.userId]);
    const user = rows[0];
    if (!user) {
      await revokeRefreshSession(rotated.token);
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'User no longer exists' });
    }
    setRefreshCookie(res, rotated.token);
    res.json({ user, token: signToken(user) });
  } catch (err) {
    console.error(err);
    clearRefreshCookie(res);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const current = getRefreshToken(req);
    if (current) await revokeRefreshSession(current);
    clearRefreshCookie(res);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    clearRefreshCookie(res);
    res.status(204).end();
  }
});

module.exports = router;
