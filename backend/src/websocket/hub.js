const { WebSocketServer } = require('ws');
const { verifyToken } = require('../auth');

let wss = null;
const clients = new Map();
const AUTH_TIMEOUT_MS = 5000;

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    let clientId = null;
    let authenticated = false;
    const authTimeout = setTimeout(() => { if (!authenticated) ws.close(4001, 'Authentication required'); }, AUTH_TIMEOUT_MS);

    ws.on('message', (raw) => {
      if (authenticated) return;
      let message;
      try { message = JSON.parse(raw.toString()); } catch { ws.close(4001, 'Invalid authentication payload'); return; }
      if (message.type !== 'authenticate' || typeof message.token !== 'string') { ws.close(4001, 'Authentication required'); return; }
      let user;
      try { user = verifyToken(message.token); } catch { ws.close(4001, 'Invalid token'); return; }
      authenticated = true;
      clearTimeout(authTimeout);
      clientId = `${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      clients.set(clientId, { ws, userId: user.id, role: user.role });
      ws.send(JSON.stringify({ type: 'connected', userId: user.id, role: user.role }));
    });
    const cleanup = () => { clearTimeout(authTimeout); if (clientId) clients.delete(clientId); };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });
  return wss;
}

function broadcastStatusEvent(event, { retailerId, riderId }) {
  const payload = JSON.stringify({ type: 'status_event', event });
  for (const { ws, userId, role } of clients.values()) {
    const shouldReceive = role === 'dispatcher' || (role === 'retailer' && userId === retailerId) || (role === 'rider' && userId === riderId);
    if (shouldReceive && ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function broadcastNewRequest(request) {
  const payload = JSON.stringify({ type: 'new_request', request });
  for (const { ws, role } of clients.values()) if (role === 'dispatcher' && ws.readyState === ws.OPEN) ws.send(payload);
}

function broadcastAssignmentNotification({ delivery_request_id, rider, reassigned = false }) {
  const payload = JSON.stringify({ type: 'assignment_notification', delivery_request_id, rider, reassigned });
  for (const { ws, role } of clients.values()) if (role === 'dispatcher' && ws.readyState === ws.OPEN) ws.send(payload);
}

module.exports = { init, broadcastStatusEvent, broadcastNewRequest, broadcastAssignmentNotification };
