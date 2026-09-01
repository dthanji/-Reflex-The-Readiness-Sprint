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

// TEMPORARY DIAGNOSTIC — remove once DATABASE_URL connectivity is confirmed
// working in production. Prints only presence/shape of required env vars,
// never any actual substring of a secret value, so this is safe to leave
// in logs temporarily but shouldn't stay in the codebase long-term.
const dbUrl = process.env.DATABASE_URL || '';
console.log('[reflex][diagnostic] DATABASE_URL present:', !!dbUrl,
  'length:', dbUrl.length,
  'looks like a postgres URL:', dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'));
console.log('[reflex][diagnostic] NODE_ENV:', JSON.stringify(process.env.NODE_ENV));
console.log('[reflex][diagnostic] JWT_SECRET present:', !!process.env.JWT_SECRET,
  'length:', (process.env.JWT_SECRET || '').length);
console.log('[reflex][diagnostic] PORT:', process.env.PORT);

const app = express();

// Render runs the application behind a reverse proxy and forwards the
// original client IP in X-Forwarded-For. Trust the single proxy hop so
// Express and express-rate-limit can safely identify the real client IP.
app.set('trust proxy', 1);

// CORS: restricted to an explicit allowlist via ALLOWED_ORIGINS (comma-
// separated), not wide open. Two cases are always allowed regardless of
// that allowlist:
//   1. Requests with no Origin header (curl, mobile PWA shell) — not a
//      cross-origin browser risk.
//   2. Same-origin requests — the browser includes an Origin header on
//      state-changing requests (POST/PUT/DELETE) even when the request
//      targets the same host the page was loaded from, not just on truly
//      cross-origin calls. Since this backend also serves the PWA frontend
//      itself, that's the normal case, not an edge case — comparing the
//      Origin header's host against the request's own Host header handles
//      it correctly without requiring ALLOWED_ORIGINS to be set at all.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors((req, callback) => {
  const origin = req.header('Origin');
  let isSameOrigin = false;
  if (origin) {
    try {
      isSameOrigin = new URL(origin).host === req.get('host');
    } catch (e) {
      isSameOrigin = false;
    }
  }
  if (!origin || isSameOrigin || allowedOrigins.includes(origin)) {
    callback(null, { origin: true });
  } else {
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  }
}));

// Turn a CORS rejection into a clean 403 instead of leaking a stack trace as a 500.
app.use((err, req, res, next) => {
  if (err && err.message && err.message.startsWith('Origin ') && err.message.endsWith('not allowed by CORS')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next(err);
});

app.use(express.json());

// Rate limit auth endpoints specifically — these are the brute-force targets.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                  // 20 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again later.' },
});
app.use('/api/auth', authLimiter);

// Lighter general limiter across the rest of the API.
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/status', statusRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the PWA frontend as static files.
app.use(express.static(path.join(__dirname, '..', '..', 'frontend', 'public')));

// Final catch-all: never leak a raw stack trace to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);
wsHub.init(server);

const PORT = process.env.PORT || 3000;

// Initialize a fresh Render PostgreSQL database before accepting requests.
// server.js uses the schema file that lives in backend/schema.sql.
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

if (require.main === module) {
  initializeDatabase()
    .then(() => {
      server.listen(PORT, () => {
        console.log(`Reflex backend listening on port ${PORT}`);
      });
    })
    .catch(async (error) => {
      console.error('[reflex] Database initialization failed:', error);
      await pool.end();
      process.exit(1);
    });
}

module.exports = { app, server };
