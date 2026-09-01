// Consolidated role-specific workflows for Reflex.
// This file intentionally owns the enhancement UI and lifecycle hooks so the
// core app remains the source of truth for authentication, status and data.
(function () {
  let assignmentSocket = null;
  let assignmentPoller = null;
  let lastAssignmentSnapshot = new Map();

  const originalRenderTicket = window.renderTicket;
  const originalRenderModal = window.renderModal;
  const originalAfterLogin = window.afterLogin;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
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

  function disconnectAssignmentNotifications() {
    if (assignmentSocket) {
      try { assignmentSocket.close(); } catch (_) {}
      assignmentSocket = null;
    }
    if (assignmentPoller) {
      clearInterval(assignmentPoller);
      assignmentPoller = null;
    }
    lastAssignmentSnapshot = new Map();
  }

  async function loadRetailerRiders() {
    const data = await api('/deliveries/riders');
    state.riders = data.riders || [];
  }

  window.openIssueModal = function (requestId) {
    state.modal = { type: 'issue', requestId };
    render();
  };

  window.reportDeliveryIssue = async function (requestId) {
    const input = document.getElementById('delivery-issue-input');
    const issue = input ? input.value.trim() : '';
    if (!issue) { alert('Please describe the delivery issue.'); return; }
    try {
      await api(`/status/${requestId}`, {
        method: 'POST',
        body: {
          status: 'FAILED',
          client_event_id: uuid(),
          metadata: { issue, reported_by_rider: true }
        }
      });
      state.modal = null;
      await loadRequests();
      showToast('Delivery issue reported', `Order #${String(requestId).padStart(6, '0')} has been flagged for review.`);
    } catch (err) { alert(err.message); }
  };

  window.openReassignModal = async function (requestId) {
    try {
      await loadRetailerRiders();
      state.modal = { type: 'reassign', requestId };
      render();
    } catch (err) { alert(err.message); }
  };

  window.reassignRider = async function (requestId, riderId) {
    try {
      const result = await api(`/deliveries/${requestId}/reassign`, {
        method: 'PUT',
        body: { rider_id: riderId }
      });
      state.modal = null;
      await loadRequests();
      showToast('Rider changed', `Order #${String(requestId).padStart(6, '0')} is now assigned to ${result.rider.name}.`);
    } catch (err) { alert(err.message); }
  };

  window.renderTicket = function (r) {
    let html = originalRenderTicket(r);
    const role = state.user && state.user.role;
    const riderBlock = r.rider_id && r.rider_name
      ? `<div class="assigned-rider"><strong>Assigned rider</strong><span>${escapeHtml(r.rider_name)}</span><span class="mono">${escapeHtml(r.rider_phone || 'No phone on file')}</span></div>`
      : '';

    const issueBlock = role === 'rider' && ['ASSIGNED', 'PICKED_UP'].includes(r.current_status)
      ? `<div class="ticket-actions enhancement-actions"><button class="btn secondary" onclick="openIssueModal(${r.id})">Report delivery issue</button></div>`
      : '';

    const reassignBlock = role === 'retailer' && r.current_status === 'FAILED'
      ? `<div class="ticket-actions enhancement-actions"><button class="btn amber" onclick="openReassignModal(${r.id})">Change delivery person</button></div>`
      : '';

    // Inject rider information immediately before the existing action area.
    const actionIndex = html.indexOf('<div class="ticket-actions">');
    if (actionIndex >= 0) {
      html = html.slice(0, actionIndex) + riderBlock + html.slice(actionIndex);
      const closeIndex = html.lastIndexOf('</div>\n    </div>');
      if (closeIndex >= 0) html = html.slice(0, closeIndex) + issueBlock + reassignBlock + html.slice(closeIndex);
    } else if (riderBlock || issueBlock || reassignBlock) {
      const closeIndex = html.lastIndexOf('</div>\n    </div>');
      if (closeIndex >= 0) html = html.slice(0, closeIndex) + riderBlock + issueBlock + reassignBlock + html.slice(closeIndex);
    }
    return html;
  };

  window.renderModal = function () {
    if (state.modal && state.modal.type === 'issue') {
      return `<div class="modal-backdrop" onclick="if(event.target===this) closeModal()"><div class="modal-sheet">
        <h3>Report delivery issue</h3>
        <p style="font-size:13px;color:#706C67;line-height:1.5;">Tell the dispatch team why you cannot complete this delivery. The issue is recorded in the audit trail and the retailer can reassign the order.</p>
        <div class="field"><label>Issue</label><textarea id="delivery-issue-input" rows="4" placeholder="e.g. Customer unavailable, address inaccessible..."></textarea></div>
        <button class="btn amber" onclick="reportDeliveryIssue(${state.modal.requestId})">Report issue</button>
        <button class="btn secondary" style="margin-top:8px;" onclick="closeModal()">Cancel</button>
      </div></div>`;
    }
    if (state.modal && state.modal.type === 'reassign') {
      const options = state.riders.map(r => `<div class="rider-option" onclick="reassignRider(${state.modal.requestId}, ${r.id})"><span>${escapeHtml(r.name)}</span><span class="mono" style="color:#8A8A7E;">${escapeHtml(r.phone)}</span></div>`).join('');
      return `<div class="modal-backdrop" onclick="if(event.target===this) closeModal()"><div class="modal-sheet">
        <h3>Change delivery person</h3>
        <p style="font-size:13px;color:#706C67;line-height:1.5;">The current rider reported a delivery issue. Select a replacement rider.</p>
        ${options || '<p style="color:#8A8A7E;font-size:13px;">No riders registered.</p>'}
        <button class="btn secondary" style="margin-top:8px;" onclick="closeModal()">Cancel</button>
      </div></div>`;
    }
    return originalRenderModal();
  };

  function startAssignmentNotifications() {
    disconnectAssignmentNotifications();
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
              showToast(
                data.reassigned ? 'Rider reassigned' : 'Rider assigned',
                `Order #${String(data.delivery_request_id).padStart(6, '0')}: ${data.rider.name} · ${data.rider.phone}`
              );
              await loadRequests();
            }
          } catch (_) {}
        };
        assignmentSocket.onclose = () => {
          if (state.token && state.user && state.user.role === 'dispatcher') {
            setTimeout(connect, 3000);
          }
        };
      } catch (_) {}
    };
    connect();

    // Polling is deliberately retained as a reliability fallback. It also
    // catches assignments made while the dispatcher was temporarily offline.
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

  // The original app establishes its WebSocket before this enhancement file
  // loads, but afterLogin is the reliable lifecycle point for role-specific
  // notification setup. Hook it once and keep the original behavior intact.
  window.afterLogin = function () {
    originalAfterLogin();
    setTimeout(startAssignmentNotifications, 0);
  };

  const originalLogout = window.logout;
  window.logout = function () {
    disconnectAssignmentNotifications();
    originalLogout();
  };

  const style = document.createElement('style');
  style.textContent = `
    .assigned-rider{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 14px;padding:9px 10px;background:#F7F6F5;border-top:1px solid var(--line);font-size:12px}.assigned-rider strong{width:100%;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#706C67}.assigned-rider .mono{color:#706C67}.enhancement-actions{padding-top:0}.reflex-toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,20px);opacity:0;pointer-events:none;z-index:1000;width:min(92vw,420px);background:#231F20;color:#fff;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.18);transition:.2s ease;display:flex;flex-direction:column;gap:4px;font-family:Inter,system-ui,sans-serif}.reflex-toast.show{opacity:1;transform:translate(-50%,0)}.reflex-toast strong{font-size:13px}.reflex-toast span{font-size:12px;opacity:.86}.modal-sheet textarea{width:100%;padding:12px;border:1px solid #C9C6C2;border-radius:0;font:15px Inter,system-ui,sans-serif;resize:vertical}
  `;
  document.head.appendChild(style);

  if (state.user) {
    // Existing sessions do not pass through afterLogin, so initialize here too.
    setTimeout(startAssignmentNotifications, 0);
    render();
  }
})();