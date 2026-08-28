require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');

const authRoutes = require('./routes/auth');
const deliveryRoutes = require('./routes/deliveries');
const assignmentRoutes = require('./routes/assignments');
const statusRoutes = require('./routes/status');
const wsHub = require('./websocket/hub');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/status', statusRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the PWA frontend as static files.
app.use(express.static(path.join(__dirname, '..', '..', 'frontend', 'public')));

const server = http.createServer(app);
wsHub.init(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Reflex backend listening on port ${PORT}`);
});
