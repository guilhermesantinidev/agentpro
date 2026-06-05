const CACHE_NAME = 'agentpro-v1';
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  'https://cdn-icons-png.flaticon.com/512/8943/8943377.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});