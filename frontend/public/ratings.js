// Rider performance ratings: dispatcher rates completed deliveries; rider sees their own aggregate.
(function () {
  let riderSummary = null;
  let riderSummaries = new Map();
  let refreshTimer = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function stars(value) {
    const n = Math.round(Number(value) || 0);
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }
  function ratingText(r) { return r == null ? 'No ratings yet' : `${Number(r).toFixed(1)} / 5`; }

  async function loadRiderSummary() {
    if (!window.state?.user || state.user.role !== 'rider') return;
    try {
      riderSummary = await window.api('/ratings/rider/' + state.user.id);
      renderRiderSummary();
    } catch (e) { console.warn('[reflex] rider rating load failed:', e.message); }
  }

  async function loadDispatcherRiders() {
    if (!window.state?.user || state.user.role !== 'dispatcher') return;
    try {
      const data = await window.api('/ratings/riders');
      riderSummaries = new Map(data.riders.map(r => [Number(r.id), r]));
      decorateRiderSelectors();
    } catch (e) { console.warn('[reflex] rider rating list failed:', e.message); }
  }

  function renderRiderSummary() {
    if (!window.state?.user || state.user.role !== 'rider' || !riderSummary) return;
    const app = document.getElementById('app');
    if (!app || app.querySelector('.reflex-rider-rating-card')) return;
    const card = document.createElement('div');
    card.className = 'reflex-rider-rating-card';
    card.innerHTML = `<div><div class="reflex-rating-kicker">YOUR RIDER RATING</div><div class="reflex-rating-stars">${stars(riderSummary.average_rating)}</div><div class="reflex-rating-score">${ratingText(riderSummary.average_rating)}</div><div class="reflex-rating-count">Based on ${riderSummary.rating_count} completed delivery rating${riderSummary.rating_count === 1 ? '' : 's'}</div></div>`;
    const first = app.firstElementChild;
    if (first) app.insertBefore(card, first);
  }

  function decorateRiderSelectors() {
    if (!window.state?.user || state.user.role !== 'dispatcher') return;
    document.querySelectorAll('select').forEach(select => {
      Array.from(select.options).forEach(option => {
        const rider = riderSummaries.get(Number(option.value));
        if (!rider || option.dataset.ratingDecorated) return;
        option.dataset.ratingDecorated = '1';
        option.textContent += ` — ${rider.average_rating == null ? 'No rating' : `★ ${Number(rider.average_rating).toFixed(1)}/5`} (${rider.rating_count})`;
      });
    });
  }

  function decorateDispatcherTickets() {
    if (!window.state?.user || state.user.role !== 'dispatcher' || !Array.isArray(state.requests)) return;
    document.querySelectorAll('.ticket').forEach(ticket => {
      if (ticket.querySelector('.reflex-rate-rider')) return;
      const idEl = ticket.querySelector('.ticket-id');
      const match = idEl && idEl.textContent.match(/#(\d+)/);
      if (!match) return;
      const request = state.requests.find(r => Number(r.id) === Number(match[1]));
      if (!request || request.current_status !== 'DELIVERED' || !request.rider_id) return;
      const body = ticket.querySelector('.ticket-body');
      if (!body) return;
      const panel = document.createElement('div');
      panel.className = 'reflex-rate-rider';
      panel.innerHTML = `<div class="reflex-rate-title">Rate this rider</div><div class="reflex-rate-buttons">${[1,2,3,4,5].map(n => `<button type="button" aria-label="${n} star${n > 1 ? 's' : ''}" onclick="window.submitRiderRating(${request.id}, ${n}, this)">★</button>`).join('')}</div><div class="reflex-rate-note">One rating per delivered order.</div>`;
      body.appendChild(panel);
    });
  }

  window.submitRiderRating = async function (deliveryId, rating, button) {
    const panel = button.closest('.reflex-rate-rider');
    if (!panel || panel.dataset.submitting === '1') return;
    panel.dataset.submitting = '1';
    try {
      const comment = window.prompt('Optional comment about the rider (leave blank to skip):', '') || '';
      await window.api('/ratings/deliveries/' + deliveryId, { method: 'POST', body: { rating, comment } });
      panel.innerHTML = `<div class="reflex-rate-success">${stars(rating)}<br><strong>Rating submitted</strong></div>`;
      await loadDispatcherRiders();
    } catch (e) {
      panel.dataset.submitting = '0';
      alert(e.message);
    }
  };

  function refresh() {
    if (!window.state?.user) return;
    if (state.user.role === 'rider') loadRiderSummary();
    if (state.user.role === 'dispatcher') {
      loadDispatcherRiders();
      decorateDispatcherTickets();
    }
  }

  function observe() {
    const app = document.getElementById('app');
    if (!app) return;
    const observer = new MutationObserver(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (state.user?.role === 'dispatcher') { decorateDispatcherTickets(); decorateRiderSelectors(); }
        if (state.user?.role === 'rider') renderRiderSummary();
      }, 50);
    });
    observer.observe(app, { childList: true, subtree: true });
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe); else observe();
})();
