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
  try { const result = await client.query(`INSERT INTO delivery_requests (retailer_id, customer_name, customer_phone, address, item_description, delivery_code) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.user.id, customer_name, customer_phone, address, item_description, generateDeliveryCode()]); const request = result.rows[0]; const eventRes = await client.query(`INSERT INTO status_events (delivery_request_id,status,actor_id,metadata) VALUES ($1,'REQUESTED',$2,$3) RETURNING *`, [request.id, req.user.id, JSON.stringify(metadata || {})]); await client.query('COMMIT'); hub.broadcastNewRequest({ ...request, current_status: 'REQUESTED' }); hub.broadcastStatusEvent(eventRes.rows[0], { retailerId: req.user.id, riderId: null }); res.status(201).json({ request, status: 'REQUESTED', delivery_code: request.delivery_code }); }
  catch (err) { try { await client.query('ROLLBACK'); } catch {} console.error(err); res.status(500).json({ error: 'Internal error' }); }
  finally { client.release(); }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const base = `SELECT s.id, s.retailer_id, s.customer_name, s.customer_phone, s.address, s.item_description, s.created_at, s.current_status, s.status_updated_at, s.rider_id, rider.name AS rider_name, rider.phone AS rider_phone${req.user.role === 'rider' ? '' : ', s.delivery_code'} FROM delivery_request_state s LEFT JOIN users rider ON rider.id=s.rider_id`;
    let query, params;
    if (req.user.role === 'dispatcher') { query = `${base} ORDER BY s.created_at DESC`; params = []; }
    else if (req.user.role === 'retailer') { query = `${base} WHERE s.retailer_id=$1 ORDER BY s.created_at DESC`; params = [req.user.id]; }
    else { query = `${base} WHERE s.rider_id=$1 ORDER BY s.created_at DESC`; params = [req.user.id]; }
    const { rows } = await pool.query(query, params); res.json({ requests: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal error' }); }
});

router.get('/riders', requireAuth, requireRole('retailer'), async (req, res) => { const { rows } = await pool.query("SELECT id,name,phone FROM users WHERE role='rider' ORDER BY name"); res.json({ riders: rows }); });

router.get('/:id/history', requireAuth, async (req, res) => {
  try {
    const delivery = await pool.query(`SELECT dr.id, dr.retailer_id, EXISTS(SELECT 1 FROM assignments a WHERE a.delivery_request_id=dr.id AND a.rider_id=$2) AS was_assigned FROM delivery_requests dr WHERE dr.id=$1`, [req.params.id, req.user.id]);
    if (!delivery.rows.length) return res.status(404).json({ error: 'Delivery request not found' });
    const d = delivery.rows[0];
    const allowed = req.user.role === 'dispatcher' || (req.user.role === 'retailer' && Number(d.retailer_id) === Number(req.user.id)) || (req.user.role === 'rider' && d.was_assigned);
    if (!allowed) return res.status(403).json({ error: 'You do not have access to this delivery history' });
    const { rows } = await pool.query(`SELECT se.*,u.name AS actor_name,u.role AS actor_role FROM status_events se JOIN users u ON u.id=se.actor_id WHERE se.delivery_request_id=$1 ORDER BY se.created_at ASC`, [req.params.id]);
    res.json({ history: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal error' }); }
});
module.exports = router;
