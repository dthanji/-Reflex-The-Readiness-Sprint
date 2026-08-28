const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const hub = require('../websocket/hub');

const router = express.Router();

// Retailer logs a new delivery request.
router.post('/', requireAuth, requireRole('retailer'), async (req, res) => {
  const { customer_name, customer_phone, address, item_description } = req.body;
  if (!customer_name || !customer_phone || !address || !item_description) {
    return res.status(400).json({ error: 'customer_name, customer_phone, address, item_description are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO delivery_requests (retailer_id, customer_name, customer_phone, address, item_description)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, customer_name, customer_phone, address, item_description]
    );
    const request = rows[0];

    const eventRes = await client.query(
      `INSERT INTO status_events (delivery_request_id, status, actor_id)
       VALUES ($1, 'REQUESTED', $2) RETURNING *`,
      [request.id, req.user.id]
    );
    await client.query('COMMIT');

    hub.broadcastNewRequest({ ...request, current_status: 'REQUESTED' });
    hub.broadcastStatusEvent(eventRes.rows[0], { retailerId: req.user.id, riderId: null });

    res.status(201).json({ request, status: 'REQUESTED' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// List requests. Dispatchers see everything; retailers see their own;
// riders see only what's assigned to them (via the state view).
router.get('/', requireAuth, async (req, res) => {
  try {
    let query, params;
    if (req.user.role === 'dispatcher') {
      query = 'SELECT * FROM delivery_request_state ORDER BY created_at DESC';
      params = [];
    } else if (req.user.role === 'retailer') {
      query = 'SELECT * FROM delivery_request_state WHERE retailer_id = $1 ORDER BY created_at DESC';
      params = [req.user.id];
    } else {
      query = 'SELECT * FROM delivery_request_state WHERE rider_id = $1 ORDER BY created_at DESC';
      params = [req.user.id];
    }
    const { rows } = await pool.query(query, params);
    res.json({ requests: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Full history (append-only log) for one request — this is the audit trail.
router.get('/:id/history', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT se.*, u.name AS actor_name, u.role AS actor_role
       FROM status_events se
       JOIN users u ON u.id = se.actor_id
       WHERE se.delivery_request_id = $1
       ORDER BY se.created_at ASC`,
      [req.params.id]
    );
    res.json({ history: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
