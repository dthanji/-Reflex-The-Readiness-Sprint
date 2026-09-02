(() => {
  const ACCESS_KEY = 'reflex_token';
  const USER_KEY = 'reflex_user';
  const originalFetch = window.fetch.bind(window);
  let refreshPromise = null;
  let bootstrapping = false;

  function setAccess(data) {
    if (!data?.token) return false;
    localStorage.setItem(ACCESS_KEY, data.token);
    if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    return true;
  }

  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = originalFetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    }).then(async response => {
      if (!response.ok) throw new Error('Refresh failed');
      const data = await response.json();
      setAccess(data);
      return data;
    }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function fetchWithSession(input, init = {}) {
    const options = { ...init, headers: new Headers(init.headers || {}) };
    const token = localStorage.getItem(ACCESS_KEY);
    if (token && !options.headers.has('Authorization')) options.headers.set('Authorization', `Bearer ${token}`);
    if (options.method && options.method.toUpperCase() !== 'GET') options.credentials = options.credentials || 'same-origin';

    let response = await originalFetch(input, options);
    if (response.status !== 401 || !token || String(input).includes('/api/auth/refresh')) return response;

    try {
      const data = await refreshSession();
      const retry = { ...init, headers: new Headers(init.headers || {}) };
      retry.headers.set('Authorization', `Bearer ${data.token}`);
      retry.credentials = retry.credentials || 'same-origin';
      return await originalFetch(input, retry);
    } catch {
      return response;
    }
  }

  window.fetch = fetchWithSession;

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = protocols === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols);
    const originalSend = ws.send.bind(ws);
    ws.send = function(payload) {
      try {
        const message = JSON.parse(payload);
        if (message && message.type === 'authenticate') {
          const token = localStorage.getItem(ACCESS_KEY);
          if (token) message.token = token;
          payload = JSON.stringify(message);
        }
      } catch {}
      return originalSend(payload);
    };
    return ws;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

  const originalRemoveItem = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function(key) {
    if (this === localStorage && key === ACCESS_KEY) {
      originalFetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
    }
    return originalRemoveItem.call(this, key);
  };

  async function bootstrap() {
    if (bootstrapping || localStorage.getItem(ACCESS_KEY)) return;
    bootstrapping = true;
    try {
      await refreshSession();
      if (localStorage.getItem(ACCESS_KEY)) location.reload();
    } catch {}
    finally { bootstrapping = false; }
  }

  setInterval(() => { if (localStorage.getItem(ACCESS_KEY)) refreshSession().catch(() => {}); }, 20 * 60 * 1000);
  bootstrap();
})();