// History-aware retailer delivery tracker.
// The core app already renders a progress tracker; this enhancement replaces
// its contents with the actual append-only status history so failed/reassigned
// deliveries do not hide earlier events.
(function () {
  const API = '/api';
  const cache = new Map();
  let timer = null;

  function token() { return localStorage.getItem('reflex_token') || ''; }

  async function getHistory(id) {
    const res = await fetch(`${API}/deliveries/${id}/history`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) throw new Error(`history ${res.status}`);
    const data = await res.json();
    return data.history || [];
  }

  function label(status) { return String(status || '').replace(/_/g, ' '); }
  function stamp(value) {
    return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function renderHistory(history) {
    const normal = ['REQUESTED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED'];
    const latest = history.length ? history[history.length - 1].status : 'REQUESTED';
    const issueEvents = history.filter(h => ['FAILED', 'STUCK_IN_TRANSIT', 'CANCELLED'].includes(h.status));
    const completed = new Set(history.map(h => h.status));

    const steps = normal.map((step, index) => {
      const done = completed.has(step) || (step === 'REQUESTED' && history.length > 0);
      const current = latest === step;
      return `<div class="reflex-tracking-step ${done ? 'complete' : ''} ${current ? 'current' : ''}">
        <span class="reflex-tracking-dot">${done ? '✓' : index + 1}</span>
        <span class="reflex-tracking-label">${label(step)}</span>
      </div>`;
    }).join('');

    const issue = issueEvents.length ? issueEvents.map(event => `
      <div class="reflex-tracking-issue">
        <strong>${escapeHtml(label(event.status))} · ${escapeHtml(stamp(event.created_at))}</strong>
        <span>${event.status === 'FAILED' ? 'Delivery issue reported by rider.' : event.status === 'STUCK_IN_TRANSIT' ? 'No delivery confirmation within 24 hours of pickup.' : 'Delivery was cancelled.'}</span>
      </div>
    `).join('') : '';

    const historyRows = history.map(event => `
      <div class="retailer-history-row">
        <span class="retailer-history-dot"></span>
        <span><strong>${escapeHtml(label(event.status))}</strong><small>${escapeHtml(stamp(event.created_at))} · ${escapeHtml(event.actor_name || 'System')}</small></span>
      </div>
    `).join('');

    return `<div class="reflex-tracking-title">Delivery progress</div>
      <div class="reflex-tracking-steps">${steps}</div>
      ${issue}
      <div class="reflex-tracking-live">Current status: <strong>${escapeHtml(label(latest))}</strong></div>
      <div class="retailer-history">${historyRows}</div>`;
  }

  async function refresh() {
    if (!location.pathname || !token()) return;
    const user = JSON.parse(localStorage.getItem('reflex_user') || 'null');
    if (!user || user.role !== 'retailer') return;

    const trackers = document.querySelectorAll('.reflex-tracking[data-request-id]');
    for (const el of trackers) {
      const id = el.dataset.requestId;
      try {
        const history = await getHistory(id);
        const signature = history.map(h => `${h.id}:${h.status}:${h.created_at}`).join('|');
        const cached = cache.get(id);
        if (!cached || cached.signature !== signature) {
          el.innerHTML = renderHistory(history);
          cache.set(id, { signature });
        }
      } catch (err) {
        // Keep the core tracker visible if history is temporarily unavailable.
        console.warn('[reflex] retailer tracking history unavailable', err.message);
      }
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { refresh(); }, 250);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.getElementById('app'), { childList: true, subtree: true });
  setInterval(refresh, 5000);
  schedule();
})();