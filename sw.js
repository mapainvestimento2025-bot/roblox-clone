// Service Worker — Roblox Clone PWA
const CACHE = 'robloxclone-v1';
const PRECACHE = [
  '/login.html', '/register.html', '/index.html',
  '/profile.html', '/batepapo.html', '/studio.html',
  '/game.html', '/avatar.html', '/admin.html',
  '/auth.js', '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Sempre vai para a rede primeiro (dados do jogo precisam ser frescos)
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
