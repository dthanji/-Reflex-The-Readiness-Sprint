require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const { pool } = require('./db');
const authRoutes = require('./routes/auth');
const deliveryRoutes = require('./routes/deliveries');
const assignmentRoutes = require('./routes/assignments');
const statusRoutes = require('./routes/status');
const wsHub = require('./websocket/hub');

const dbUrl = process.env.DATABASE_URL || '';
console.log('[reflex][diagnostic] DATABASE_URL present:', !!dbUrl,
  'length:', dbUrl.length,
  'looks like a postgres URL:', dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'));
console.log('[reflex][diagnostic] NODE_ENV:', JSON.stringify(process.env.NODE_ENV));
console.log('[reflex][diagnostic] JWT_SECRET present:', !!process.env.JWT_SECRET,
  'length:', (process.env.JWT_SECRET || '').length);
console.log('[reflex][diagnostic] PORT:', process.env.PORT);

const app = express();

app.set('trust proxy', 1);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors((req, callback) => {
  const origin = req.header('Origin');
  let isSameOrigin = false;
  if (origin) {
    try { isSameOrigin = new URL(origin).host === req.get('host'); } catch (e) { isSameOrigin = false; }
  }
  if (!origin || isSameOrigin || allowedOrigins.includes(origin)) callback(null, { origin: true });
  else callback(new Error(`Origin ${origin} not allowed by CORS`));
}));

app.use((err, req, res, next) => {
  if (err && err.message && err.message.startsWith('Origin ') && err.message.endsWith('not allowed by CORS')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next(err);
});

app.use(express.json());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many auth attempts. Try again later.' } });
app.use('/api/auth', authLimiter);
const apiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Slow down.' } });
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/status', statusRoutes);
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', '..', 'frontend', 'public')));
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: 'Internal server error' }); });

const server = http.createServer(app);
wsHub.init(server);
const PORT = process.env.PORT || 3000;

async function initializeDatabase() {
  const result = await pool.query("SELECT to_regclass('public.users') AS table_name");
  if (result.rows[0].table_name) {
    console.log('[reflex] Database schema already initialized.');
    return;
  }
  console.log('[reflex] Database schema not found; initializing...');
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('[reflex] Database schema initialized.');
}

// Apply additive upgrades to databases that were created by an earlier MVP build.
async function ensureSchemaUpgrades() {
  await pool.query("ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'STUCK_IN_TRANSIT'");
  await pool.query('ALTER TABLE delivery_requests ADD COLUMN IF NOT EXISTS delivery_code TEXT');
  await pool.query(`
    UPDATE delivery_requests
    SET delivery_code = 'RFX-' || upper(substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 8))
    WHERE delivery_code IS NULL
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_requests_delivery_code ON delivery_requests (delivery_code)');
  await pool.query('ALTER TABLE delivery_requests ALTER COLUMN delivery_code SET NOT NULL');
  console.log('[reflex] Delivery-code migration verified.');
}

async function markStuckInTransit() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT latest.delivery_request_id, latest.actor_id AS rider_id, dr.retailer_id
       FROM (
         SELECT DISTINCT ON (se.delivery_request_id) se.delivery_request_id, se.status, se.actor_id, se.created_at
         FROM status_events se ORDER BY se.delivery_request_id, se.created_at DESC
       ) latest
       JOIN delivery_requests dr ON dr.id = latest.delivery_request_id
       WHERE latest.status = 'PICKED_UP' AND latest.created_at <= now() - interval '24 hours'`
    );
    for (const delivery of rows) {
      const eventRes = await client.query(
        `INSERT INTO status_events (delivery_request_id, status, actor_id, metadata)
         SELECT $1, 'STUCK_IN_TRANSIT', $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM status_events WHERE delivery_request_id = $1 AND status = 'STUCK_IN_TRANSIT' AND created_at > now() - interval '25 hours'
         ) RETURNING *`,
        [delivery.delivery_request_id, delivery.rider_id, JSON.stringify({ automatic: true, reason: 'No delivery confirmation within 24 hours of pickup', threshold_hours: 24 })]
      );
      if (eventRes.rows.length > 0) {
        console.log(`[reflex] Order ${delivery.delivery_request_id} marked STUCK_IN_TRANSIT after 24 hours without confirmation.`);
        wsHub.broadcastStatusEvent(eventRes.rows[0], { retailerId: delivery.retailer_id, riderId: delivery.rider_id });
      }
    }
  } catch (err) {
    console.error('[reflex] Stuck-in-transit monitor failed:', err);
  } finally { client.release(); }
}

if (require.main === module) {
  initializeDatabase()
    .then(ensureSchemaUpgrades)
    .then(() => {
      server.listen(PORT, () => {
        console.log(`Reflex backend listening on port ${PORT}`);
        markStuckInTransit();
        setInterval(markStuckInTransit, 15 * 60 * 1000);
      });
    })
    .catch(async (error) => {
      console.error('[reflex] Database initialization failed:', error);
      await pool.end();
      process.exit(1);
    });
}

module.exports = { app, server };
