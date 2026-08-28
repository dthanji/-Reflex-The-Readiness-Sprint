const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../auth');

// Design note (trade-off #1 in the log): this is a single in-process
// broadcast hub. It works because we run one Express instance. If Reflex
// scaled to multiple instances, this would need to move to Redis pub/sub
// (or similar) so events broadcast across processes, not just within one.

let wss = null;
// clientId -> { ws, userId, role }
const clients = new Map();

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    let user;
    try {
      user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      ws.close(4001, 'Invalid token');
      return;
    }

    const clientId = `${user.id}-${Date.now()}`;
    clients.set(clientId, { ws, userId: user.id, role: user.role });

    ws.on('close', () => clients.delete(clientId));
    ws.on('error', () => clients.delete(clientId));

    ws.send(JSON.stringify({ type: 'connected', userId: user.id, role: user.role }));
  });

  return wss;
}

// Broadcast a status event to everyone with a stake in it:
// - dispatchers (see everything)
// - the retailer who created the request
// - the rider currently assigned
function broadcastStatusEvent(event, { retailerId, riderId }) {
  const payload = JSON.stringify({ type: 'status_event', event });
  for (const { ws, userId, role } of clients.values()) {
    const shouldReceive =
      role === 'dispatcher' ||
      (role === 'retailer' && userId === retailerId) ||
      (role === 'rider' && userId === riderId);
    if (shouldReceive && ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

function broadcastNewRequest(request) {
  const payload = JSON.stringify({ type: 'new_request', request });
  for (const { ws, role } of clients.values()) {
    if (role === 'dispatcher' && ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

module.exports = { init, broadcastStatusEvent, broadcastNewRequest };
