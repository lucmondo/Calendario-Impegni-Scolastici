/* sw.js — funzionamento offline, avvisi in background (dove supportato) e clic sulle notifiche. */
importScripts('js/core.js');

const CACHE = 'cis-v1';
const RUNTIME = 'cis-runtime-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/core.js', 'js/parser.js', 'js/scanner.js', 'js/ics.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/badge-96.png'
];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE && k !== RUNTIME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // librerie esterne versionate: prima la cache
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(caches.open(RUNTIME).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  // file dell'app: cache subito, aggiornamento in background
  if (url.origin === self.location.origin) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit || cache.match('index.html'));
      return hit || net;
    }));
  }
});

async function appIsVisible() {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return list.some(c => c.visibilityState === 'visible');
}

async function checkReminders() {
  if (await appIsVisible()) return; // ci pensa l'app aperta
  const settings = await Core.loadSettings();
  const events = await Core.DB.allEvents();
  const now = Date.now();
  const due = await Core.dueReminders(events, settings, now);
  for (const r of due) {
    if (r.mode === 'app') continue; // solo avviso nell'app: verrà mostrato alla prossima apertura
    await Core.DB.markFired(r.key);
    const { title, body } = Core.messageOf(r, now);
    await self.registration.showNotification(title, {
      body, tag: r.key, renotify: true,
      icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
      silent: !settings.sound,
      vibrate: settings.vibrate ? [200, 100, 200] : undefined,
      data: { eventId: r.summary ? r.eventId : r.event.id }
    });
  }
}

self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-reminders') event.waitUntil(checkReminders());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'check') event.waitUntil(checkReminders());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const eventId = event.notification.data && event.notification.data.eventId;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = list[0];
    if (client) {
      await client.focus();
      if (eventId) client.postMessage({ type: 'open-event', eventId });
      return;
    }
    await self.clients.openWindow(eventId ? `./#event=${eventId}` : './');
  })());
});
