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
   Nadogradnja:
     Novi worker se NE aktivira sam (nema skipWaiting u installu) — ostaje
     u stanju „waiting“ dok aplikacija ne pokaže traku „nova verzija“ i
     korisnik ne potvrdi. Tek tada stranica pošalje {tip:'PRESKOCI_CEKANJE'}.
     Bez toga bi se kod mijenjao ispod ruke, na sredini korištenja.
   ============================================================ */

/* Dvije oznake, jer ne znače isto — i zato se traka „nova verzija“ ravna
   samo po prvoj:

     IZDANJE  pravo izdanje aplikacije. Podiže se SAMO kad korisnik dobija
              nešto novo: nove poruke, novu mogućnost, popravku. Traka se
              nudi isključivo kad se izdanje aktivnog i novog workera
              razlikuju. Mora biti isto kao VERZIJA u js/app.js.

     KESH_V   ime keša. Podiže se kad god treba isprazniti stari keš, pa i
              zbog sitnice — nove ikonice, drugog rasporeda datoteka.

   Preglednik javlja „ima novi worker“ na svaku razliku u bajtovima ove
   datoteke, i kad se promijeni samo komentar. Ranije je svaka takva sitnica
   izlazila korisniku kao „Instaliraj novu verziju“; sada se preuzme tiho,
   a pita se samo kad se IZDANJE zaista promijeni. */
const IZDANJE = '1.7.2';
const KESH_V  = 'v23';
const KESH = `poruka-dana-${KESH_V}`;
/* Broj nepročitanih poruka na ikonici. Živi u svom kešu jer worker nema
   localStorage, a mora preživjeti i zamjenu workera (vidi activate). */
const ZNACKA = 'poruka-dana-znacka';
const ZNACKA_URL = '/__znacka';

const LJUSKA = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/platno.js',
  '/data/poruke.json',
  '/manifest.webmanifest',
  '/assets/brand/ammar_basic_logo_w_m_1.png',
  '/assets/brand/ammar_basic_logo_b_m_1.png',
  '/assets/texture/texture.svg',
  '/assets/texture/divider.svg',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
];

/* Prva instalacija nema šta čekati — tu se aktiviramo odmah. Kod svake
   sljedeće (postoji stari worker koji kontroliše stranice) čekamo potvrdu. */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try {
      const c = await caches.open(KESH);
      await c.addAll(LJUSKA);
    } catch { /* offline pri instalaciji — keš se puni kroz fetch */ }

    // `registration.active` postoji samo ako neki worker već kontroliše
    // stranice; kad ga nema, ovo je prva instalacija i čekanje nema smisla
    if (!self.registration.active) await self.skipWaiting();
  })());
});

/* Stranica traži da preuzmemo kontrolu (korisnik je dodirnuo „Instaliraj“),
   ili pita koja je verzija keša — odgovor ide natrag kroz MessageChannel. */
self.addEventListener('message', e => {
  const tip = e.data?.tip;
  if (tip === 'PRESKOCI_CEKANJE') { self.skipWaiting(); return; }
  if (tip === 'VERZIJA') { e.ports?.[0]?.postMessage({ izdanje: IZDANJE, kes: KESH_V }); }
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(n => n !== KESH && n !== ZNACKA).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

const jeSlika = url => /\.(png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname);
const jeFont  = url => url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API nikad ne keširamo; ni grafike za mreže, admin i privatne plakate — nisu dio aplikacije
  if (url.origin === location.origin && /^\/(api|grafike|admin|plakat|analytics)(\/|$)/.test(url.pathname)) return;

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
    badge: d.badge || '/assets/icons/badge-96.png',
    tag: d.tag || 'poruka-dana',
    renotify: true,
    requireInteraction: false,
    data: { url: d.url || '/', kljuc: d.kljuc || null },
    actions: [{ action: 'open', title: d.akcija || 'Pročitaj poruku' }],
  };
  // prvo se prikaže; javljanje „stiglo“ ide poslije i ne može ga zakočiti
  e.waitUntil(Promise.all([self.registration.showNotification(naslov, opcije), povecajZnacku(), javi('stiglo', d.kljuc, 8000)]));
});

/* Svaka poruka koja stigne dok aplikacija nije otvorena podigne broj na
   ikonici za jedan. Aplikacija ga briše čim se otvori (js/app.js, 9b). */
async function povecajZnacku() {
  if (!('setAppBadge' in self.navigator)) return;
  try {
    const c = await caches.open(ZNACKA);
    const r = await c.match(ZNACKA_URL);
    const n = (r ? parseInt(await r.text(), 10) || 0 : 0) + 1;
    await c.put(ZNACKA_URL, new Response(String(n)));
    await self.navigator.setAppBadge(n);
  } catch { /* značka je ukras — bez nje notifikacija i dalje stiže */ }
}

/* Pregled (/analytics): uređaj javi da je obavijest stigla ili dodirnuta —
   samo vrsta i ključ obavijesti, ništa o uređaju. Ne čeka se i ne smeta: ako
   ne prođe, notifikacija i aplikacija rade isto. `rasipanje` je nasumičan
   zastoj, da dvije hiljade telefona ne javi u istoj sekundi. Lokalni razvoj
   se ne broji. */
const RAZVOJ = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname);
async function javi(vrsta, kljuc, rasipanje = 0) {
  if (!kljuc || RAZVOJ) return;
  if (rasipanje) await new Promise(r => setTimeout(r, Math.random() * rasipanje));
  try {
    await fetch('/api/analitika', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vrsta, kljuc }),         // bez keepalive: waitUntil drži worker budnim
    });
  } catch { /* pregled je dodatak */ }
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const cilj = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(javi('otvoreno', e.notification.data?.kljuc));

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
      /* Chrome ovdje često ne daje ni novu pretplatu ni opcije stare, a bez
         VAPID ključa preglednik odbije novu — zato ključ pitamo server. */
      let opcije = stara?.options;
      if (!opcije?.applicationServerKey) {
        const d = await (await fetch('/api/config', { cache: 'no-store' })).json();
        opcije = { userVisibleOnly: true, applicationServerKey: d.vapidPublicKey };
      }
      const nova = e.newSubscription || await self.registration.pushManager.subscribe(opcije);
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nova),
      });
    } catch { /* server nije dostupan */ }
  })());
});
