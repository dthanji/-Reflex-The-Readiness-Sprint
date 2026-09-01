// Rider performance ratings and delivery rating controls.
(function () {
  let riderSummary = null;
  let riderSummaries = new Map();
  let refreshTimer = null;
  function session() { try { return { user: JSON.parse(localStorage.getItem('reflex_user') || 'null'), token: localStorage.getItem('reflex_token') || '' }; } catch (e) { return { user: null, token: '' }; } }
  async function api(path, options = {}) { const s = session(); const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }; if (s.token) headers.Authorization = `Bearer ${s.token}`; const res = await fetch('/api' + path, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`); return data; }
  function stars(value) { const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0))); return '★'.repeat(n) + '☆'.repeat(5 - n); }
  function ratingText(r) { return r == null ? 'No ratings yet' : `${Number(r).toFixed(1)} / 5`; }
  async function loadRiderSummary() { const s = session(); if (!s.user || s.user.role !== 'rider') return; try { riderSummary = await api('/ratings/rider/' + s.user.id); renderRiderSummary(); } catch (e) { console.warn('[reflex] rider summary load failed:', e.message); } }
  async function loadDispatcherRiders() { const s = session(); if (!s.user || s.user.role !== 'dispatcher') return; try { const data = await api('/ratings/riders'); riderSummaries = new Map(data.riders.map(r => [Number(r.id), r])); decorateRiderSelectors(); } catch (e) { console.warn('[reflex] rider rating list failed:', e.message); } }
  function renderRiderSummary() { const s = session(); if (!s.user || s.user.role !== 'rider' || !riderSummary) return; const app = document.getElementById('app'); if (!app) return; const existing = app.querySelector('.reflex-rider-rating-card'); if (existing) existing.remove(); const card = document.createElement('div'); card.className = 'reflex-rider-rating-card'; const r=riderSummary; card.innerHTML = `<div class="reflex-rider-summary-main"><div class="reflex-rating-kicker">YOUR PERFORMANCE</div><div class="reflex-rating-stars">${stars(r.average_rating)}</div><div class="reflex-rating-score">${ratingText(r.average_rating)}</div><div class="reflex-rating-count">${r.rating_count} rating${r.rating_count === 1 ? '' : 's'}</div></div><div class="reflex-rider-stat-grid"><div><strong>${r.deliveries_completed || 0}</strong><span>Delivered</span></div><div><strong>${r.deliveries_assigned || 0}</strong><span>Assigned</span></div><div><strong>${r.deliveries_failed || 0}</strong><span>Failed</span></div><div><strong>${r.rating_count || 0}</strong><span>Ratings</span></div></div>`; const first = app.firstElementChild; if (first) app.insertBefore(card, first); }
  function decorateRiderSelectors() { const s = session(); if (!s.user || s.user.role !== 'dispatcher') return; document.querySelectorAll('select').forEach(select => { Array.from(select.options).forEach(option => { const rider = riderSummaries.get(Number(option.value)); if (!rider || option.dataset.ratingDecorated) return; option.dataset.ratingDecorated = '1'; option.textContent += ` — ${rider.average_rating == null ? 'No rating' : `★ ${Number(rider.average_rating).toFixed(1)}/5`} (${rider.rating_count})`; }); }); }
  function getTicketDeliveryId(ticket) { const idEl = ticket.querySelector('.ticket-id'); const match = idEl && idEl.textContent.match(/#(\d+)/); return match ? Number(match[1]) : null; }
  function isDeliveredTicket(ticket) { const statusEl = ticket.querySelector('.ticket-status'); return Boolean(statusEl && (statusEl.classList.contains('status-DELIVERED') || statusEl.textContent.trim() === 'DELIVERED')); }
  function renderRatingControl(ticket, rated) {
    const s = session();
    if (!s.user || !['dispatcher','retailer'].includes(s.user.role)) return;
    const body = ticket.querySelector('.ticket-body'); const deliveryId = getTicketDeliveryId(ticket); if (!body || !deliveryId) return;
    const old = body.querySelector('.reflex-rate-rider'); if (old) old.remove();
    const panel = document.createElement('div'); panel.className = 'reflex-rate-rider'; panel.dataset.deliveryId = String(deliveryId);
    if (rated) { panel.innerHTML = '<div class="reflex-rate-success"><strong>Rating already submitted</strong><br><small>You have already rated this delivered order.</small></div>'; body.appendChild(panel); return; }
    const label = s.user.role === 'retailer' ? 'Rate rider & delivery' : 'Rate this rider';
    const note = s.user.role === 'retailer' ? 'Your retailer rating is separate from the dispatcher rating.' : 'One dispatcher rating per delivered order.';
    panel.innerHTML = `<div class="reflex-rate-title">${label}</div><div class="reflex-rate-buttons">${[1,2,3,4,5].map(n => `<button type="button" aria-label="${n} star${n > 1 ? 's' : ''}" data-rating="${n}">★</button>`).join('')}</div><div class="reflex-rate-note">${note}</div>`;
    panel.querySelectorAll('button').forEach(button => button.addEventListener('click', () => window.submitRiderRating(deliveryId, Number(button.dataset.rating), button)));
    body.appendChild(panel);
  }
  async function hasAlreadyRated(deliveryId) {
    const s = session();
    try {
      const data = await api('/ratings/rider/' + (ticketRiderId(deliveryId) || '0'));
      return (data.ratings || []).some(r => Number(r.delivery_request_id) === Number(deliveryId) && r.reviewer_role === s.user.role);
    } catch { return false; }
  }
  function ticketRiderId(deliveryId) { const ticket = Array.from(document.querySelectorAll('.ticket')).find(t => getTicketDeliveryId(t) === Number(deliveryId)); const attr = ticket?.querySelector('[data-rider-id]')?.getAttribute('data-rider-id'); return attr ? Number(attr) : null; }
  function decorateRatingTickets() {
    const s = session(); if (!s.user || !['dispatcher','retailer'].includes(s.user.role)) return;
    document.querySelectorAll('.ticket').forEach(ticket => {
      if (!isDeliveredTicket(ticket)) return;
      const body = ticket.querySelector('.ticket-body'); if (!body || body.querySelector('.reflex-rate-rider')) return;
      const deliveryId = getTicketDeliveryId(ticket); if (!deliveryId) return;
      // The backend remains authoritative; the control is immediately visible for delivered tickets.
      renderRatingControl(ticket, false);
    });
  }
  window.submitRiderRating = async function (deliveryId, rating, button) {
    const panel = button.closest('.reflex-rate-rider'); if (!panel || panel.dataset.submitting === '1') return; panel.dataset.submitting = '1';
    try { const comment = window.prompt('Optional comment about the rider/delivery (leave blank to skip):', '') || ''; await api('/ratings/deliveries/' + deliveryId, { method: 'POST', body: { rating, comment } }); panel.innerHTML = `<div class="reflex-rate-success">${stars(rating)}<br><strong>Rating submitted</strong></div>`; }
    catch (e) { panel.dataset.submitting = '0'; if (/already been rated/.test(e.message)) panel.innerHTML = '<div class="reflex-rate-success"><strong>Rating already submitted</strong><br><small>You have already rated this delivered order.</small></div>'; else alert(e.message); }
  };
  function refresh() { const s = session(); if (!s.user) return; if (s.user.role === 'rider') loadRiderSummary(); if (s.user.role === 'dispatcher') loadDispatcherRiders(); if (['dispatcher','retailer'].includes(s.user.role)) decorateRatingTickets(); }
  function observe() { const app = document.getElementById('app'); if (!app) return; const observer = new MutationObserver(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { const s = session(); if (s.user?.role === 'dispatcher') { decorateRatingTickets(); decorateRiderSelectors(); } if (s.user?.role === 'retailer') decorateRatingTickets(); if (s.user?.role === 'rider') renderRiderSummary(); }, 50); }); observer.observe(app, { childList: true, subtree: true }); refresh(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe); else observe();
})();