// Delivery-code UX: keep manual entry consistent with the server-generated code
// and make the code visible to the retailer so it can be shared with the customer.
(function () {
  let timer = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function normalizeManualCode() {
    const input = document.getElementById('manual-qr-input');
    if (!input) return;
    input.autocapitalize = 'characters';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'RFX-XXXXXXXX';
    const normalized = input.value.toUpperCase().replace(/\s+/g, '');
    if (input.value !== normalized) input.value = normalized;
  }

  function decorateRetailerCodes() {
    if (!window.state || !state.user || state.user.role !== 'retailer' || !Array.isArray(state.requests)) return;
    document.querySelectorAll('.ticket').forEach(ticket => {
      if (ticket.querySelector('.reflex-delivery-code')) return;
      const idEl = ticket.querySelector('.ticket-id');
      const match = idEl && idEl.textContent.match(/#(\d+)/);
      if (!match) return;
      const request = state.requests.find(r => Number(r.id) === Number(match[1]));
      if (!request || !request.delivery_code) return;
      const block = document.createElement('div');
      block.className = 'reflex-delivery-code';
      block.innerHTML = `<strong>Customer delivery code</strong><span>${escapeHtml(request.delivery_code)}</span><small>Share this code with the customer for delivery confirmation.</small>`;
      const body = ticket.querySelector('.ticket-body');
      if (body) body.insertBefore(block, body.firstChild);
    });
  }

  function observe() {
    const app = document.getElementById('app');
    if (!app) return;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        normalizeManualCode();
        decorateRetailerCodes();
      }, 0);
    });
    observer.observe(app, { childList: true, subtree: true });
    normalizeManualCode();
    decorateRetailerCodes();
  }

  document.addEventListener('input', event => {
    if (event.target && event.target.id === 'manual-qr-input') normalizeManualCode();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe);
  else observe();
})();
