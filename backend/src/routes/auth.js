const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { signToken } = require('../auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, phone, password, role } = req.body;
  if (!name || !phone || !password || !role) {
    return res.status(400).json({ error: 'name, phone, password, role are required' });
  }
  if (!['retailer', 'dispatcher', 'rider'].includes(role)) {
    return res.status(400).json({ error: 'role must be retailer, dispatcher, or rider' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, phone, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, phone, role`,
      [name, phone, hash, role]
    );
    const user = rows[0];
    res.status(201).json({ user, token: signToken(user) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Phone number already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'phone and password are required' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const safeUser = { id: user.id, name: user.name, phone: user.phone, role: user.role };
    res.json({ user: safeUser, token: signToken(safeUser) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
