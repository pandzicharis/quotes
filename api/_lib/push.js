/* Zajednička logika: VAPID, izbor poruke dana, slanje. */
import webpush from 'web-push';
import { svePoruke } from './baza.js';

const DAN_MS = 86400000;

export function vapidSpreman() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let postavljen = false;
export function postaviVapid() {
  if (postavljen) return;
  if (!vapidSpreman()) throw new Error('VAPID ključevi nisu postavljeni');
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:info@ammarbasic.ba',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  postavljen = true;
}

/** Autor i knjige su u statičnom JSON-u sa istog deploya; poruke uređuje
    admin, pa dolaze iz baze. Kad baza ne odgovara ili je tabela prazna,
    ostaje lista iz poruke.json — slanje zbog toga nikad ne staje. */
export async function ucitajPoruke(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const r = await fetch(`${proto}://${host}/data/poruke.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`poruke.json HTTP ${r.status}`);
  const podaci = await r.json();
  try {
    const aktivne = (await svePoruke()).filter(p => !p.obrisana);
    if (aktivne.length) podaci.poruke = aktivne;
  } catch { /* baza ne odgovara — lista iz poruke.json */ }
  return podaci;
}

const p2 = n => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' po kalendaru datuma `d` (na serveru UTC). */
export const kljucDana = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
/** Današnji dan u Sarajevu, 'YYYY-MM-DD'. */
export const danSarajevo = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sarajevo' }).format(d);

const brojDana = k => { const [g, m, d] = k.split('-').map(Number); return Math.floor(Date.UTC(g, m - 1, d) / DAN_MS); };

/** Poruka dana za dan `d` (Date ili 'YYYY-MM-DD') — isto pravilo u
    aplikaciji (js/app.js, porukaZa) i adminu (porukaNaDan):
      1. poruka koju je admin izabrao za taj dan, ako je još u krugu;
      2. inače krug se nastavlja od zadnjeg izabranog dana prije njega:
         dan poslije poruke X dobija poruku iza X, i tako redom;
      3. dok ništa nije izabrano — broj dana % broj poruka, kao ranije.
    `raspored` je { 'YYYY-MM-DD': id } — dovoljno je da ima dane do `d`. */
export function porukaZaDatum(podaci, d = new Date(), raspored = {}) {
  const lista = podaci.poruke, n = lista.length;
  const kljuc = typeof d === 'string' ? d : kljucDana(d);
  const mjesto = id => (id == null ? -1 : lista.findIndex(p => p.id === id));
  const i = mjesto(raspored[kljuc]);
  if (i >= 0) return lista[i];
  for (const k of Object.keys(raspored).filter(x => x < kljuc).sort().reverse()) {
    const j = mjesto(raspored[k]);
    if (j >= 0) return lista[(j + brojDana(kljuc) - brojDana(k)) % n];
  }
  return lista[((brojDana(kljuc) % n) + n) % n];
}

/** Koliko karaktera najviše ide u notifikaciju. */
export const NOTIF_MAKS = 120;

/**
 * Na telefonu se od notifikacije vidi tek red-dva, pa u nju ide samo prva
 * rečenica. Ako je i ona duža od `maks`, siječe se na granici riječi —
 * nikad usred riječi. Kad je bilo šta odsječeno, na kraj ide „…“.
 */
export function kratkaPoruka(tekst, maks = NOTIF_MAKS) {
  const cio = String(tekst || '').replace(/\s+/g, ' ').trim();
  if (!cio) return '';

  const kraj = cio.search(/[.!?][»”"']?(\s|$)/);
  let isjecak = kraj === -1 ? cio : cio.slice(0, kraj + 1);
  let skraceno = isjecak.length < cio.length;

  if (isjecak.length > maks) {
    const grubo = isjecak.slice(0, maks);
    const razmak = grubo.lastIndexOf(' ');
    isjecak = razmak > maks * 0.6 ? grubo.slice(0, razmak) : grubo;
    skraceno = true;
  }

  // cijela poruka je stala — ostavljamo je s njenom interpunkcijom
  if (!skraceno) return isjecak;
  return `${isjecak.replace(/[\s.,;:!?…„“”»«—–-]+$/, '')}…`;
}

export function napraviSadrzaj(podaci, poruka) {
  return {
    title: 'Nova poruka dana',
    body: kratkaPoruka(poruka.tekst),
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/badge-96.png',
    tag: 'poruka-dana',
    url: '/',
  };
}

/* Bez `timeout` Node čeka na visećem socketu neograničeno. Jedan zaglavljen
   push servis tako pojede cijeli budžet funkcije, pa slanje mora imati kraj. */
export const PUSH_TIMEOUT_MS = 8000;

/* Prolazne greške push servisa — vrijedi pokušati još jednom. Kod 0 je mrežni
   prekid ili istekao socket. Kodove 4xx (osim 429) ne ponavljamo: odbijeni su
   zbog sadržaja ili ključeva, drugi pokušaj bi pao isto. */
const PROLAZNO = new Set([0, 429, 500, 502, 503, 504]);

export const pauza = ms => new Promise(r => setTimeout(r, ms));

/* Koliko čekati prije sljedećeg pokušaja. Na 429 push servis često kaže
   koliko (Retry-After, u sekundama) — slušamo ga, ali ne duže od 5 s. */
function cekanje(e, i) {
  const s = Number(e.headers?.['retry-after']);
  return Number.isFinite(s) && s > 0 ? Math.min(s * 1000, 5000) : 400 * i;
}

/**
 * Šalje jednu notifikaciju, uz ponovne pokušaje na prolaznu grešku.
 * Vraća `{ ok, mrtva, prolazno, kod, greska }` — `mrtva` znači da pretplata
 * više ne postoji (404/410) i da je treba obrisati iz baze; `prolazno` da je
 * pala na grešci koja može proći, pa je vrijedi poslati još jednom kasnije.
 *
 * `urgency: 'high'` je ključno za Android: bez njega FCM poruku smatra
 * običnom, pa je telefon u štednji (Doze) zadrži satima ili je ne isporuči do
 * isteka TTL-a. Poruka uvijek prikazuje notifikaciju, pa je visoki prioritet
 * opravdan i push servis ga ne kažnjava.
 *
 * `sadrzaj` prima i gotov string, da se isti payload ne serijalizuje po uređaju.
 */
export async function posalji(pretplata, sadrzaj, pokusaja = 3) {
  const tijelo = typeof sadrzaj === 'string' ? sadrzaj : JSON.stringify(sadrzaj);
  let zadnja = { kod: 0, greska: '0 nije pokušano' };

  for (let i = 1; i <= pokusaja; i++) {
    try {
      await webpush.sendNotification(pretplata, tijelo, { TTL: 20 * 3600, urgency: 'high', timeout: PUSH_TIMEOUT_MS });
      return { ok: true, mrtva: false, kod: 201 };
    } catch (e) {
      const kod = e.statusCode || 0;
      if (kod === 404 || kod === 410) return { ok: false, mrtva: true, kod, greska: `${kod} pretplata ne postoji` };

      zadnja = { kod, greska: `${kod} ${e.message}` };
      if (!PROLAZNO.has(kod)) break;
      if (i < pokusaja) await pauza(cekanje(e, i));
    }
  }
  return { ok: false, mrtva: false, prolazno: PROLAZNO.has(zadnja.kod), ...zadnja };
}

export function citajTijelo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  return null;
}

/** Dan po UTC-u (YYYY-MM-DD) — isti ključ koji koristi brava dnevnog slanja. */
export const danUTC = (d = new Date()) => d.toISOString().slice(0, 10);

/* Bazen radnika, ne serije: u serijama cijela grupa čeka najsporiji uređaj,
   a ovako spor uređaj drži samo svoje mjesto dok ostali teku dalje. Posao je
   čekanje na mrežu, ne procesor, pa je 100 otvorenih socketa sigurno unutar
   limita deskriptora koje instanca dijeli. */
const RADNIKA = 100;

/* Prolazne greške (preopterećen push servis, prekid mreže) dobiju još jedan
   krug na kraju, kad se servis smiri — umjesto da uređaj ostane bez poruke. */
const PAUZA_PRED_KRUG_MS = 5000;

/* Uspješne isporuke se upisuju u grupama dok slanje traje, ne tek na kraju:
   ako funkcija padne usred posla, upisano ostaje i nadoknada nastavlja od
   tamo, umjesto da sve šalje ispočetka. */
const GRUPA_UPISA = 200;

/**
 * Ista obavijest na sve date pretplate: paralelno, s ponovnim pokušajima,
 * drugim krugom za prolazne greške i rokom. Kad se rok približi, nove se ne
 * uzimaju — ostatak se samo prebroji (`preskoceno`), a nadoknada ga pokupi
 * u sljedećem pozivu.
 *
 * `zabiljezi(idevi)` (neobavezno) dobija id-eve uspješno poslanih, u grupama.
 * Ako upis padne i u drugom pokušaju, slanje staje: neupisani bi obavijest
 * dobili još jednom, a baza koja ne prima upis bi tako svaki poziv crona
 * pretvorila u slanje svima. Ostatak se broji u `preskoceno` (dobije ga
 * sljedeći poziv), a `upisPao` to javlja pozivaocu.
 *
 * Vraća `{ poslano, palo, preskoceno, drugiKrug, mrtve, greske, upisPao }`;
 * `mrtve` su id-evi pretplata kojih više nema (404/410), da ih pozivalac obriše.
 */
export async function razasalji(pretplate, sadrzaj, {
  radnika = RADNIKA, rokMs = 240_000, pocetak = Date.now(), zabiljezi = null,
} = {}) {
  const tijelo = typeof sadrzaj === 'string' ? sadrzaj : JSON.stringify(sadrzaj);
  const izv = { poslano: 0, palo: 0, preskoceno: 0, drugiKrug: 0, mrtve: [], greske: {}, upisPao: false };
  let zaUpis = [];
  // dok se ponavlja upis koji je pao, radnici čekaju umjesto da šalju dalje —
  // inače bi neupisanih (pa i duplikata u sljedećem pozivu) bilo na stotine
  let zastoj = null;

  const upisi = async (sve = false) => {
    if (!zabiljezi || !zaUpis.length || (!sve && zaUpis.length < GRUPA_UPISA)) return;
    const grupa = zaUpis;
    zaUpis = [];
    try { await zabiljezi(grupa); }
    catch {
      zastoj = (async () => {
        await pauza(1000);
        try { await zabiljezi(grupa); } catch { izv.upisPao = true; }   // vidi gore — dalje se ne šalje
      })();
      await zastoj;
      zastoj = null;
    }
  };
  const zabiljeziGresku = (kod, tekst) => {
    const g = izv.greske[kod] || (izv.greske[kod] = { broj: 0, primjer: tekst });
    g.broj++;
  };

  // `ponovo` skuplja prolazne padove za drugi krug; u drugom krugu je null
  const prodji = async (lista, ponovo) => {
    let sljedeci = 0;
    const radnik = async () => {
      for (;;) {
        if (zastoj) await zastoj;
        const i = sljedeci++;
        if (i >= lista.length) return;
        if (izv.upisPao || Date.now() - pocetak > rokMs) { izv.preskoceno++; continue; }

        const sub = lista[i];
        const r = await posalji(sub, tijelo);
        if (r.ok) { izv.poslano++; zaUpis.push(sub.id); await upisi(); continue; }
        if (r.prolazno && ponovo) { ponovo.push(sub); continue; }

        izv.palo++;
        zabiljeziGresku(r.kod, r.greska);
        if (r.mrtva) izv.mrtve.push(sub.id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(radnika, lista.length) }, radnik));
  };

  const ponovo = [];
  await prodji(pretplate, ponovo);
  if (ponovo.length && izv.upisPao) {
    izv.preskoceno += ponovo.length;               // drugi krug tek kad dnevnik opet prima upis
  } else if (ponovo.length) {
    izv.drugiKrug = ponovo.length;
    await pauza(PAUZA_PRED_KRUG_MS);
    await prodji(ponovo, null);
  }
  await upisi(true);
  return izv;
}
