// App shell + audio cache, so the installed app opens instantly and
// already-heard course audio keeps working offline. Live app state
// (progress/XP/settings) always goes to the network — it's the one thing
// that must never be served stale.
const CACHE_VERSION = 'khmer-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/lesson.js',
  '/data.js',
  '/api.js',
  '/styles.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // progress/placement/settings writes always hit the network

  const url = new URL(request.url);

  // TTS clips are content-addressed by text and never change once generated —
  // cache on first listen so replays (including offline) skip the network.
  if (url.pathname === '/api/tts') {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // Everything else under /api/ is live state — never intercept it.
  if (url.pathname.startsWith('/api/')) return;

  // App shell: cache-first for an instant open, refreshing the cache in the
  // background from the network so the next launch picks up new deploys.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(request, res.clone()));
          return res;
        })
    )
  );
});
