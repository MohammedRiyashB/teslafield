// The legacy teslafield-pwa-shell-v14 and v15 caches are removed by activation cleanup below.
const CACHE_NAME = "teslafield-pwa-shell-v20";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css?v=20261127-19",
  "/app.js?v=20261127-19",
  "/theme-init.js?v=20261127-19",
  "/manifest.webmanifest",
  "/teslafield-icon-192.png",
  "/teslafield-icon-512.png",
  "/teslafield-pwa-icon.svg",
  "/teslafieldai-logo.png",
  "/terms.html",
  "/privacy.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("teslafield-pwa-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/index.html")) || Response.error())
    );
    return;
  }

  if (/\.(?:js|css|png|svg|webmanifest|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});

// Offline support is limited to the app shell; sign-in, chat and AI requests require a connection.
