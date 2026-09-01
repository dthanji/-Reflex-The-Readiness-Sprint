const API = '/api';
let renderQueued = false;
const rawState = {
  user: JSON.parse(localStorage.getItem('reflex_user') || 'null'), token: localStorage.getItem('reflex_token') || null,
  authMode: 'login', authError: null, requests: [], riders: [], ws: null, online: navigator.onLine,
  expandedTicket: null, modal: null, pendingEventIds: new Set(),
};
const state = new Proxy(rawState, { set(target, key, value) { target[key] = value; queueRender(); return true; } });
const app = document.getElementById('app');

function queueRender() { if (renderQueued) return; renderQueued = true; queueMicrotask(() => { renderQueued = false; render(); }); }
function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function statusLabel(value) { return escapeHtml(String(value || '').replaceAll('_', ' ')); }
function uuid() { return 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

async function api(path, { method='GET', body } = {}) {
  const headers = { 'Content-Type':'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) logout();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function handleAuthSubmit(e) {
  e.preventDefault(); const form = e.target; state.authError = null;
  const body = state.authMode === 'login' ? { phone: form.phone.value.trim(), password: form.password.value } : { name: form.name.value.trim(), phone: form.phone.value.trim(), password: form.password.value, role: form.role.value };
  try { const data = await api(state.authMode === 'login' ? '/auth/login' : '/auth/register', { method:'POST', body }); state.user=data.user; state.token=data.token; localStorage.setItem('reflex_user', JSON.stringify(data.user)); localStorage.setItem('reflex_token', data.token); afterLogin(); }
  catch (err) { state.authError = err.message; }
}
function logout() { if (state.ws) state.ws.close(); state.user=null; state.token=null; state.ws=null; localStorage.removeItem('reflex_user'); localStorage.removeItem('reflex_token'); }
async function afterLogin() { connectWebSocket(); await loadRequests(); if (state.user.role === 'dispatcher') await loadRiders(); }

function connectWebSocket() {
  if (!state.token) return;
  if (state.ws) { try { state.ws.close(); } catch {} }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ type:'authenticate', token:state.token }));
  ws.onmessage = (msg) => { try { const data=JSON.parse(msg.data); if (['new_request','status_event','assignment_notification'].includes(data.type)) loadRequests(); } catch {} };
  ws.onclose = () => { if (state.token) setTimeout(() => { if (state.token) connectWebSocket(); }, 3000); };
  state.ws = ws;
}
async function loadRequests() { try { const data=await api('/deliveries'); state.requests=data.requests || []; } catch (err) { console.error(err); } }
async function loadRiders() { try { const data=await api('/assignments/riders'); state.riders=data.riders || []; } catch (err) { console.error(err); } }
async function loadHistory(id) { const data=await api(`/deliveries/${id}/history`); return data.history || []; }

async function handleCreateRequest(e) { e.preventDefault(); const form=e.target; const body={ customer_name:form.customer_name.value.trim(), customer_phone:form.customer_phone.value.trim(), address:form.address.value.trim(), item_description:form.item_description.value.trim() }; try { await api('/deliveries',{method:'POST',body}); form.reset(); await loadRequests(); } catch(err){ alert(err.message); } }
function openAssignModal(id) { state.modal={type:'assign',requestId:id}; }
async function assignRider(id,riderId) { try { await api('/assignments',{method:'POST',body:{delivery_request_id:id,rider_id:riderId}}); state.modal=null; await loadRequests(); } catch(err){ alert(err.message); } }

async function updateStatus(id,status) {
  const clientEventId=uuid(); const payload={status,client_event_id:clientEventId};
  if (!navigator.onLine) { await ReflexQueue.queueAdd({clientEventId,requestId:id,payload,createdAt:Date.now()}); state.pendingEventIds.add(clientEventId); return; }
  try { await api(`/status/${id}`,{method:'POST',body:payload}); await loadRequests(); }
  catch { await ReflexQueue.queueAdd({clientEventId,requestId:id,payload,createdAt:Date.now()}); state.pendingEventIds.add(clientEventId); }
}
async function flushQueue() { const items=await ReflexQueue.queueAll(); for(const item of items){ try{ await api(`/status/${item.requestId}`,{method:'POST',body:item.payload}); await ReflexQueue.queueRemove(item.clientEventId); state.pendingEventIds.delete(item.clientEventId); }catch{} } await loadRequests(); }
window.addEventListener('online',()=>{state.online=true;flushQueue();}); window.addEventListener('offline',()=>{state.online=false;});

