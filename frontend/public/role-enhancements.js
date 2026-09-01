// Role-specific workflow enhancements for retailer, rider and dispatcher views.
(function () {
  const originalRenderTicket = window.renderTicket;
  const originalRenderModal = window.renderModal;
  let lastDispatcherSnapshot = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
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
        body: { status: 'FAILED', client_event_id: uuid(), metadata: { issue, reported_by_rider: true } }
      });
      state.modal = null;
      await loadRequests();
      showToast('Delivery issue reported', `Order #${String(requestId).padStart(6, '0')} has been flagged for review.`);
    } catch (err) { alert(err.message); }
  };

  window.openReassignModal = async function (requestId) {
    try {
      const data = await api('/deliveries/riders');
      state.riders = data.riders;
    } catch (err) {
      alert(err.message);
      return;
    }
    state.modal = { type: 'reassign', requestId };
    render();
  };

  window.reassignRider = async function (requestId, riderId) {
    try {
      await api(`/deliveries/${requestId}/reassign`, { method: 'PUT', body: { rider_id: riderId } });
      state.modal = null;
      await loadRequests();
      showToast('Rider changed', `Order #${String(requestId).padStart(6, '0')} was reassigned successfully.`);
    } catch (err) { alert(err.message); }
  };

  window.renderTicket = function (r) {
    let html = originalRenderTicket(r);
    const role = state.user.role;
    const riderBlock = r.rider_id && r.rider_name
      ? `<div class="assigned-rider"><strong>Assigned rider</strong><span>${escapeHtml(r.rider_name)}</span><span class="mono">${escapeHtml(r.rider_phone || '')}</span></div>` : '';
    const issueBlock = role === 'rider' && ['ASSIGNED', 'PICKED_UP'].includes(r.current_status)
      ? `<div class="ticket-actions enhancement-actions"><button class="btn secondary" onclick="openIssueModal(${r.id})">Report delivery issue</button></div>` : '';
    const reassignBlock = role === 'retailer' && r.current_status === 'FAILED'
      ? `<div class="ticket-actions enhancement-actions"><button class="btn amber" onclick="openReassignModal(${r.id})">Change delivery person</button></div>` : '';

    const actionIndex = html.indexOf('<div class="ticket-actions">');
    if (actionIndex >= 0) {
      html = html.slice(0, actionIndex) + riderBlock + html.slice(actionIndex);
      const outerClose = html.lastIndexOf('</div>\n    </div>');
      if (issueBlock || reassignBlock) html = html.slice(0, outerClose) + issueBlock + reassignBlock + html.slice(outerClose);
    } else if (riderBlock || reassignBlock) {
      const outerClose = html.lastIndexOf('</div>\n    </div>');
      html = html.slice(0, outerClose) + riderBlock + reassignBlock + html.slice(outerClose);
    }
    return html;
  };

  window.renderModal = function () {
    if (state.modal && state.modal.type === 'issue') {
      return `<div class="modal-backdrop" onclick="if(event.target===this) closeModal()"><div class="modal-sheet">
        <h3>Report delivery issue</h3>
        <p style="font-size:13px;color:#706C67;line-height:1.5;">Tell the dispatch team why you cannot complete this delivery. The issue is recorded in the audit trail.</p>
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

  // Dispatcher notification fallback: poll every 8 seconds and announce a
  // newly assigned rider with name and phone. WebSocket updates still refresh
  // the board immediately; polling protects the notification if WS reconnects.
  if (state.user && state.user.role === 'dispatcher') {
    setInterval(async () => {
      try {
        const data = await api('/deliveries');
        const next = new Map(data.requests.map(r => [r.id, `${r.current_status}|${r.rider_id || ''}`]));
        if (lastDispatcherSnapshot) {
          for (const r of data.requests) {
            const signature = `${r.current_status}|${r.rider_id || ''}`;
            if (r.current_status === 'ASSIGNED' && r.rider_id && lastDispatcherSnapshot.get(r.id) !== signature && r.rider_name) {
              showToast('Rider assigned', `Order #${String(r.id).padStart(6,'0')}: ${r.rider_name} · ${r.rider_phone || 'No phone on file'}`);
            }
          }
        }
        lastDispatcherSnapshot = next;
      } catch (_) {}
    }, 8000);
  }

  const style = document.createElement('style');
  style.textContent = `
    .assigned-rider{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 14px;padding:9px 10px;background:#F7F6F5;border-top:1px solid var(--line);font-size:12px}.assigned-rider strong{width:100%;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#706C67}.assigned-rider .mono{color:#706C67}.enhancement-actions{padding-top:0}.reflex-toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,20px);opacity:0;pointer-events:none;z-index:1000;width:min(92vw,420px);background:#231F20;color:#fff;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.18);transition:.2s ease;display:flex;flex-direction:column;gap:4px;font-family:Inter,system-ui,sans-serif}.reflex-toast.show{opacity:1;transform:translate(-50%,0)}.reflex-toast strong{font-size:13px}.reflex-toast span{font-size:12px;opacity:.86}.modal-sheet textarea{width:100%;padding:12px;border:1px solid #C9C6C2;border-radius:0;font:15px Inter,system-ui,sans-serif;resize:vertical}
  `;
  document.head.appendChild(style);

  if (state.user) render();
})();
