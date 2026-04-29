// Tixly service worker — offline-first cache pro lístky.
// Cache strategy:
//   - /cs/my-tickets, /cs/order-confirmation/*: stale-while-revalidate
//   - /api/buyer/my-tickets, /api/buyer/tickets/*: network-first, cache fallback
//   - Static assets: cache-first

const CACHE_VERSION = 'tixly-v1';
const RUNTIME_CACHE = 'tixly-runtime';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(['/manifest.json']).catch(() => null),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (!url.pathname.startsWith('/')) return;

  // Network-first pro buyer ticket APIs
  if (
    url.pathname === '/api/buyer/my-tickets' ||
    url.pathname.startsWith('/api/buyer/tickets/')
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Stale-while-revalidate pro my-tickets pages
  if (url.pathname.includes('/my-tickets') || url.pathname.includes('/order-confirmation/')) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Default: network, no cache
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'OFFLINE', cached: false }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    })
    .catch(() => cached);
  return cached ?? fetchPromise;
}
