const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const hub = require('../websocket/hub');
const { validateMetadata } = require('../validation');

const router = express.Router();

async function assign(req, res, reassigned = false) {
  const requestId = reassigned ? req.params.id : req.body.delivery_request_id;
  const { rider_id } = req.body;
  if (!requestId || !rider_id) return res.status(400).json({ error: reassigned ? 'rider_id is required' : 'delivery_request_id and rider_id are required' });
  try { validateMetadata(req.body.metadata); } catch (err) { return res.status(400).json({ error: err.message }); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT * FROM delivery_requests WHERE id = $1 FOR UPDATE', [requestId]);
    if (!lock.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Delivery request not found' }); }
    const current = (await client.query('SELECT * FROM delivery_request_state WHERE id = $1', [requestId])).rows[0];
    if (reassigned) {
      if (current.current_status !== 'FAILED') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'A rider can only be reassigned when the current status is FAILED', current_status: current.current_status }); }
      if (Number(current.rider_id) === Number(rider_id)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Select a different rider for reassignment' }); }
    } else if (['DELIVERED', 'CANCELLED'].includes(current.current_status)) {
      await client.query('ROLLBACK'); return res.status(409).json({ error: `Cannot assign a ${current.current_status} request` });
    }
    const rider = await client.query("SELECT id, name, phone FROM users WHERE id = $1 AND role = 'rider'", [rider_id]);
    if (!rider.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'rider_id does not refer to a valid rider' }); }
    const previousRiderId = current.rider_id || null;
    const assignment = await client.query(`INSERT INTO assignments (delivery_request_id, rider_id, assigned_by) VALUES ($1, $2, $3) RETURNING *`, [requestId, rider_id, req.user.id]);
    const metadata = { ...(req.body.metadata || {}), rider_id, ...(reassigned ? { reassigned: true, previous_rider_id: previousRiderId, reason: 'Previous rider reported a delivery issue' } : {}) };
    const event = await client.query(`INSERT INTO status_events (delivery_request_id, status, actor_id, metadata) VALUES ($1, 'ASSIGNED', $2, $3) RETURNING *`, [requestId, req.user.id, JSON.stringify(metadata)]);
    await client.query('COMMIT');
    hub.broadcastStatusEvent(event.rows[0], { retailerId: current.retailer_id, riderId: rider_id });
    hub.broadcastAssignmentNotification({ delivery_request_id: Number(requestId), rider: rider.rows[0], reassigned, previous_rider_id: previousRiderId });
    res.status(201).json({ assignment: assignment.rows[0], status: 'ASSIGNED', rider: rider.rows[0], previous_rider_id: previousRiderId });
  } catch (err) { try { await client.query('ROLLBACK'); } catch {} console.error(err); res.status(500).json({ error: 'Internal error' }); }
  finally { client.release(); }
}

router.post('/', requireAuth, requireRole('dispatcher'), (req, res) => assign(req, res, false));
router.put('/:id/reassign', requireAuth, requireRole('dispatcher'), (req, res) => assign(req, res, true));
router.get('/riders', requireAuth, requireRole('dispatcher'), async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, phone FROM users WHERE role = 'rider' ORDER BY name");
  res.json({ riders: rows });
});
module.exports = router;
