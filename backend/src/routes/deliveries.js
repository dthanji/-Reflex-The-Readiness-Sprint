const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const hub = require('../websocket/hub');
const { validateMetadata } = require('../validation');

const router = express.Router();
function generateDeliveryCode() { return `RFX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }

router.post('/', requireAuth, requireRole('retailer'), async (req, res) => {
  const { customer_name, customer_phone, address, item_description, metadata } = req.body;
  if (!customer_name || !customer_phone || !address || !item_description) return res.status(400).json({ error: 'customer_name, customer_phone, address, item_description are required' });
  try { validateMetadata(metadata); } catch (err) { return res.status(400).json({ error: err.message }); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); let request;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { const result = await client.query(`INSERT INTO delivery_requests (retailer_id, customer_name, customer_phone, address, item_description, delivery_code) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.user.id, customer_name, customer_phone, address, item_description, generateDeliveryCode()]); request = result.rows[0]; break; }
      catch (err) { if (err.code !== '23505' || !String(err.constraint || '').includes('delivery')) throw err; }
    }
    if (!request) throw new Error('Unable to generate a unique delivery code');
    const eventRes = await client.query(`INSERT INTO status_events (delivery_request_id,status,actor_id,metadata) VALUES ($1,'REQUESTED',$2,$3) RETURNING *`, [request.id, req.user.id, JSON.stringify(metadata || {})]);
    await client.query('COMMIT');
    hub.broadcastNewRequest({ ...request, current_status: 'REQUESTED' });
    hub.broadcastStatusEvent(eventRes.rows[0], { retailerId: req.user.id, riderId: null });
    res.status(201).json({ request, status: 'REQUESTED', delivery_code: request.delivery_code });
  } catch (err) { try { await client.query('ROLLBACK'); } catch {} console.error(err); res.status(500).json({ error: 'Internal error' }); }
  finally { client.release(); }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const base = `SELECT s.*, rider.name AS rider_name, rider.phone AS rider_phone FROM delivery_request_state s LEFT JOIN users rider ON rider.id=s.rider_id`;
    let query, params;
    if (req.user.role === 'dispatcher') { query = `${base} ORDER BY s.created_at DESC`; params = []; }
    else if (req.user.role === 'retailer') { query = `${base} WHERE s.retailer_id=$1 ORDER BY s.created_at DESC`; params = [req.user.id]; }
    else { query = `${base} WHERE s.rider_id=$1 ORDER BY s.created_at DESC`; params = [req.user.id]; }
    const { rows } = await pool.query(query, params); res.json({ requests: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal error' }); }
});

router.put('/:id/reassign', requireAuth, requireRole('retailer'), async (req, res) => {
  const { rider_id, metadata } = req.body; const requestId = req.params.id;
  if (!rider_id) return res.status(400).json({ error: 'rider_id is required' });
  try { validateMetadata(metadata); } catch (err) { return res.status(400).json({ error: err.message }); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT * FROM delivery_requests WHERE id=$1 FOR UPDATE', [requestId]);
    if (!lock.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Delivery request not found' }); }
    if (lock.rows[0].retailer_id !== req.user.id) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your delivery request' }); }
    const current = (await client.query('SELECT * FROM delivery_request_state WHERE id=$1', [requestId])).rows[0];
    if (current.current_status !== 'FAILED') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'A rider can only be reassigned when the current status is FAILED', current_status: current.current_status }); }
    const rider = await client.query("SELECT id,name,phone FROM users WHERE id=$1 AND role='rider'", [rider_id]);
    if (!rider.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'rider_id does not refer to a valid rider' }); }
    const assignment = await client.query(`INSERT INTO assignments (delivery_request_id,rider_id,assigned_by) VALUES ($1,$2,$3) RETURNING *`, [requestId, rider_id, req.user.id]);
    const event = await client.query(`INSERT INTO status_events (delivery_request_id,status,actor_id,metadata) VALUES ($1,'ASSIGNED',$2,$3) RETURNING *`, [requestId, req.user.id, JSON.stringify({ ...(metadata || {}), rider_id, reassigned: true, reason: 'Previous rider reported a delivery issue' })]);
    await client.query('COMMIT');
    hub.broadcastStatusEvent(event.rows[0], { retailerId: req.user.id, riderId: rider_id });
    res.status(201).json({ assignment: assignment.rows[0], status: 'ASSIGNED', rider: rider.rows[0] });
  } catch (err) { try { await client.query('ROLLBACK'); } catch {} console.error(err); res.status(500).json({ error: 'Internal error' }); }
  finally { client.release(); }
});

router.get('/riders', requireAuth, requireRole('retailer'), async (req, res) => { const { rows } = await pool.query("SELECT id,name,phone FROM users WHERE role='rider' ORDER BY name"); res.json({ riders: rows }); });
router.get('/:id/history', requireAuth, async (req, res) => { try { const { rows } = await pool.query(`SELECT se.*,u.name AS actor_name,u.role AS actor_role FROM status_events se JOIN users u ON u.id=se.actor_id WHERE se.delivery_request_id=$1 ORDER BY se.created_at ASC`, [req.params.id]); res.json({ history: rows }); } catch (err) { console.error(err); res.status(500).json({ error: 'Internal error' }); } });
module.exports = router;
