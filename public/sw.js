/* ============================================================
   Service worker — offline, push notifikacije
   ------------------------------------------------------------
   Keširanje:
     · HTML / CSS / JS / JSON  → mreža prvo, keš kao rezerva
       (izmjene se vide odmah, offline radi zadnja poznata verzija)
     · slike i fontovi         → keš prvo (ne mijenjaju se)
   Push:
     · 'push'             → prikaz notifikacije sa ikonicom aplikacije
     · 'notificationclick'→ fokusira otvoreni tab ili otvara aplikaciju
   ============================================================ */

const VERZIJA = 'v3';
const KESH = `poruka-dana-${VERZIJA}`;

const LJUSKA = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/data/poruke.json',
  '/manifest.webmanifest',
  '/assets/brand/ammar_basic_logo_w_m_1.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(KESH)
      .then(c => c.addAll(LJUSKA))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(n => n !== KESH).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

const jeSlika = url => /\.(png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname);
const jeFont  = url => url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API nikad ne keširamo
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;

  const vanjski = url.origin !== location.origin;
  if (vanjski && !jeFont(url)) return;

  // keš prvo: slike i fontovi
  if (jeSlika(url) || jeFont(url)) {
    e.respondWith(
      caches.match(request).then(kesirano =>
        kesirano || fetch(request).then(odgovor => {
          if (odgovor.ok || odgovor.type === 'opaque') {
            const kopija = odgovor.clone();
            caches.open(KESH).then(c => c.put(request, kopija));
          }
          return odgovor;
        })
      )
    );
    return;
  }

  // mreža prvo: sve ostalo
  e.respondWith(
    fetch(request)
      .then(odgovor => {
        if (odgovor.ok) {
          const kopija = odgovor.clone();
          caches.open(KESH).then(c => c.put(request, kopija));
        }
        return odgovor;
      })
      .catch(() =>
        caches.match(request).then(kesirano =>
          kesirano || (request.mode === 'navigate' ? caches.match('/index.html') : undefined)
        )
      )
  );
});

/* ---------- PUSH ---------- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch { d = { body: e.data ? e.data.text() : '' }; }

  const naslov = d.title || 'Nova poruka dana';
  const opcije = {
    body: d.body || 'Otvori aplikaciju i pročitaj današnju poruku.',
    icon:  d.icon  || '/assets/icons/icon-192.png',
    badge: d.badge || '/assets/icons/icon-192.png',
    tag: d.tag || 'poruka-dana',
    renotify: true,
    requireInteraction: false,
    data: { url: d.url || '/' },
    actions: [{ action: 'open', title: 'Pročitaj poruku' }],
  };
  e.waitUntil(self.registration.showNotification(naslov, opcije));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const cilj = new URL(e.notification.data?.url || '/', self.location.origin).href;

  e.waitUntil((async () => {
    const lista = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const k of lista) {
      if (new URL(k.url).origin === self.location.origin) {
        await k.focus();
        if ('navigate' in k) { try { await k.navigate(cilj); } catch { /* ostaje gdje je */ } }
        return;
      }
    }
    await self.clients.openWindow(cilj);
  })());
});

/* pretplata je istekla ili je preglednik rotirao ključeve */
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const stara = e.oldSubscription;
      const nova = e.newSubscription || await self.registration.pushManager.subscribe(
        stara?.options || { userVisibleOnly: true }
      );
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nova),
      });
    } catch { /* server nije dostupan */ }
  })());
});
