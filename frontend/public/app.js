const API = '/api';

const state = {
  user: JSON.parse(localStorage.getItem('reflex_user') || 'null'),
  token: localStorage.getItem('reflex_token') || null,
  authMode: 'login', // 'login' | 'register'
  authError: null,
  requests: [],
  riders: [],
  ws: null,
  online: navigator.onLine,
  expandedTicket: null,
  modal: null, // { type: 'assign'|'scan', requestId }
  pendingEventIds: new Set(), // client_event_ids awaiting server confirmation
};

const app = document.getElementById('app');

// ---------------- API helpers ----------------
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function uuid() {
  return 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

// ---------------- Auth ----------------
async function handleAuthSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.name ? form.name.value : undefined;
  const phone = form.phone.value.trim();
  const password = form.password.value;
  const role = form.role ? form.role.value : undefined;

  state.authError = null;
  try {
    const path = state.authMode === 'login' ? '/auth/login' : '/auth/register';
    const body = state.authMode === 'login' ? { phone, password } : { name, phone, password, role };
    const data = await api(path, { method: 'POST', body });
    state.user = data.user;
    state.token = data.token;
    localStorage.setItem('reflex_user', JSON.stringify(data.user));
    localStorage.setItem('reflex_token', data.token);
    afterLogin();
  } catch (err) {
    state.authError = err.message;
    render();
  }
}

function logout() {
  state.user = null;
  state.token = null;
  localStorage.removeItem('reflex_user');
  localStorage.removeItem('reflex_token');
  if (state.ws) state.ws.close();
  state.ws = null;
  render();
}

function afterLogin() {
  connectWebSocket();
  loadRequests();
  if (state.user.role === 'dispatcher') loadRiders();
  render();
}

