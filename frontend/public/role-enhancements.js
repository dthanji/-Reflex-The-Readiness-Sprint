// Reliable role-specific workflow enhancements for Reflex.
// This module decorates the already-rendered core UI instead of replacing
// app.js's lexical render functions. That makes the controls survive every
// render/loadRequests cycle.
(function () {
  let assignmentSocket = null;
  let assignmentPoller = null;
  let lastAssignmentSnapshot = new Map();
  let decorateTimer = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showToast(title, message) {
    let toast = document.getElementById('reflex-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'reflex-toast';
      toast.className = 'reflex-toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    toast.classList.add('show');
    clearTimeout(window.__reflexToastTimer);
    window.__reflexToastTimer = setTimeout(() => toast.classList.remove('show'), 6500);
  }

  function closeEnhancementModal() {
    const modal = document.getElementById('reflex-enhancement-modal');
    if (modal) modal.remove();
  }

  async function loadRidersForRole() {
    const endpoint = state.user && state.user.role === 'dispatcher' ? '/assignments/riders' : '/deliveries/riders';
    const data = await api(endpoint);
    return data.riders || [];
  }

  async function performReassign(requestId, riderId) {
    const role = state.user && state.user.role;
    const endpoint = role === 'dispatcher'
      ? `/assignments/${requestId}/reassign`
      : `/deliveries/${requestId}/reassign`;
    try {
      const result = await api(endpoint, { method: 'PUT', body: { rider_id: Number(riderId) } });
      closeEnhancementModal();
      await loadRequests();
      showToast('Rider reassigned', `Order #${String(requestId).padStart(6, '0')} is now assigned to ${result.rider.name}.`);
    } catch (err) {
      alert(err.message);
    }
  }

  async function openReassignModal(requestId) {
    try {
      const riders = await loadRidersForRole();
      const modal = document.createElement('div');
      modal.id = 'reflex-enhancement-modal';
      modal.className = 'modal-backdrop';
      modal.onclick = (event) => { if (event.target === modal) closeEnhancementModal(); };
      const options = riders.map(r => `
        <button type="button" class="rider-option" data-rider-id="${Number(r.id)}">
          <span>${escapeHtml(r.name)}</span><span class="mono" style="color:#8A8A7E;">${escapeHtml(r.phone)}</span>
        </button>
      `).join('');
      modal.innerHTML = `<div class="modal-sheet">
        <h3>Change delivery person</h3>
        <p style="font-size:13px;color:#706C67;line-height:1.5;">This order is marked FAILED because the previous rider reported a delivery issue. Select a replacement rider.</p>
        <div class="reassign-options">${options || '<p style="color:#8A8A7E;font-size:13px;">No riders registered.</p>'}</div>
        <button type="button" class="btn secondary" style="margin-top:8px;" id="reflex-cancel-reassign">Cancel</button>
      </div>`;
      document.body.appendChild(modal);
      modal.querySelector('#reflex-cancel-reassign').onclick = closeEnhancementModal;
      modal.querySelectorAll('[data-rider-id]').forEach(button => {
        button.onclick = () => performReassign(requestId, button.dataset.riderId);
      });
    } catch (err) {
      alert(err.message);
    }
  }

  async function reportIssue(requestId) {
    const input = document.getElementById('reflex-issue-input');
    const issue = input ? input.value.trim() : '';
    if (!issue) { alert('Please describe the delivery issue.'); return; }
    try {
      await api(`/status/${requestId}`, {
        method: 'POST',
        body: { status: 'FAILED', client_event_id: uuid(), metadata: { issue, reported_by_rider: true } }
      });
      closeEnhancementModal();
      await loadRequests();
      showToast('Delivery issue reported', `Order #${String(requestId).padStart(6, '0')} is now available for reassignment.`);
    } catch (err) { alert(err.message); }
  }

  function openIssueModal(requestId) {
    const modal = document.createElement('div');
    modal.id = 'reflex-enhancement-modal';
    modal.className = 'modal-backdrop';
    modal.onclick = (event) => { if (event.target === modal) closeEnhancementModal(); };
    modal.innerHTML = `<div class="modal-sheet">
      <h3>Report delivery issue</h3>
      <p style="font-size:13px;color:#706C67;line-height:1.5;">Describe why you cannot complete this delivery. The issue will be recorded in the audit trail and the order can then be reassigned.</p>
      <div class="field"><label>Issue</label><textarea id="reflex-issue-input" rows="4" placeholder="e.g. Customer unavailable, address inaccessible..."></textarea></div>
      <button type="button" class="btn amber" id="reflex-submit-issue">Report issue</button>
      <button type="button" class="btn secondary" style="margin-top:8px;" id="reflex-cancel-issue">Cancel</button>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#reflex-submit-issue').onclick = () => reportIssue(requestId);
    modal.querySelector('#reflex-cancel-issue').onclick = closeEnhancementModal;
  }

  function requestIdFromTicket(ticket) {
    const idEl = ticket.querySelector('.ticket-id');
    const match = idEl && idEl.textContent.match(/#(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function decorateTickets() {
    if (!state.user || !Array.isArray(state.requests)) return;
    document.querySelectorAll('.ticket').forEach(ticket => {
      const requestId = requestIdFromTicket(ticket);
      if (!requestId) return;
      const request = state.requests.find(r => Number(r.id) === requestId);
      if (!request) return;

      const existing = ticket.querySelector('.reflex-enhancement-controls');
      if (existing) existing.remove();
      const oldRider = ticket.querySelector('.assigned-rider');
      if (oldRider) oldRider.remove();

      if (request.rider_id && request.rider_name) {
        const rider = document.createElement('div');
        rider.className = 'assigned-rider';
        rider.innerHTML = `<strong>Assigned rider</strong><span>${escapeHtml(request.rider_name)}</span><span class="mono">${escapeHtml(request.rider_phone || 'No phone on file')}</span>`;
        const body = ticket.querySelector('.ticket-body');
        if (body) body.appendChild(rider);
      }

      const controls = document.createElement('div');
      controls.className = 'ticket-actions enhancement-actions reflex-enhancement-controls';

      if (state.user.role === 'rider' && ['ASSIGNED', 'PICKED_UP'].includes(request.current_status)) {
        const button = document.createElement('button');
        button.className = 'btn secondary';
        button.textContent = 'Report delivery issue';
        button.onclick = () => openIssueModal(requestId);
        controls.appendChild(button);
      }

      if (['retailer', 'dispatcher'].includes(state.user.role) && request.current_status === 'FAILED') {
        const button = document.createElement('button');
        button.className = 'btn amber';
        button.textContent = 'Change delivery person';
        button.onclick = () => openReassignModal(requestId);
        controls.appendChild(button);
      }

      if (controls.children.length) ticket.appendChild(controls);
    });
  }

  function scheduleDecorate() {
    if (decorateTimer) return;
    decorateTimer = setTimeout(() => {
      decorateTimer = null;
      observer.disconnect();
      try { decorateTickets(); } finally {
        observer.observe(document.getElementById('app'), { childList: true, subtree: true });
      }
    }, 0);
  }

  function startAssignmentNotifications() {
    if (assignmentSocket) { try { assignmentSocket.close(); } catch (_) {} assignmentSocket = null; }
    if (assignmentPoller) { clearInterval(assignmentPoller); assignmentPoller = null; }
    lastAssignmentSnapshot = new Map();
    if (!state.user || state.user.role !== 'dispatcher' || !state.token) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const connect = () => {
      if (!state.token || !state.user || state.user.role !== 'dispatcher') return;
      try {
        assignmentSocket = new WebSocket(`${protocol}//${location.host}/ws?token=${state.token}`);
        assignmentSocket.onmessage = async (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data.type === 'assignment_notification' && data.rider) {
              showToast(data.reassigned ? 'Rider reassigned' : 'Rider assigned', `Order #${String(data.delivery_request_id).padStart(6, '0')}: ${data.rider.name} · ${data.rider.phone}`);
              await loadRequests();
            }
          } catch (_) {}
        };
        assignmentSocket.onclose = () => {
          if (state.token && state.user && state.user.role === 'dispatcher') setTimeout(connect, 3000);
        };
      } catch (_) {}
    };
    connect();

    api('/deliveries').then(data => {
      lastAssignmentSnapshot = new Map((data.requests || []).map(r => [r.id, `${r.current_status}|${r.rider_id || ''}`]));
    }).catch(() => {});

    assignmentPoller = setInterval(async () => {
      if (!state.user || state.user.role !== 'dispatcher' || !state.token) return;
      try {
        const data = await api('/deliveries');
        const next = new Map((data.requests || []).map(r => [r.id, `${r.current_status}|${r.rider_id || ''}`]));
        if (lastAssignmentSnapshot.size) {
          for (const r of data.requests || []) {
            const signature = `${r.current_status}|${r.rider_id || ''}`;
            if (r.current_status === 'ASSIGNED' && r.rider_id && r.rider_name && lastAssignmentSnapshot.get(r.id) !== signature) {
              showToast('Rider assigned', `Order #${String(r.id).padStart(6, '0')}: ${r.rider_name} · ${r.rider_phone || 'No phone on file'}`);
            }
          }
        }
        lastAssignmentSnapshot = next;
      } catch (_) {}
    }, 8000);
  }

  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(document.getElementById('app'), { childList: true, subtree: true });
  scheduleDecorate();
  if (state.user) startAssignmentNotifications();

  window.addEventListener('beforeunload', () => {
    if (assignmentSocket) { try { assignmentSocket.close(); } catch (_) {} }
    if (assignmentPoller) clearInterval(assignmentPoller);
  });

  const style = document.createElement('style');
  style.textContent = `.assigned-rider{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 14px;padding:9px 10px;background:#F7F6F5;border-top:1px solid var(--line);font-size:12px}.assigned-rider strong{width:100%;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#706C67}.assigned-rider .mono{color:#706C67}.enhancement-actions{padding:0 14px 12px}.enhancement-actions .btn{width:100%}.reflex-toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,20px);opacity:0;pointer-events:none;z-index:1000;width:min(92vw,420px);background:#231F20;color:#fff;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.18);transition:.2s ease;display:flex;flex-direction:column;gap:4px;font-family:Inter,system-ui,sans-serif}.reflex-toast.show{opacity:1;transform:translate(-50%,0)}.reflex-toast strong{font-size:13px}.reflex-toast span{font-size:12px;opacity:.86}.modal-sheet textarea{width:100%;padding:12px;border:1px solid #C9C6C2;border-radius:0;font:15px Inter,system-ui,sans-serif;resize:vertical}.reassign-options{display:flex;flex-direction:column;gap:6px}.rider-option{width:100%;display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid var(--line);background:#fff;cursor:pointer;font:inherit;text-align:left}.rider-option:hover{background:#F7F6F5}`;
  document.head.appendChild(style);
})();
