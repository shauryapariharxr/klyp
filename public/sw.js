/**
 * klyp service worker — root scope. Presence alone is what lets Chromium show
 * its install control in the address bar; the caching rules below choose what
 * to keep for offline use.
 *
 * Rules, deliberately conservative for an app that moves files:
 *   - never touch /api/** or any non-GET request (live traffic stays live)
 *   - cache-first for hash-busted static assets (immutable, safe to keep)
 *   - network-first for page navigations, falling back to the last good page
 *     when the network is down
 *
 * Bump VERSION whenever public/ icon or manifest content changes so clients
 * drop their stale asset cache.
 */
const VERSION = "v1";
const ASSET_CACHE = `klyp-static-${VERSION}`;
const PAGE_CACHE = "klyp-pages";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== ASSET_CACHE && n !== PAGE_CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Live traffic stays live: API calls and anything that isn't a plain GET
  // (uploads, downloads, presigned URLs, POST syncs/signals) go to the network.
  if (request.method !== "GET") return;
  if (new URL(request.url).pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(PAGE_CACHE);
          cache.put(request, response.clone());
          return response;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(
            "<!doctype html><meta charset='utf-8'><title>Klyp — offline</title>" +
              "<body style=\"background:#020617;color:#f8fafc;font-family:system-ui;" +
              "display:grid;place-items:center;height:100vh;margin:0\">" +
              "<p>You appear to be offline.</p></body>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
    return;
  }

  // Hash-busted, immutable build output — cache first, hold forever.
  const isHashedAsset =
    new URL(request.url).pathname.startsWith("/_next/static/") ||
    /\.[0-9a-f]{8,}\.(?:js|css|woff2?|png|svg)$/.test(
      new URL(request.url).pathname,
    );

  if (!isHashedAsset) {
    return; // everything else passes through untouched
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(ASSET_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
