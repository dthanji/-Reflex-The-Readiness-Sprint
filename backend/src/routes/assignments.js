const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const hub = require('../websocket/hub');

const router = express.Router();

// Dispatcher assigns an open request to a rider.
router.post('/', requireAuth, requireRole('dispatcher'), async (req, res) => {
  const { delivery_request_id, rider_id } = req.body;
  if (!delivery_request_id || !rider_id) {
    return res.status(400).json({ error: 'delivery_request_id and rider_id are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the base request row (not the view — Postgres can't apply
    // FOR UPDATE through the view's outer join) to prevent two dispatchers
    // assigning it at the same time (edge case: concurrent assignment race).
    const lockCheck = await client.query(
      'SELECT * FROM delivery_requests WHERE id = $1 FOR UPDATE',
      [delivery_request_id]
    );
    if (lockCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Delivery request not found' });
    }
    const stateCheck = await client.query(
      'SELECT * FROM delivery_request_state WHERE id = $1',
      [delivery_request_id]
    );
    const current = stateCheck.rows[0];
    if (['DELIVERED', 'CANCELLED'].includes(current.current_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot assign a ${current.current_status} request` });
    }

    const riderCheck = await client.query('SELECT * FROM users WHERE id = $1 AND role = $2', [rider_id, 'rider']);
    if (riderCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'rider_id does not refer to a valid rider' });
    }

    const { rows: assignRows } = await client.query(
      `INSERT INTO assignments (delivery_request_id, rider_id, assigned_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [delivery_request_id, rider_id, req.user.id]
    );

    const { rows: eventRows } = await client.query(
      `INSERT INTO status_events (delivery_request_id, status, actor_id, metadata)
       VALUES ($1, 'ASSIGNED', $2, $3) RETURNING *`,
      [delivery_request_id, req.user.id, JSON.stringify({ rider_id })]
    );

    await client.query('COMMIT');

    hub.broadcastStatusEvent(eventRows[0], { retailerId: current.retailer_id, riderId: rider_id });

    res.status(201).json({ assignment: assignRows[0], status: 'ASSIGNED' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// List available riders (for the dispatcher's assignment UI).
router.get('/riders', requireAuth, requireRole('dispatcher'), async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, phone FROM users WHERE role = 'rider' ORDER BY name");
  res.json({ riders: rows });
});

module.exports = router;
