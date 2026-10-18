// ============================================
// Marketa Service Worker
// Caches the app shell so it opens fast and works offline.
// ============================================

const CACHE_NAME = "marketa-v0140";

// Files to pre-cache when the service worker installs
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icon.png"
];

// ---- Install: pre-cache the app shell ----
self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_URLS).catch(function(err) {
        console.warn("Pre-cache warning:", err);
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ---- Activate: clean up old caches ----
self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(key) {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ---- Fetch: serve from cache first, fall back to network ----
self.addEventListener("fetch", function(event) {
  // Only handle GET requests, and skip Firebase / cross-origin requests
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) {
        // Serve from cache, then refresh in background
        fetch(event.request).then(function(response) {
          if (response && response.status === 200 && response.type === "basic") {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, response.clone());
            });
          }
        }).catch(function() { /* offline — ignore */ });
        return cached;
      }
      // Not cached — fetch from network
      return fetch(event.request).then(function(response) {
        // Cache successful same-origin responses
        if (response && response.status === 200 && response.type === "basic") {
          const respClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, respClone);
          });
        }
        return response;
      }).catch(function() {
        // Offline + not cached: if it's a page request, serve index.html
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    })
  );
});