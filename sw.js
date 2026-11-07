// ══════════════════════════════════════════════
// Service Worker — Roblox Clone PWA v3
// Suporte a: cache offline + notificações push
// ══════════════════════════════════════════════
const CACHE = 'robloxclone-v5';
const PRECACHE = [
  '/login.html', '/register.html', '/index.html',
  '/profile.html', '/batepapo.html', '/studio.html',
  '/game.html', '/avatar.html', '/admin.html',
  '/auth.js', '/manifest.json'
];

// ── Instala e faz precache ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE).catch(() => {}))
  );
  self.skipWaiting();
});

// ── Ativa e limpa caches antigos ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: rede primeiro, fallback cache ──
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ══════════════════════════════════════════════
// NOTIFICAÇÕES DE MENSAGEM (DM)
// Recebe mensagem do página via postMessage
// { type: 'DM_NOTIFY', from, msg, icon, url }
// ══════════════════════════════════════════════
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'DM_NOTIFY') return;
  const { from, msg, icon, url, count } = e.data;

  const title = from || 'Nova mensagem';
  const body  = msg  || '...';
  const badge = '/icon-192.png';

  self.registration.showNotification(title, {
    body,
    icon:  icon  || '/icon-192.png',
    badge: badge,
    tag:   'dm-' + (from || 'chat'),          // agrupa por remetente
    renotify: true,                             // vibra mesmo se já existe
    data:  { url: url || '/batepapo.html' },
    actions: [
      { action: 'open',  title: '💬 Responder' },
      { action: 'close', title: 'Fechar' }
    ],
    vibrate: [200, 100, 200]
  }).catch(() => {});
});

// ── Clique na notificação → abre a conversa ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'close') return;

  const target = (e.notification.data && e.notification.data.url)
    || '/batepapo.html';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        // Se já tem aba do site aberta, foca e navega
        for (const c of list) {
          if (c.url.includes(self.registration.scope)) {
            c.focus();
            c.navigate(target);
            return;
          }
        }
        // Senão abre nova aba
        clients.openWindow(target);
      })
  );
});

// ── Fecha ao clicar no X ──
self.addEventListener('notificationclose', e => {
  // Pode logar analytics aqui se quiser
});
