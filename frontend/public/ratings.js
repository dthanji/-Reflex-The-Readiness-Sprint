// Rider performance ratings and delivery rating controls.
(function () {
  let riderSummary = null;
  let riderSummaries = new Map();
  let ratedByRider = new Map();
  let refreshTimer = null;

  function session() {
    try { return { user: JSON.parse(localStorage.getItem('reflex_user') || 'null'), token: localStorage.getItem('reflex_token') || '' }; }
    catch (e) { return { user: null, token: '' }; }
  }

  async function api(path, options = {}) {
    const s = session();
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (s.token) headers.Authorization = `Bearer ${s.token}`;
    const res = await fetch('/api' + path, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function stars(value) {
    const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  function ratingText(r) { return r == null ? 'No ratings yet' : `${Number(r).toFixed(1)} / 5`; }

  async function loadRiderSummary() {
    const s = session();
    if (!s.user || s.user.role !== 'rider') return;
    try { riderSummary = await api('/ratings/rider/' + s.user.id); renderRiderSummary(); }
    catch (e) { console.warn('[reflex] rider summary load failed:', e.message); }
  }

  async function loadDispatcherRiders() {
    const s = session();
    if (!s.user || s.user.role !== 'dispatcher') return;
    try {
      const data = await api('/ratings/riders');
      riderSummaries = new Map(data.riders.map(r => [Number(r.id), r]));
      decorateRiderSelectors();
    } catch (e) { console.warn('[reflex] rider rating list failed:', e.message); }
  }

  function renderRiderSummary() {
    const s = session();
    if (!s.user || s.user.role !== 'rider' || !riderSummary) return;
    const app = document.getElementById('app');
    if (!app) return;
    const existing = app.querySelector('.reflex-rider-rating-card');
    if (existing) existing.remove();
    const r = riderSummary;
    const card = document.createElement('div');
    card.className = 'reflex-rider-rating-card';
    card.innerHTML = `<div class="reflex-rider-summary-main"><div class="reflex-rating-kicker">YOUR PERFORMANCE</div><div class="reflex-rating-stars">${stars(r.average_rating)}</div><div class="reflex-rating-score">${ratingText(r.average_rating)}</div><div class="reflex-rating-count">${r.rating_count} rating${r.rating_count === 1 ? '' : 's'}</div></div><div class="reflex-rider-stat-grid"><div><strong>${r.deliveries_completed || 0}</strong><span>Delivered</span></div><div><strong>${r.deliveries_assigned || 0}</strong><span>Assigned</span></div><div><strong>${r.deliveries_failed || 0}</strong><span>Failed</span></div><div><strong>${r.rating_count || 0}</strong><span>Ratings</span></div></div>`;
    const first = app.firstElementChild;
    if (first) app.insertBefore(card, first);
  }

  function decorateRiderSelectors() {
    const s = session();
    if (!s.user || s.user.role !== 'dispatcher') return;
    document.querySelectorAll('select').forEach(select => {
      Array.from(select.options).forEach(option => {
        const rider = riderSummaries.get(Number(option.value));
        if (!rider || option.dataset.ratingDecorated) return;
        option.dataset.ratingDecorated = '1';
        option.textContent += ` — ${rider.average_rating == null ? 'No rating' : `★ ${Number(rider.average_rating).toFixed(1)}/5`} (${rider.rating_count})`;
      });
    });
  }

  function getTicketDeliveryId(ticket) {
    const idEl = ticket.querySelector('.ticket-id');
    const match = idEl && idEl.textContent.match(/#(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function getTicketRiderId(ticket) {
    const id = ticket?.dataset?.riderId;
    return id ? Number(id) : null;
  }

  function isDeliveredTicket(ticket) {
    const statusEl = ticket.querySelector('.ticket-status');
    return Boolean(statusEl && (statusEl.classList.contains('status-DELIVERED') || statusEl.textContent.trim() === 'DELIVERED'));
  }

  async function loadRatedSet(riderId) {
    const s = session();
    if (!riderId || !s.user || !['dispatcher', 'retailer'].includes(s.user.role)) return new Set();
    const key = `${s.user.role}:${riderId}`;
    if (ratedByRider.has(key)) return ratedByRider.get(key);
    const set = new Set();
    try {
      const data = await api('/ratings/rider/' + riderId);
      (data.ratings || []).forEach(r => {
        if (r.reviewer_role === s.user.role) set.add(Number(r.delivery_request_id));
      });
    } catch (e) { console.warn('[reflex] rating state load failed:', e.message); }
    ratedByRider.set(key, set);
    return set;
  }

  function renderRatingControl(ticket, rated) {
    const s = session();
    if (!s.user || !['dispatcher', 'retailer'].includes(s.user.role)) return;
    const body = ticket.querySelector('.ticket-body');
    const deliveryId = getTicketDeliveryId(ticket);
    if (!body || !deliveryId) return;
    const old = body.querySelector('.reflex-rate-rider');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.className = 'reflex-rate-rider';
    panel.dataset.deliveryId = String(deliveryId);

    if (rated) {
      panel.classList.add('is-rated');
      panel.innerHTML = '<div class="reflex-rate-success"><span class="reflex-rate-check">✓</span><div><strong>Rating submitted</strong><small>Your feedback has been recorded.</small></div></div>';
      body.appendChild(panel);
      return;
    }

    const label = s.user.role === 'retailer' ? 'How was this delivery?' : 'Rate this rider';
    const note = s.user.role === 'retailer' ? 'Your feedback helps improve the delivery experience.' : 'Your rider rating is recorded against this delivery.';
    panel.innerHTML = `<div class="reflex-rate-title">${label}</div><div class="reflex-rate-subtitle">Tap a star to rate</div><div class="reflex-rate-buttons" role="group" aria-label="Choose a rating">${[1,2,3,4,5].map(n => `<button type="button" aria-label="${n} star${n > 1 ? 's' : ''}" data-rating="${n}">★</button>`).join('')}</div><textarea class="reflex-rate-comment" maxlength="500" placeholder="Optional comment"></textarea><div class="reflex-rate-footer"><span class="reflex-rate-note">${note}</span><button type="button" class="reflex-rate-submit" disabled>Submit rating</button></div>`;

    const buttons = Array.from(panel.querySelectorAll('.reflex-rate-buttons button'));
    const submit = panel.querySelector('.reflex-rate-submit');
    const comment = panel.querySelector('.reflex-rate-comment');
    let selected = 0;

    buttons.forEach(button => button.addEventListener('click', () => {
      selected = Number(button.dataset.rating);
      buttons.forEach(b => b.classList.toggle('selected', Number(b.dataset.rating) <= selected));
      submit.disabled = false;
      panel.querySelector('.reflex-rate-subtitle').textContent = `${selected} out of 5 — ${['','Needs improvement','Could be better','Good','Very good','Excellent'][selected]}`;
    }));

    submit.addEventListener('click', () => window.submitRiderRating(deliveryId, selected, submit, comment?.value || ''));
    body.appendChild(panel);
  }

  async function decorateRatingTickets() {
    const s = session();
    if (!s.user || !['dispatcher', 'retailer'].includes(s.user.role)) return;
    const tickets = Array.from(document.querySelectorAll('.ticket')).filter(isDeliveredTicket);
    await Promise.all(tickets.map(async ticket => {
      const body = ticket.querySelector('.ticket-body');
      const deliveryId = getTicketDeliveryId(ticket);
      const riderId = getTicketRiderId(ticket);
      if (!body || !deliveryId || !riderId || body.querySelector('.reflex-rate-rider')) return;
      const ratedSet = await loadRatedSet(riderId);
      if (!document.body.contains(ticket)) return;
      renderRatingControl(ticket, ratedSet.has(deliveryId));
    }));
  }

  window.submitRiderRating = async function (deliveryId, rating, button, commentText) {
    const panel = button.closest('.reflex-rate-rider');
    if (!panel || panel.dataset.submitting === '1' || !Number.isInteger(rating) || rating < 1 || rating > 5) return;
    panel.dataset.submitting = '1';
    button.disabled = true;
    button.textContent = 'Submitting…';
    try {
      const data = await api('/ratings/deliveries/' + deliveryId, { method: 'POST', body: { rating, comment: String(commentText || '').trim() } });
      panel.classList.add('is-rated');
      panel.innerHTML = `<div class="reflex-rate-success"><span class="reflex-rate-check">✓</span><div><strong>Thank you for your feedback</strong><small>${stars(data.rating?.rating || rating)} · Rating submitted</small></div></div>`;
      const s = session();
      const ticket = panel.closest('.ticket');
      const riderId = getTicketRiderId(ticket);
      if (riderId) {
        const key = `${s.user.role}:${riderId}`;
        const set = ratedByRider.get(key) || new Set();
        set.add(Number(deliveryId));
        ratedByRider.set(key, set);
      }
    } catch (e) {
      panel.dataset.submitting = '0';
      button.disabled = false;
      button.textContent = 'Submit rating';
      if (/already been rated/.test(e.message)) {
        panel.classList.add('is-rated');
        panel.innerHTML = '<div class="reflex-rate-success"><span class="reflex-rate-check">✓</span><div><strong>Rating already submitted</strong><small>Your feedback for this delivery is already on file.</small></div></div>';
      } else alert(e.message);
    }
  };

  function refresh() {
    const s = session();
    if (!s.user) return;
    if (s.user.role === 'rider') loadRiderSummary();
    if (s.user.role === 'dispatcher') loadDispatcherRiders();
    if (['dispatcher', 'retailer'].includes(s.user.role)) decorateRatingTickets();
  }

  function observe() {
    const app = document.getElementById('app');
    if (!app) return;
    const observer = new MutationObserver(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        const s = session();
        if (s.user?.role === 'dispatcher') { decorateRatingTickets(); decorateRiderSelectors(); }
        if (s.user?.role === 'retailer') decorateRatingTickets();
        if (s.user?.role === 'rider') renderRiderSummary();
      }, 50);
    });
    observer.observe(app, { childList: true, subtree: true });
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe); else observe();
})();