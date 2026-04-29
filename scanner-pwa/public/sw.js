// ---------------------------------------------------------------------------
// Scanner PWA Service Worker
// Cache-first for static assets, network-first for API, offline fallback.
// ---------------------------------------------------------------------------
const CACHE_NAME = 'scanner-pwa-v1';
const PRECACHE_URLS = [
  '/',
  '/scanner',
  '/manifest.webmanifest',
  '/offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the scan sync endpoint — always hit network
  if (url.pathname.startsWith('/api/scan')) {
    return;
  }

  // Network-first for other API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((r) => r || Response.error()))
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => {
        if (req.mode === 'navigate') {
          return caches.match('/offline.html');
        }
        return Response.error();
      });
    })
  );
});
