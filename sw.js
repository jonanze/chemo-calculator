// Offline cache. Bump VERSION on every release so clients pick up changes.
const VERSION = 'cc-v78';
const FILES = [
  './', 'index.html', 'style.css', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon-180.png', 'manifest.webmanifest',
  'js/app.js', 'js/engine.js', 'js/holidays.js', 'js/defaults.js', 'js/doses.js', 'js/doses-ui.js', 'js/theme.js', 'js/clip.js',
  'js/regimens.js', 'js/picker.js',
  'fonts/inter.woff2', 'fonts/montserrat-700.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first, cache as fallback, so updates show up as soon as they are online.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Keep only good same-origin responses, so an error page is never served offline
        if (res.ok && new URL(e.request.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