let scannerInstance=null;
function openScanModal(id){ state.modal={type:'scan',requestId:id}; setTimeout(()=>startScanner(id),50); }
function startScanner(id){ const el=document.getElementById('qr-reader'); if(!el||typeof Html5Qrcode==='undefined')return; scannerInstance=new Html5Qrcode('qr-reader'); scannerInstance.start({facingMode:'environment'},{fps:10,qrbox:220},async decoded=>{await stopScanner();try{await api(`/status/${id}/confirm`,{method:'POST',body:{qr_payload:decoded}});state.modal=null;await loadRequests();}catch(err){alert(err.message);}},()=>{}).catch(()=>{el.replaceChildren();const p=document.createElement('p');p.textContent='Camera unavailable. Enter code manually below.';p.className='scanner-fallback';el.appendChild(p);}); }
async function stopScanner(){if(scannerInstance){try{await scannerInstance.stop();}catch{} scannerInstance=null;}}
async function manualConfirm(id){const input=document.getElementById('manual-qr-input');const code=input?input.value.trim():'';if(!code)return;try{await api(`/status/${id}/confirm`,{method:'POST',body:{qr_payload:code}});state.modal=null;await loadRequests();}catch(err){alert(err.message);}}
function closeModal(){stopScanner();state.modal=null;}

function toggleTicket(id){state.expandedTicket=state.expandedTicket===id?null:id;if(state.expandedTicket===id)loadHistory(id).then(history=>{const el=document.querySelector(`[data-ledger="${CSS.escape(String(id))}"]`);if(!el)return;el.replaceChildren();for(const h of history){const row=document.createElement('div');row.className='ledger-row';const stamp=document.createElement('span');stamp.className='stamp';stamp.textContent=new Date(h.created_at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});const status=document.createElement('span');status.textContent=String(h.status||'').replaceAll('_',' ');const who=document.createElement('span');who.className='who';who.textContent=`— ${h.actor_name || ''}`;row.append(document.createElement('span'),stamp,status,who);el.appendChild(row);}}).catch(console.error);}
function timeAgo(iso){const mins=Math.floor((Date.now()-new Date(iso).getTime())/60000);if(mins<1)return'just now';if(mins<60)return`${mins}m ago`;const hrs=Math.floor(mins/60);if(hrs<24)return`${hrs}h ago`;return`${Math.floor(hrs/24)}d ago`;}
function renderLedgerPlaceholder(){const span=document.createElement('span');span.className='mono';span.style.cssText='font-size:11px;color:#8A8A7E;';span.textContent='Loading ledger…';return span;}

function renderRetailerTimeline(r){const base=['REQUESTED','ASSIGNED','PICKED_UP','DELIVERED'];const idx=base.indexOf(r.current_status);const issue=['FAILED','STUCK_IN_TRANSIT','CANCELLED'].includes(r.current_status);const steps=base.map((step,i)=>`<div class="reflex-tracking-step ${idx>=0&&i<=idx?'complete':''} ${idx===i?'current':''}"><span class="reflex-tracking-dot">${idx>=0&&i<=idx?'✓':i+1}</span><span class="reflex-tracking-label">${statusLabel(step)}</span></div>`).join('');let text='';if(r.current_status==='FAILED')text='Delivery issue reported by rider.';else if(r.current_status==='STUCK_IN_TRANSIT')text='No delivery confirmation within the configured timeout.';else if(r.current_status==='CANCELLED')text='Delivery was cancelled.';return `<div class="reflex-tracking"><div class="reflex-tracking-title">Delivery progress</div><div class="reflex-tracking-steps">${steps}</div>${issue?`<div class="reflex-tracking-issue status-${escapeHtml(r.current_status)}"><strong>${statusLabel(r.current_status)}</strong><span>${escapeHtml(text)}</span></div>`:''}<div class="reflex-tracking-live">Current status: <strong>${statusLabel(r.current_status)}</strong></div></div>`;}

