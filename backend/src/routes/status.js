const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const hub = require('../websocket/hub');

const router = express.Router();

const VALID_TRANSITIONS = {
  ASSIGNED: ['PICKED_UP', 'FAILED'],
  PICKED_UP: ['DELIVERED', 'FAILED'],
};

router.post('/:requestId', requireAuth, requireRole('rider'), async (req, res) => {
  const { requestId } = req.params;
  const { status, client_event_id, metadata } = req.body;

  if (!['PICKED_UP', 'DELIVERED', 'FAILED'].includes(status)) return res.status(400).json({ error: 'status must be PICKED_UP, DELIVERED, or FAILED' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (client_event_id) {
      const existing = await client.query('SELECT * FROM status_events WHERE client_event_id = $1', [client_event_id]);
      if (existing.rows.length > 0) { await client.query('COMMIT'); return res.status(200).json({ status: existing.rows[0].status, deduped: true }); }
    }
    const lockRes = await client.query('SELECT * FROM delivery_requests WHERE id = $1 FOR UPDATE', [requestId]);
    if (lockRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Delivery request not found' }); }
    const stateRes = await client.query('SELECT * FROM delivery_request_state WHERE id = $1', [requestId]);
    const current = stateRes.rows[0];
    if (current.rider_id !== req.user.id) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'This request is not assigned to you' }); }
    const allowed = VALID_TRANSITIONS[current.current_status] || [];
    if (!allowed.includes(status)) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Cannot move from ${current.current_status} to ${status}`, current_status: current.current_status }); }
    const { rows: eventRows } = await client.query(
      `INSERT INTO status_events (delivery_request_id, status, actor_id, metadata, client_event_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [requestId, status, req.user.id, metadata || {}, client_event_id || null]
    );
    await client.query('COMMIT');
    hub.broadcastStatusEvent(eventRows[0], { retailerId: current.retailer_id, riderId: current.rider_id });
    res.status(201).json({ event: eventRows[0] });
  } catch (err) {
    await client.query('ROLLBACK'); console.error(err); res.status(500).json({ error: 'Internal error' });
  } finally { client.release(); }
});

// QR/manual delivery confirmation. The server-generated delivery code is
// globally unique and is valid only for the delivery whose code was entered.
// A successful confirmation atomically records the proof and appends DELIVERED.
router.post('/:requestId/confirm', requireAuth, requireRole('rider'), async (req, res) => {
  const { requestId } = req.params;
  const rawCode = req.body.qr_payload;
  const qrPayload = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  if (!qrPayload) return res.status(400).json({ error: 'Delivery code is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockRes = await client.query('SELECT * FROM delivery_requests WHERE id = $1 FOR UPDATE', [requestId]);
    if (lockRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Delivery request not found' }); }
    const stateRes = await client.query('SELECT * FROM delivery_request_state WHERE id = $1', [requestId]);
    const current = stateRes.rows[0];

    if (current.rider_id !== req.user.id) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'This request is not assigned to you' }); }
    if (current.current_status !== 'PICKED_UP') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Delivery confirmation requires PICKED_UP status; current status is ${current.current_status}`, current_status: current.current_status });
    }

    // The code must exist and belong to this exact delivery. A code from
    // another order is never accepted, even if it is a real Reflex code.
    const codeCheck = await client.query(
      'SELECT id FROM delivery_requests WHERE delivery_code = $1',
      [qrPayload]
    );
    if (!codeCheck.rows.length || Number(codeCheck.rows[0].id) !== Number(requestId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid delivery code. The code does not match this delivery.' });
    }

    // Prevent a delivery code from being reused as a second confirmation.
    const priorUse = await client.query(
      'SELECT id FROM delivery_confirmations WHERE qr_payload = $1 LIMIT 1',
      [qrPayload]
    );
    if (priorUse.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid delivery code. This code has already been used.' });
    }

    const confirmationRes = await client.query(
      `INSERT INTO delivery_confirmations (delivery_request_id, qr_payload, scanned_by) VALUES ($1, $2, $3) RETURNING *`,
      [requestId, qrPayload, req.user.id]
    );
    const eventRes = await client.query(
      `INSERT INTO status_events (delivery_request_id, status, actor_id, metadata) VALUES ($1, 'DELIVERED', $2, $3) RETURNING *`,
      [requestId, req.user.id, JSON.stringify({ confirmation_id: confirmationRes.rows[0].id, qr_confirmed: true })]
    );
    await client.query('COMMIT');
    hub.broadcastStatusEvent(eventRes.rows[0], { retailerId: current.retailer_id, riderId: current.rider_id });
    res.status(201).json({ confirmation: confirmationRes.rows[0], event: eventRes.rows[0], status: 'DELIVERED' });
  } catch (err) {
    await client.query('ROLLBACK'); console.error(err); res.status(500).json({ error: 'Internal error' });
  } finally { client.release(); }
});

module.exports = router;
