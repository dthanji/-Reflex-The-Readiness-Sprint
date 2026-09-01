const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../auth');

// Single-process broadcast hub. A multi-instance deployment would need Redis
// pub/sub or a similar shared event bus.
let wss = null;
const clients = new Map();

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    let user;
    try { user = jwt.verify(token, JWT_SECRET); }
    catch (err) { ws.close(4001, 'Invalid token'); return; }
    const clientId = `${user.id}-${Date.now()}`;
    clients.set(clientId, { ws, userId: user.id, role: user.role });
    ws.on('close', () => clients.delete(clientId));
    ws.on('error', () => clients.delete(clientId));
    ws.send(JSON.stringify({ type: 'connected', userId: user.id, role: user.role }));
  });
  return wss;
}

function broadcastStatusEvent(event, { retailerId, riderId }) {
  const payload = JSON.stringify({ type: 'status_event', event });
  for (const { ws, userId, role } of clients.values()) {
    const shouldReceive = role === 'dispatcher' ||
      (role === 'retailer' && userId === retailerId) ||
      (role === 'rider' && userId === riderId);
    if (shouldReceive && ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function broadcastNewRequest(request) {
  const payload = JSON.stringify({ type: 'new_request', request });
  for (const { ws, role } of clients.values()) {
    if (role === 'dispatcher' && ws.readyState === ws.OPEN) ws.send(payload);
  }
}

// Immediate dispatcher notification when a rider is assigned or reassigned.
function broadcastAssignmentNotification({ delivery_request_id, rider, reassigned = false }) {
  const payload = JSON.stringify({ type: 'assignment_notification', delivery_request_id, rider, reassigned });
  for (const { ws, role } of clients.values()) {
    if (role === 'dispatcher' && ws.readyState === ws.OPEN) ws.send(payload);
  }
}

module.exports = { init, broadcastStatusEvent, broadcastNewRequest, broadcastAssignmentNotification };
