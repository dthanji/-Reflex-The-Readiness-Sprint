// UI support for the automatic STUCK_IN_TRANSIT status.
// Loaded after app.js so it can extend the existing role-specific lists
// without changing the core PWA rendering flow.
(function () {
  const originalStatusLabel = window.statusLabel;

  window.statusLabel = function (status) {
    if (status === 'STUCK_IN_TRANSIT') return 'STUCK IN TRANSIT';
    return originalStatusLabel(status);
  };

  window.renderRiderView = function () {
    const active = state.requests.filter((r) =>
      ['ASSIGNED', 'PICKED_UP', 'STUCK_IN_TRANSIT'].includes(r.current_status)
    );
    const done = state.requests.filter((r) =>
      ['DELIVERED', 'FAILED'].includes(r.current_status)
    );

    return `
      <div class="section-title">Your route <span class="count-badge">${active.length}</span></div>
      ${renderRequestList(active, '🛵', 'Nothing assigned to you yet.')}
      <div class="section-title">Completed today <span class="count-badge">${done.length}</span></div>
      ${renderRequestList(done, '📦', 'Delivered items will show here.')}
    `;
  };

  window.renderDispatcherView = function () {
    const open = state.requests.filter((r) => r.current_status === 'REQUESTED');
    const active = state.requests.filter((r) =>
      ['ASSIGNED', 'PICKED_UP', 'STUCK_IN_TRANSIT'].includes(r.current_status)
    );
    const done = state.requests.filter((r) =>
      ['DELIVERED', 'FAILED', 'CANCELLED'].includes(r.current_status)
    );

    return `
      <div class="section-title">Open <span class="count-badge">${open.length}</span></div>
      ${renderRequestList(open, '📥', 'No unassigned requests right now.')}
      <div class="section-title">In progress <span class="count-badge">${active.length}</span></div>
      ${renderRequestList(active, '🚴', 'Nothing out for delivery.')}
      <div class="section-title">Completed <span class="count-badge">${done.length}</span></div>
      ${renderRequestList(done, '✅', 'Completed deliveries appear here.')}
    `;
  };
})();