// ---------------- WebSocket ----------------
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws?token=${state.token}`);
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.type === 'new_request' || data.type === 'status_event') {
      loadRequests();
    }
  };
  ws.onclose = () => {
    // simple reconnect after 3s if still logged in
    if (state.token) setTimeout(connectWebSocket, 3000);
  };
  state.ws = ws;
}

// ---------------- Data loading ----------------
async function loadRequests() {
  try {
    const data = await api('/deliveries');
    state.requests = data.requests;
    render();
  } catch (err) {
    console.error(err);
  }
}

async function loadRiders() {
  try {
    const data = await api('/assignments/riders');
    state.riders = data.riders;
  } catch (err) {
    console.error(err);
  }
}

async function loadHistory(requestId) {
  const data = await api(`/deliveries/${requestId}/history`);
  return data.history;
}

// ---------------- Retailer: create request ----------------
async function handleCreateRequest(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    customer_name: form.customer_name.value.trim(),
    customer_phone: form.customer_phone.value.trim(),
    address: form.address.value.trim(),
    item_description: form.item_description.value.trim(),
  };
  try {
    await api('/deliveries', { method: 'POST', body });
    form.reset();
    loadRequests();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------- Dispatcher: assign ----------------
function openAssignModal(requestId) {
  state.modal = { type: 'assign', requestId };
  render();
}

async function assignRider(requestId, riderId) {
  try {
    await api('/assignments', { method: 'POST', body: { delivery_request_id: requestId, rider_id: riderId } });
    state.modal = null;
    loadRequests();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------- Rider: status updates (offline-safe) ----------------
async function updateStatus(requestId, status) {
  const clientEventId = uuid();
  const payload = { status, client_event_id: clientEventId };

  if (!navigator.onLine) {
    await ReflexQueue.queueAdd({ clientEventId, requestId, payload, createdAt: Date.now() });
    state.pendingEventIds.add(clientEventId);
    // Optimistic local reflect — real state reconciles once synced.
    render();
    return;
  }

  try {
    await api(`/status/${requestId}`, { method: 'POST', body: payload });
    loadRequests();
  } catch (err) {
    // network blip even though navigator.onLine said true — queue it
    await ReflexQueue.queueAdd({ clientEventId, requestId, payload, createdAt: Date.now() });
    state.pendingEventIds.add(clientEventId);
    render();
  }
}

async function flushQueue() {
  const items = await ReflexQueue.queueAll();
  for (const item of items) {
    try {
      await api(`/status/${item.requestId}`, { method: 'POST', body: item.payload });
      await ReflexQueue.queueRemove(item.clientEventId);
      state.pendingEventIds.delete(item.clientEventId);
    } catch (err) {
      console.warn('Sync failed for', item.clientEventId, err.message);
      // leave it queued; will retry on next flush
    }
  }
  loadRequests();
  render();
}

window.addEventListener('online', () => { state.online = true; flushQueue(); render(); });
window.addEventListener('offline', () => { state.online = false; render(); });

// ---------------- QR scan ----------------
function openScanModal(requestId) {
  state.modal = { type: 'scan', requestId };
  render();
  setTimeout(() => startScanner(requestId), 50);
}

let scannerInstance = null;
function startScanner(requestId) {
  const el = document.getElementById('qr-reader');
  if (!el || typeof Html5Qrcode === 'undefined') return;
  scannerInstance = new Html5Qrcode('qr-reader');
  scannerInstance.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 220 },
    async (decodedText) => {
      await stopScanner();
      try {
        await api(`/status/${requestId}/confirm`, { method: 'POST', body: { qr_payload: decodedText } });
        state.modal = null;
        loadRequests();
      } catch (err) {
        alert(err.message);
        render();
      }
    },
    () => {} // ignore per-frame scan failures
  ).catch(() => {
    // camera unavailable (e.g. no permission, or desktop test env) —
    // fall back to manual confirm entry
    el.innerHTML = '<p style="font-size:13px;color:#8A8A7E;padding:12px;">Camera unavailable. Enter code manually below.</p>';
  });
}

async function stopScanner() {
  if (scannerInstance) {
    try { await scannerInstance.stop(); } catch (e) {}
    scannerInstance = null;
  }
}

async function manualConfirm(requestId) {
  const code = document.getElementById('manual-qr-input').value.trim();
  if (!code) return;
  try {
    await api(`/status/${requestId}/confirm`, { method: 'POST', body: { qr_payload: code } });
    state.modal = null;
    loadRequests();
  } catch (err) {
    alert(err.message);
  }
}

function closeModal() {
  stopScanner();
  state.modal = null;
  render();
}

function toggleTicket(id) {
  state.expandedTicket = state.expandedTicket === id ? null : id;
  render();
  if (state.expandedTicket === id) {
    loadHistory(id).then((history) => {
      const el = document.querySelector(`[data-ledger="${id}"]`);
      if (el) el.innerHTML = renderLedger(history);
    });
  }
}

// ---------------- Rendering ----------------
function statusLabel(s) { return s.replace('_', ' '); }

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function renderLedger(history) {
  return history.map(h => `
    <div class="ledger-row">
      <span class="dot"></span>
      <span class="stamp">${new Date(h.created_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
      <span>${statusLabel(h.status)}</span>
      <span class="who">— ${h.actor_name}</span>
    </div>
  `).join('');
}

function renderTicket(r) {
  const expanded = state.expandedTicket === r.id;
  const role = state.user.role;

  let actions = '';
  if (role === 'dispatcher' && r.current_status === 'REQUESTED') {
    actions = `<div class="ticket-actions"><button class="btn amber" onclick="openAssignModal(${r.id})">Assign rider</button></div>`;
  } else if (role === 'rider' && r.current_status === 'ASSIGNED') {
    actions = `<div class="ticket-actions"><button class="btn amber" onclick="updateStatus(${r.id}, 'PICKED_UP')">Mark picked up</button></div>`;
  } else if (role === 'rider' && r.current_status === 'PICKED_UP') {
    actions = `<div class="ticket-actions">
      <button class="btn amber" onclick="openScanModal(${r.id})">Scan to confirm delivery</button>
    </div>`;
  }

  const borderVar = {
    REQUESTED: 'var(--grey-status)',
    ASSIGNED: 'var(--blue-status)',
    PICKED_UP: 'var(--amber-status)',
    DELIVERED: 'var(--green-status)',
    FAILED: 'var(--red-status)',
    CANCELLED: 'var(--red-status)',
  }[r.current_status] || 'var(--line)';

  return `
    <div class="ticket" style="border-left-color:${borderVar};">
      <div class="ticket-head" onclick="toggleTicket(${r.id})" style="cursor:pointer;">
        <div>
          <div class="ticket-id">Order #${String(r.id).padStart(6, '0')}</div>
        </div>
        <span class="ticket-status status-${r.current_status}">${statusLabel(r.current_status)}</span>
      </div>
      <div class="ticket-body">
        <div class="customer">${r.customer_name}</div>
        <div class="addr">${r.address}</div>
        <div class="item">${r.item_description}</div>
        <div class="ticket-meta">
          <span>${r.customer_phone}</span>
          <span>${timeAgo(r.status_updated_at || r.created_at)}</span>
        </div>
        ${expanded ? `<div class="ledger" data-ledger="${r.id}"><span class="mono" style="font-size:11px;color:#8A8A7E;">Loading ledger…</span></div>` : ''}
      </div>
      ${actions}
    </div>
  `;
}

function renderRequestList(requests, emptyGlyph, emptyText) {
  if (requests.length === 0) {
    return `<div class="empty"><div class="glyph">${emptyGlyph}</div><p>${emptyText}</p></div>`;
  }
  return requests.map(renderTicket).join('');
}

function renderRetailerView() {
  return `
    <form class="card-form" onsubmit="handleCreateRequest(event)">
      <div class="section-title" style="margin-top:0;">Log a delivery</div>
      <div class="field"><label>Customer name</label><input name="customer_name" required></div>
      <div class="field"><label>Customer phone</label><input name="customer_phone" required></div>
      <div class="field"><label>Delivery address</label><input name="address" required></div>
      <div class="field"><label>Item</label><input name="item_description" required></div>
      <button class="btn amber" type="submit">Submit request</button>
    </form>
    <div class="section-title">Your requests <span class="count-badge">${state.requests.length}</span></div>
    ${renderRequestList(state.requests, '📋', 'Requests you log will show up here with live status.')}
  `;
}

function renderDispatcherView() {
  const open = state.requests.filter(r => r.current_status === 'REQUESTED');
  const active = state.requests.filter(r => ['ASSIGNED', 'PICKED_UP'].includes(r.current_status));
  const done = state.requests.filter(r => ['DELIVERED', 'FAILED', 'CANCELLED'].includes(r.current_status));
  return `
    <div class="section-title">Open <span class="count-badge">${open.length}</span></div>
    ${renderRequestList(open, '📥', 'No unassigned requests right now.')}
    <div class="section-title">In progress <span class="count-badge">${active.length}</span></div>
    ${renderRequestList(active, '🚴', 'Nothing out for delivery.')}
    <div class="section-title">Completed <span class="count-badge">${done.length}</span></div>
    ${renderRequestList(done, '✅', 'Completed deliveries appear here.')}
  `;
}

function renderRiderView() {
  const active = state.requests.filter(r => ['ASSIGNED', 'PICKED_UP'].includes(r.current_status));
  const done = state.requests.filter(r => ['DELIVERED', 'FAILED'].includes(r.current_status));
  return `
    <div class="section-title">Your route <span class="count-badge">${active.length}</span></div>
    ${renderRequestList(active, '🛵', 'Nothing assigned to you yet.')}
    <div class="section-title">Completed today <span class="count-badge">${done.length}</span></div>
    ${renderRequestList(done, '📦', 'Delivered items will show here.')}
  `;
}

function renderModal() {
  if (!state.modal) return '';
  if (state.modal.type === 'assign') {
    const options = state.riders.map(r => `
      <div class="rider-option" onclick="assignRider(${state.modal.requestId}, ${r.id})">
        <span>${r.name}</span><span class="mono" style="color:#8A8A7E;">${r.phone}</span>
      </div>
    `).join('') || '<p style="color:#8A8A7E;font-size:13px;">No riders registered yet.</p>';
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal-sheet">
          <h3>Assign to a rider</h3>
          ${options}
          <button class="btn secondary" style="margin-top:8px;" onclick="closeModal()">Cancel</button>
        </div>
      </div>
    `;
  }
  if (state.modal.type === 'scan') {
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal-sheet">
          <h3>Scan delivery QR</h3>
          <div id="qr-reader"></div>
          <div class="field"><label>Or enter code manually</label>
            <input id="manual-qr-input" placeholder="REFLEX-REQ-...">
          </div>
          <button class="btn amber" onclick="manualConfirm(${state.modal.requestId})">Confirm delivery</button>
          <button class="btn secondary" style="margin-top:8px;" onclick="closeModal()">Cancel</button>
        </div>
      </div>
    `;
  }
  return '';
}

function renderAuthScreen() {
  const isLogin = state.authMode === 'login';
  return `
    <div class="auth-screen">
      <div class="auth-header"><span class="wordmark">Reflex</span></div>
      <div class="breadcrumb"><span>Home</span><span class="sep">/</span><span class="current">${isLogin ? 'Sign In' : 'Create Account'}</span></div>
      <div class="auth-card-wrap">
        <div class="auth-card">
          <h2>${isLogin ? 'Sign In' : 'Create an Account'}</h2>
          <p class="auth-tagline">${isLogin
            ? 'Sign in to view your deliveries and track status in real time.'
            : 'Register to log requests, dispatch riders, or manage your delivery route.'}</p>
          ${state.authError ? `<div class="auth-error">${state.authError}</div>` : ''}
          <form onsubmit="handleAuthSubmit(event)">
            ${!isLogin ? `<div class="field"><label>Full name</label><input name="name" required></div>` : ''}
            <div class="field"><label>Phone number</label><input name="phone" required placeholder="0700000000"></div>
            <div class="field"><label>Password</label><input name="password" type="password" required></div>
            ${!isLogin ? `
              <div class="field">
                <label>Account type</label>
                <select name="role" required>
                  <option value="retailer">Retailer</option>
                  <option value="dispatcher">Dispatcher</option>
                  <option value="rider">Rider</option>
                </select>
              </div>
            ` : ''}
            <button class="btn amber" type="submit">${isLogin ? 'Sign In' : 'Create Account'}</button>
          </form>
          <div class="auth-divider">or</div>
          <div class="auth-toggle">
            ${isLogin ? `New to Reflex? <a onclick="switchAuthMode('register')">Create an account</a>`
                       : `Already have an account? <a onclick="switchAuthMode('login')">Sign in</a>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

function switchAuthMode(mode) {
  state.authMode = mode;
  state.authError = null;
  render();
}

function render() {
  if (!state.user) {
    app.innerHTML = renderAuthScreen();
    return;
  }

  const viewByRole = {
    retailer: renderRetailerView,
    dispatcher: renderDispatcherView,
    rider: renderRiderView,
  };
  const crumbByRole = {
    retailer: 'My Deliveries',
    dispatcher: 'Dispatch Board',
    rider: 'My Route',
  };

  app.innerHTML = `
    <div class="topbar">
      <div class="brand wordmark"><span class="stub"></span>Reflex</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="role-pill">${state.user.role}</span>
        <button class="logout" onclick="logout()">Sign out</button>
      </div>
    </div>
    <div class="breadcrumb"><span>Home</span><span class="sep">/</span><span class="current">${crumbByRole[state.user.role]}</span></div>
    ${!state.online ? `<div class="conn-status offline">Offline — updates will sync when reconnected${state.pendingEventIds.size ? ` (${state.pendingEventIds.size} queued)` : ''}</div>` : ''}
    <main>${viewByRole[state.user.role]()}</main>
    ${renderModal()}
  `;
}

// ---------------- Init ----------------
if (state.user && state.token) {
  afterLogin();
} else {
  render();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}
