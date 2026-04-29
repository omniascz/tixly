// Service Worker for Tixly Gate Scanner PWA
// Strategy: Cache-First for static assets, Network-First for API calls.

const CACHE_NAME = "tixly-scanner-v1";

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
];

// ---------------------------------------------------------------------------
// Install: pre-cache static shell
// ---------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// Activate: clean up old caches
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch: route requests
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls — Network-First, fall back to nothing (caller handles offline)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: "Offline — network unavailable" }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );
    return;
  }

  // Static assets — Cache-First
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        // Only cache successful GET responses
        if (
          event.request.method === "GET" &&
          response.status === 200 &&
          response.type === "basic"
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
