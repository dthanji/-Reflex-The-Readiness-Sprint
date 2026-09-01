// Caches the app shell so the PWA still loads (and riders can still queue
// status updates locally) with no signal. It does NOT cache /api/* — API
// calls fail fast when offline and app.js catches that to queue via IndexedDB.
// Bump this whenever static workflow code changes so deployed clients pick up
// the latest JavaScript instead of retaining an older app shell.
const CACHE_NAME = 'reflex-shell-v2';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/idb-queue.js',
  '/manifest.json',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never cache API or WebSocket traffic — only the static shell.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
