// Caches the app shell so the PWA still loads (and riders can still queue
// status updates locally) with no signal. It does NOT cache /api/* — API
// calls fail fast when offline and app.js catches that to queue via IndexedDB.
const CACHE_NAME = 'reflex-shell-v4';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/retailer-tracking.css',
  '/ratings.css',
  '/app.js',
  '/idb-queue.js',
  '/stuck-status.js',
  '/role-enhancements.js',
  '/retailer-tracking.js',
  '/delivery-code.js',
  '/ratings.js',
  '/manifest.json',
  '/icon.svg',
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
