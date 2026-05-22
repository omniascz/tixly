// Tixly service worker — offline-first cache pro lístky.
// Cache strategy:
//   - /cs/my-tickets, /cs/order-confirmation/*: stale-while-revalidate
//   - /api/buyer/my-tickets, /api/buyer/tickets/*: network-first, cache fallback
//   - Static assets: cache-first

const CACHE_VERSION = 'tixly-v2';
const RUNTIME_CACHE = 'tixly-runtime';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(['/manifest.json', OFFLINE_URL, '/icon-192.png']).catch(() => null),
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

  // Navigations (page loads) → offline fallback při fail
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        const offline = await caches.match(OFFLINE_URL);
        return offline ?? new Response('Offline', { status: 503 });
      }),
    );
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

// ─── Web Push handlers ─────────────────────────────────────────────
// Payload format od /lib/push/web-push.ts: { title, body, url?, icon?, badge?, tag?, data? }

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Tixly', body: event.data.text() };
  }
  const opts = {
    body: payload.body,
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-72.png',
    tag: payload.tag,
    data: { url: payload.url, ...(payload.data || {}) },
  };
  event.waitUntil(self.registration.showNotification(payload.title || 'Tixly', opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.endsWith(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