function renderTicket(r){const expanded=state.expandedTicket===r.id;const role=state.user.role;let actions='';if(role==='dispatcher'&&r.current_status==='REQUESTED')actions=`<div class="ticket-actions"><button class="btn amber" onclick="openAssignModal(${Number(r.id)})">Assign rider</button></div>`;else if(role==='rider'&&r.current_status==='ASSIGNED')actions=`<div class="ticket-actions"><button class="btn amber" onclick="updateStatus(${Number(r.id)},'PICKED_UP')">Mark picked up</button></div>`;else if(role==='rider'&&r.current_status==='PICKED_UP')actions=`<div class="ticket-actions"><button class="btn amber" onclick="openScanModal(${Number(r.id)})">Scan to confirm delivery</button></div>`;const border={REQUESTED:'var(--grey-status)',ASSIGNED:'var(--blue-status)',PICKED_UP:'var(--amber-status)',DELIVERED:'var(--green-status)',FAILED:'var(--red-status)',STUCK_IN_TRANSIT:'var(--red-status)',CANCELLED:'var(--red-status)'}[r.current_status]||'var(--line)';return `<div class="ticket" style="border-left-color:${border}"><div class="ticket-head" onclick="toggleTicket(${Number(r.id)})" style="cursor:pointer"><div><div class="ticket-id">Order #${String(r.id).padStart(6,'0')}</div></div><span class="ticket-status status-${escapeHtml(r.current_status)}">${statusLabel(r.current_status)}</span></div><div class="ticket-body"><div class="customer">${escapeHtml(r.customer_name)}</div><div class="addr">${escapeHtml(r.address)}</div><div class="item">${escapeHtml(r.item_description)}</div><div class="ticket-meta"><span>${escapeHtml(r.customer_phone)}</span><span>${escapeHtml(timeAgo(r.status_updated_at||r.created_at))}</span></div>${role==='retailer'?renderRetailerTimeline(r):''}${expanded?`<div class="ledger" data-ledger="${escapeHtml(r.id)}"></div>`:''}</div>${actions}</div>`;}
function renderRequestList(reqs,glyph,text){return reqs.length?reqs.map(renderTicket).join(''):`<div class="empty"><div class="glyph">${glyph}</div><p>${text}</p></div>`;}
function renderRetailerView(){return `<form class="card-form" onsubmit="handleCreateRequest(event)"><div class="section-title" style="margin-top:0">Log a delivery</div><div class="field"><label>Customer name</label><input name="customer_name" required></div><div class="field"><label>Customer phone</label><input name="customer_phone" required></div><div class="field"><label>Delivery address</label><input name="address" required></div><div class="field"><label>Item</label><input name="item_description" required></div><button class="btn amber" type="submit">Submit request</button></form><div class="section-title">Your requests <span class="count-badge">${state.requests.length}</span></div>${renderRequestList(state.requests,'📋','Requests you log will show up here with live status.')}`;}
function renderDispatcherView(){const open=state.requests.filter(r=>r.current_status==='REQUESTED'),active=state.requests.filter(r=>['ASSIGNED','PICKED_UP'].includes(r.current_status)),done=state.requests.filter(r=>['DELIVERED','FAILED','CANCELLED','STUCK_IN_TRANSIT'].includes(r.current_status));return `<div class="section-title">Open <span class="count-badge">${open.length}</span></div>${renderRequestList(open,'📥','No unassigned requests right now.')}<div class="section-title">In progress <span class="count-badge">${active.length}</span></div>${renderRequestList(active,'🚴','Nothing out for delivery.')}<div class="section-title">Completed <span class="count-badge">${done.length}</span></div>${renderRequestList(done,'✅','Completed deliveries appear here.')}`;}
function renderRiderView(){const active=state.requests.filter(r=>['ASSIGNED','PICKED_UP'].includes(r.current_status)),done=state.requests.filter(r=>['DELIVERED','FAILED','STUCK_IN_TRANSIT'].includes(r.current_status));return `<div class="section-title">Your route <span class="count-badge">${active.length}</span></div>${renderRequestList(active,'🛵','Nothing assigned to you yet.')}<div class="section-title">Completed today <span class="count-badge">${done.length}</span></div>${renderRequestList(done,'📦','Delivered items will show here.')}`;}

