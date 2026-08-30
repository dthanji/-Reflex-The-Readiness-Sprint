require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const deliveryRoutes = require('./routes/deliveries');
const assignmentRoutes = require('./routes/assignments');
const statusRoutes = require('./routes/status');
const wsHub = require('./websocket/hub');

const app = express();

// CORS: restricted to an explicit allowlist via ALLOWED_ORIGINS (comma-
// separated), not wide open. Requests with no Origin header (curl, mobile
// PWA shell, same-origin) are allowed through since they aren't a
// cross-origin browser risk. If ALLOWED_ORIGINS isn't set, no cross-origin
// browser requests are permitted — safer default than allowing everything.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
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

// Only auto-start the server when run directly (`node src/server.js` / `npm start`).
// When required by a test file, the caller controls if/when it listens.
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Reflex backend listening on port ${PORT}`);
  });
}

module.exports = { app, server };
