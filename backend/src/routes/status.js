const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const hub = require('../websocket/hub');

const router = express.Router();

const VALID_TRANSITIONS = {
  ASSIGNED: ['PICKED_UP', 'FAILED'],
  PICKED_UP: ['DELIVERED', 'FAILED'],
};

// Rider posts a status update. Includes client_event_id so that if the
// PWA queued this offline and retries it after reconnecting, the server
// dedupes instead of writing the same transition twice (edge case:
// duplicate submission from an unreliable connection).
router.post('/:requestId', requireAuth, requireRole('rider'), async (req, res) => {
  const { requestId } = req.params;
  const { status, client_event_id, metadata } = req.body;

  if (!['PICKED_UP', 'DELIVERED', 'FAILED'].includes(status)) {
    return res.status(400).json({ error: 'status must be PICKED_UP, DELIVERED, or FAILED' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (client_event_id) {
      const existing = await client.query(
        'SELECT * FROM status_events WHERE client_event_id = $1',
        [client_event_id]
      );
      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return res.status(200).json({ status: existing.rows[0].status, deduped: true });
      }
    }

    // Lock the base table (see assignments.js note re: views + FOR UPDATE),
    // then read the derived current status separately.
    const lockRes = await client.query(
      'SELECT * FROM delivery_requests WHERE id = $1 FOR UPDATE',
      [requestId]
    );
    if (lockRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Delivery request not found' });
    }
    const stateRes = await client.query(
      'SELECT * FROM delivery_request_state WHERE id = $1',
      [requestId]
    );
    const current = stateRes.rows[0];

    if (current.rider_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This request is not assigned to you' });
    }

    const allowed = VALID_TRANSITIONS[current.current_status] || [];
    if (!allowed.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Cannot move from ${current.current_status} to ${status}`,
        current_status: current.current_status,
      });
    }

    const { rows: eventRows } = await client.query(
      `INSERT INTO status_events (delivery_request_id, status, actor_id, metadata, client_event_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [requestId, status, req.user.id, metadata || {}, client_event_id || null]
    );

    await client.query('COMMIT');

    hub.broadcastStatusEvent(eventRows[0], { retailerId: current.retailer_id, riderId: current.rider_id });

    res.status(201).json({ event: eventRows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// QR scan confirmation at delivery. Trade-off logged: this confirms a
// scan happened, not independently that the right parcel reached the
// right person — no photo/signature evidence layer yet.
router.post('/:requestId/confirm', requireAuth, requireRole('rider'), async (req, res) => {
  const { requestId } = req.params;
  const { qr_payload } = req.body;
  if (!qr_payload) return res.status(400).json({ error: 'qr_payload is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO delivery_confirmations (delivery_request_id, qr_payload, scanned_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [requestId, qr_payload, req.user.id]
    );
    res.status(201).json({ confirmation: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