function renderModal(){if(!state.modal)return'';if(state.modal.type==='assign'){const options=state.riders.map(r=>`<div class="rider-option" onclick="assignRider(${Number(state.modal.requestId)},${Number(r.id)})"><span>${escapeHtml(r.name)}</span><span class="mono" style="color:#8A8A7E">${escapeHtml(r.phone)}</span></div>`).join('');return `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal-sheet"><h3>Assign to a rider</h3>${options||'<p style="color:#8A8A7E;font-size:13px">No riders registered yet.</p>'}<button class="btn secondary" style="margin-top:8px" onclick="closeModal()">Cancel</button></div></div>`;}return `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal-sheet"><h3>Scan delivery QR</h3><div id="qr-reader"></div><div class="field"><label>Or enter code manually</label><input id="manual-qr-input" placeholder="REFLEX-REQ-..."></div><button class="btn amber" onclick="manualConfirm(${Number(state.modal.requestId)})">Confirm delivery</button><button class="btn secondary" style="margin-top:8px" onclick="closeModal()">Cancel</button></div></div>`;}
function renderAuthScreen(){const login=state.authMode==='login';return `<div class="auth-screen"><div class="auth-header"><span class="wordmark">Reflex</span></div><div class="breadcrumb"><span>Home</span><span class="sep">/</span><span class="current">${login?'Sign In':'Create Account'}</span></div><div class="auth-card-wrap"><div class="auth-card"><h2>${login?'Sign In':'Create an Account'}</h2><p class="auth-tagline">${login?'Sign in to view your deliveries and track status in real time.':'Register to log requests, dispatch riders, or manage your delivery route.'}</p>${state.authError?`<div class="auth-error">${escapeHtml(state.authError)}</div>`:''}<form onsubmit="handleAuthSubmit(event)">${!login?'<div class="field"><label>Full name</label><input name="name" required></div>':''}<div class="field"><label>Phone number</label><input name="phone" required placeholder="0700000000"></div><div class="field"><label>Password</label><input name="password" type="password" required></div>${!login?'<div class="field"><label>Account type</label><select name="role" required><option value="retailer">Retailer</option><option value="dispatcher">Dispatcher</option><option value="rider">Rider</option></select></div>':''}<button class="btn amber" type="submit">${login?'Sign In':'Create Account'}</button></form><div class="auth-divider">or</div><div class="auth-toggle">${login?`New to Reflex? <a onclick="switchAuthMode('register')">Create an account</a>`:`Already have an account? <a onclick="switchAuthMode('login')">Sign in</a>`}</div></div></div></div>`;}
function switchAuthMode(mode){state.authMode=mode;state.authError=null;}
function render(){if(!app)return;if(!state.user){app.innerHTML=renderAuthScreen();return;}const views={retailer:renderRetailerView,dispatcher:renderDispatcherView,rider:renderRiderView};const crumbs={retailer:'My Deliveries',dispatcher:'Dispatch Board',rider:'My Route'};app.innerHTML=`<div class="topbar"><div class="brand wordmark"><span class="stub"></span>Reflex</div><div style="display:flex;align-items:center;gap:10px"><span class="role-pill">${escapeHtml(state.user.role)}</span><button class="logout" onclick="logout()">Sign out</button></div></div><div class="breadcrumb"><span>Home</span><span class="sep">/</span><span class="current">${crumbs[state.user.role]}</span></div>${!state.online?`<div class="conn-status offline">Offline — updates will sync when reconnected${state.pendingEventIds.size?` (${state.pendingEventIds.size} queued)`:''}</div>`:''}<main>${views[state.user.role]()}</main>${renderModal()}`;}

if(state.user&&state.token)afterLogin();else render();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
