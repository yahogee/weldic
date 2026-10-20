/* Service worker: network-first so uploads show up immediately,
   with a cache fallback so the app still opens offline. */
const CACHE_NAME = "weldic-__BUILD_ID__";
const SHELL_FILES = [
  "./", "index.html", "css/style.css", "manifest.webmanifest",
  "js/main.js", "js/util.js", "js/data.js", "js/search.js", "js/render.js",
  "data/manifest.json", "data/cards.json",
];

// Pre-cache the app shell on install.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

// Remove caches from older builds.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Try the network first, store a copy, and fall back to the cache when offline.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
