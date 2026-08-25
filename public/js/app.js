/* ============================================================
   PORUKA DANA — aplikacija
   ------------------------------------------------------------
   1 Konstante · 2 Helperi · 3 Datum · 4 Stanje · 5 Podaci
   6 Kartica · 7 Dani + swipe · 8 Akcije · 9 Sačuvano
   10 Tema · 11 Notifikacije · 12 Knjige · 13 Dijeljenje
   14 Modali · 15 Toast · 16 Uvod · 17 Start
   ============================================================ */

const VERZIJA = '1.1.0';

/* ---------- 1. KONSTANTE ---------- */
const DAN_MS = 86400000;

const DANI = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];
const MJESECI = ['januar', 'februar', 'mart', 'april', 'maj', 'juni',
                 'juli', 'august', 'septembar', 'oktobar', 'novembar', 'decembar'];
const MJESECI_KRATKO = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
const HIDZRI_MJESECI = ['muharrem', 'safer', 'rebiu-l-evvel', 'rebiu-l-ahir', 'džumade-l-ula', 'džumade-l-uhra',
                        'redžeb', "ša'ban", 'ramazan', 'ševval', "zu-l-ka'de", 'zu-l-hidždže'];

const SERIF = '"EB Garamond", Georgia, serif';
const DISPLAY = '"Playfair Display", Georgia, serif';
const SANS  = '"Mulish", system-ui, sans-serif';

const FORMATI = [
  { id: 'prica',   naziv: 'Priča',   opis: '9:16', w: 1080, h: 1920 },
  { id: 'objava',  naziv: 'Objava',  opis: '4:5',  w: 1080, h: 1350 },
  { id: 'kvadrat', naziv: 'Kvadrat', opis: '1:1',  w: 1080, h: 1080 },
];

const STILOVI = [
  { id: 'zelena', naziv: 'Zelena', bg: ['#204234', '#0D1C15'], ink: '#F6EFDF', gold: '#E3C489', navod: '#E9C77E', logo: 'w' },
  { id: 'krem',   naziv: 'Krem',   bg: ['#F7F1E2', '#E6D9BC'], ink: '#162C21', gold: '#8E6C28', navod: '#A8813A', logo: 'b' },
];

const UVOD_KORACI = [
  { id: 'pocetak', n: 'Poruka dana',
    t: 'Svaki dan po jedna poruka iz knjiga hafiza Ammara Bašića. Sačuvaj onu koja te dotakne i podijeli je s drugima.' },
  { id: 'tema', n: 'Odaberi izgled',
    t: 'Noć, papir ili prema postavkama tvog telefona. Uvijek se može promijeniti u postavkama.' },
  { id: 'notif', n: 'Dnevni podsjetnik',
    t: 'Da te poruka nađe svaki dan u isto vrijeme, potrebna je dozvola za notifikacije.' },
  { id: 'instal', n: 'Dodaj na početni ekran',
    t: 'Instaliraj aplikaciju da se otvara u svom prozoru i da podsjetnik radi pouzdano.' },
];

const TEME = [
  { id: 'auto',     ime: 'Sistem',  boje: 'linear-gradient(135deg,#F7F1E2 0 50%,#0F1E16 50% 100%)' },
  { id: 'svijetla', ime: 'Dnevna',  boje: 'linear-gradient(160deg,#FDFBF6,#E8DFCB)' },
  { id: 'tamna',    ime: 'Noćna',   boje: 'linear-gradient(160deg,#163023,#0A140E)' },
];

const LS = {
  sacuvano: 'pd.sacuvano',
  autoTema: 'pd.autoTema',
  tema:     'pd.tema',
  notif:    'pd.notif',
  stil:     'pd.stil',
  format:   'pd.format',
  uvod:     'pd.uvod',
};

/* ---------- 2. HELPERI ---------- */
const $  = (s, k = document) => k.querySelector(s);
const $$ = (s, k = document) => [...k.querySelectorAll(s)];
const p2 = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ikona = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const cita = (k, zadano) => { try { return JSON.parse(localStorage.getItem(k)) ?? zadano; } catch { return zadano; } };
const pisi = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

/* ---------- 3. DATUM ---------- */
const danasnji = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const kljuc    = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const izKljuca = s => { const [g, m, d] = s.split('-').map(Number); return new Date(g, m - 1, d); };
const brojDana = d => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAN_MS);
const istiDan  = (a, b) => kljuc(a) === kljuc(b);

const naziviDana  = d => DANI[d.getDay()];
const punDatum    = d => `${d.getDate()}. ${MJESECI[d.getMonth()]} ${d.getFullYear()}.`;
const kratkiDatum = d => `${d.getDate()}. ${MJESECI_KRATKO[d.getMonth()]} ${d.getFullYear()}.`;

/** „juče“, „prije 4 dana“, „prije 3 mjeseca“ */
function relativno(d) {
  const n = brojDana(danasnji()) - brojDana(d);
  if (n <= 0) return '';
  if (n === 1) return 'juče';
  if (n === 2) return 'prekjuče';
  if (n < 7) return `prije ${n} dana`;
  if (n < 14) return 'prije nedjelju dana';
  if (n < 31) return `prije ${Math.round(n / 7)} nedjelje`;
  if (n < 365) {
    const m = Math.round(n / 30);
    return `prije ${m} ${m === 1 ? 'mjesec' : m < 5 ? 'mjeseca' : 'mjeseci'}`;
  }
  const g = Math.round(n / 365);
  return `prije ${g} ${g === 1 ? 'godinu' : g < 5 ? 'godine' : 'godina'}`;
}

const hidzriFmt = (() => {
  for (const cal of ['islamic-umalqura', 'islamic-civil', 'islamic']) {
    try {
      const f = new Intl.DateTimeFormat(`en-u-ca-${cal}`, { day: 'numeric', month: 'numeric', year: 'numeric' });
      if (f.resolvedOptions().calendar.startsWith('islamic')) return f;
    } catch { /* dalje */ }
  }
  return null;
})();

function hidzri(d) {
  if (!hidzriFmt) return '';
  try {
    const p = Object.fromEntries(hidzriFmt.formatToParts(d).map(x => [x.type, x.value]));
    const mj = HIDZRI_MJESECI[Number(p.month) - 1];
    return mj ? `${Number(p.day)}. ${mj} ${Number(p.year)}. h.` : '';
  } catch { return ''; }
}

/* ---------- 4. STANJE ---------- */

/**
 * Sačuvane poruke se drže kao [{d: 'YYYY-MM-DD', id}].
 * Stariji zapisi (goli string, bez id-a, duplikati) se ovdje čiste — inače
 * findIndex nikad ne pronađe zapis, pa se isti dan dodaje više puta i lista
 * izgleda kao da je sve označeno.
 */
function normalizujSacuvano(sirovo) {
  if (!Array.isArray(sirovo)) return [];
  const vidjeni = new Set();
  const cisto = [];
  for (const zapis of sirovo) {
    const d = typeof zapis === 'string' ? zapis : zapis?.d;
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (vidjeni.has(d)) continue;
    vidjeni.add(d);
    const id = Number(zapis?.id);
    cisto.push({ d, id: Number.isFinite(id) ? id : null });
  }
  return cisto;
}

const stanje = {
  podaci:   null,
  datum:    danasnji(),
  stranica: 'danas',
  sacuvano: normalizujSacuvano(cita(LS.sacuvano, [])),
  autoTema: cita(LS.autoTema, false),
  tema:     cita(LS.tema, 'tamna'),
  notif:    cita(LS.notif, false),
  stil:     cita(LS.stil, 'zelena'),
  format:   cita(LS.format, 'objava'),
  detalj:   null,                     // datum poruke otvorene u modalu
};

// stil iz starije verzije (npr. „noć“, „zlato“) više ne postoji
if (!STILOVI.some(x => x.id === stanje.stil)) stanje.stil = 'zelena';
if (!FORMATI.some(x => x.id === stanje.format)) stanje.format = 'objava';

/* ---------- 5. PODACI ---------- */
async function ucitajPodatke() {
  const r = await fetch('/data/poruke.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Podaci nisu dostupni (HTTP ${r.status})`);
  const d = await r.json();
  if (!Array.isArray(d.poruke) || !d.poruke.length) throw new Error('Lista poruka je prazna');
  return d;
}

const knjigaPo = id => stanje.podaci.knjige.find(k => k.id === id) || null;
const porukaPo = id => stanje.podaci.poruke.find(p => p.id === id) || null;

/** Poruka je vezana za datum: isti dan uvijek daje istu poruku. */
function porukaZa(d) {
  const n = stanje.podaci.poruke.length;
  return stanje.podaci.poruke[((brojDana(d) % n) + n) % n];
}

/* ---------- 6. KARTICA ---------- */
const el = {};

function prikaziDan(animiraj = true) {
  const d = stanje.datum;
  const p = porukaZa(d);
  const k = knjigaPo(p.knjiga);
  const jeDanas = istiDan(d, danasnji());

  el.dan.textContent    = jeDanas ? 'danas' : (relativno(d) || naziviDana(d));
  el.datum.textContent  = punDatum(d);
  el.hidzri.textContent = hidzri(d);

  if (animiraj) upisiRijeci(el.tekst, p.tekst);
  else el.tekst.textContent = p.tekst;

  el.knjiga.textContent = k ? k.naslov : '';
  el.tema.textContent   = p.poglavlje || p.tema || '';
  // duže poruke traže manji stupac teksta — CSS reaguje na ovaj atribut
  el.karta.dataset.duzina = p.tekst.length > 380 ? 'dugo'
                          : p.tekst.length > 240 ? 'srednje' : 'kratko';
  el.izvor.href = k?.url || stanje.podaci.autor.knjige_url;
  if (k) { el.cover.src = `/assets/books/${k.slika}`; el.cover.alt = k.naslov; el.cover.hidden = false; }
  else el.cover.hidden = true;

  // pokazivač prevlačenja unutar kartice
  el.karta.dataset.stari = jeDanas ? '0' : '1';
  el.svajpTekst.hidden   = !jeDanas;
  el.danDanas.hidden     = jeDanas;
  el.danPoslije.disabled = jeDanas;

  zakaziMjerenje();
  osvjeziFav();
}

/**
 * Navodnici prate stvarni početak i kraj citata.
 * Tekst je centriran, pa se prvi i zadnji red mjere kroz Range: prvi
 * pravougaonik daje gornji-lijevi ugao prve riječi, zadnji daje donji-desni
 * ugao zadnje. CSS transform ih odatle odmakne izvan redova.
 */
let mjerenjeZakazano = false;

function pozicionirajNavodnike() {
  mjerenjeZakazano = false;
  if (!el.citat || !el.tekst.firstChild) return;

  let pravougaonici;
  try {
    const opseg = document.createRange();
    opseg.selectNodeContents(el.tekst);
    pravougaonici = [...opseg.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
  } catch { return; }
  if (!pravougaonici.length) return;

  const baza = el.citat.getBoundingClientRect();
  const prvi = pravougaonici[0];
  const zadnji = pravougaonici[pravougaonici.length - 1];

  el.navodO.style.left = `${prvi.left - baza.left}px`;
  el.navodO.style.top  = `${prvi.top - baza.top}px`;
  el.navodZ.style.left = `${zadnji.right - baza.left}px`;
  el.navodZ.style.top  = `${zadnji.bottom - baza.top}px`;

  el.citat.dataset.spremno = '1';
}

/** Više poziva u istom frameu se sabiju u jedno mjerenje. */
function zakaziMjerenje() {
  if (mjerenjeZakazano) return;
  mjerenjeZakazano = true;
  requestAnimationFrame(pozicionirajNavodnike);
}

/** Tekst se ispisuje riječ po riječ, sa blagim kaskadnim odgodom. */
function upisiRijeci(cilj, tekst) {
  cilj.classList.remove('reveal');
  cilj.innerHTML = tekst.split(/\s+/)
    .map((r, i) => `<span class="w" style="animation-delay:${i * 32 + 110}ms">${esc(r)}</span>`)
    .join(' ');
  requestAnimationFrame(() => cilj.classList.add('reveal'));
}

/* ---------- 7. DANI + SWIPE ---------- */
function pomjeriDan(korak) {
  const novi = new Date(stanje.datum);
  novi.setDate(novi.getDate() + korak);
  if (novi > danasnji()) return;
  stanje.datum = novi;
  prikaziDan();
}

function naDanas() {
  stanje.datum = danasnji();
  prikaziDan();
}

/** Vodoravno prevlačenje: desno = raniji dan, lijevo = kasniji. */
function postaviSwipe(karta) {
  let x0 = 0, y0 = 0, dx = 0, vuce = false, aktivan = false;

  karta.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    dx = 0; vuce = false; aktivan = true;
    karta.classList.remove('klizi');
  }, { passive: true });

  karta.addEventListener('touchmove', e => {
    if (!aktivan) return;
    const x = e.touches[0].clientX - x0;
    const y = e.touches[0].clientY - y0;
    if (!vuce) {
      if (Math.abs(y) > Math.abs(x)) { aktivan = false; return; }
      if (Math.abs(x) < 10) return;
      vuce = true;
    }
    const dozvoljeno = x > 0 || !istiDan(stanje.datum, danasnji());
    dx = dozvoljeno ? x : x * 0.22;
    karta.style.transform = `translateX(${dx}px)`;
    karta.style.opacity = String(1 - Math.min(Math.abs(dx) / 640, 0.3));
  }, { passive: true });

  const kraj = () => {
    if (!aktivan) return;
    aktivan = false;
    karta.classList.add('klizi');
    karta.style.transform = '';
    karta.style.opacity = '';
    if (Math.abs(dx) > 60) pomjeriDan(dx > 0 ? -1 : 1);
    dx = 0;
  };
  karta.addEventListener('touchend', kraj, { passive: true });
  karta.addEventListener('touchcancel', kraj, { passive: true });
}

/* ---------- 8. AKCIJE ---------- */
const nadjiSacuvano = d => stanje.sacuvano.findIndex(s => s.d === kljuc(d));

function osvjeziFav() {
  const ima = nadjiSacuvano(stanje.datum) !== -1;
  el.fav.setAttribute('aria-pressed', String(ima));
  $('use', el.fav).setAttribute('href', ima ? '#i-zvijezda-f' : '#i-zvijezda');
  el.favTekst.textContent = ima ? 'Sačuvano' : 'Sačuvaj';
}

function prebaciFav() {
  const k = kljuc(stanje.datum);
  const i = nadjiSacuvano(stanje.datum);
  if (i === -1) {
    stanje.sacuvano = stanje.sacuvano.filter(s => s.d !== k);   // sigurnosno, bez duplikata
    stanje.sacuvano.unshift({ d: k, id: porukaZa(stanje.datum).id });
    el.fav.classList.add('pulse');
    setTimeout(() => el.fav.classList.remove('pulse'), 520);
    iskre(el.fav);
    poruka('Sačuvano u tvoju zbirku', 'i-zvijezda-f');
  } else {
    stanje.sacuvano.splice(i, 1);
    poruka('Uklonjeno iz zbirke', 'i-x');
  }
  pisi(LS.sacuvano, stanje.sacuvano);
  osvjeziFav();
  crtajSacuvano();
  osvjeziBrojSacuvanih();
}

/** Kratki bljesak čestica oko dugmeta. */
function iskre(dugme) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = dugme.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < 9; i++) {
    const t = document.createElement('i');
    t.className = 'iskra';
    t.style.left = `${cx}px`; t.style.top = `${cy}px`;
    document.body.appendChild(t);
    const ugao = (Math.PI * 2 * i) / 9, dist = 22 + Math.random() * 22;
    t.animate(
      [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
       { transform: `translate(${Math.cos(ugao) * dist - 50}%, ${Math.sin(ugao) * dist - 50}%) scale(0)`, opacity: 0 }],
      { duration: 540, easing: 'cubic-bezier(.22,1,.36,1)' }
    ).onfinish = () => t.remove();
  }
}

function tekstZaDijeljenje(d = stanje.datum) {
  const p = porukaZa(d), k = knjigaPo(p.knjiga);
  const izvor = [k?.naslov, p.poglavlje || p.tema].filter(Boolean).join(' · ');
  return `\u201C${p.tekst}\u201D\n\n— ${izvor}\n${stanje.podaci.autor.ime}\n${kratkiDatum(d)}`;
}

async function kopirajTekst() {
  const t = tekstZaDijeljenje();
  try {
    await navigator.clipboard.writeText(t);
    poruka('Poruka kopirana', 'i-kopiraj');
  } catch {
    const p = document.createElement('textarea');
    p.value = t; p.style.position = 'fixed'; p.style.opacity = '0';
    document.body.appendChild(p); p.select();
    const ok = document.execCommand?.('copy');
    p.remove();
    poruka(ok ? 'Poruka kopirana' : 'Kopiranje nije uspjelo', ok ? 'i-kopiraj' : 'i-info');
  }
}

/* ---------- 9. SAČUVANO ---------- */
const brojTekst = n => n
  ? `${n} ${n === 1 ? 'poruka' : n < 5 ? 'poruke' : 'poruka'}`
  : 'Nema sačuvanih';

function osvjeziBrojSacuvanih() {
  const n = stanje.sacuvano.length;
  el.brojSac.hidden = n === 0;
  el.brojSac.textContent = n > 99 ? '99+' : String(n);
  el.btnSacuvano.title = n ? `Sačuvane poruke — ${brojTekst(n)}` : 'Sačuvane poruke';
  if (stanje.stranica === 'sacuvano') el.hdrSub.textContent = brojTekst(n);
}

function crtajSacuvano() {
  const upit = el.pretragaSac.value.trim().toLowerCase();
  const lista = stanje.sacuvano
    .map(s => {
      const d = izKljuca(s.d);
      const p = porukaPo(s.id) || porukaZa(d);          // fallback ako se podaci promijene
      return { d, p, k: knjigaPo(p.knjiga) };
    })
    .filter(x => !upit ||
      x.p.tekst.toLowerCase().includes(upit) ||
      (x.k?.naslov || '').toLowerCase().includes(upit) ||
      (x.p.poglavlje || x.p.tema || '').toLowerCase().includes(upit));

  el.pretragaX.classList.toggle('hide', !upit);

  if (!lista.length) {
    el.listaSac.innerHTML = stanje.sacuvano.length
      ? prazno('i-lupa', 'Nema rezultata', 'Nijedna sačuvana poruka ne odgovara pretrazi.')
      : prazno('i-zvijezda', 'Zbirka je prazna', 'Dodirni zvjezdicu na poruci koja te dotakne i naći ćeš je ovdje.');
    return;
  }

  el.listaSac.innerHTML = lista.map((x, i) => `
    <div class="stavka" style="animation-delay:${i * 38}ms">
      <button class="stavka__glavno" data-dan="${kljuc(x.d)}">
        <span class="stavka__dat"><b>${x.d.getDate()}</b><span>${MJESECI_KRATKO[x.d.getMonth()]}</span></span>
        <span class="stavka__telo">
          <p class="stavka__tekst">${esc(x.p.tekst)}</p>
          <span class="stavka__meta">${esc(x.k ? x.k.naslov : '')}</span>
        </span>
      </button>
      <button class="stavka__ukloni" data-ukloni="${kljuc(x.d)}" aria-label="Ukloni iz sačuvanih"
              title="Ukloni iz sačuvanih">${ikona('i-zvijezda-f')}</button>
    </div>`).join('');

  $$('.stavka', el.listaSac).forEach(b => requestAnimationFrame(() => b.classList.add('in')));
  $$('.stavka__glavno', el.listaSac).forEach(b =>
    b.addEventListener('click', () => otvoriPoruku(izKljuca(b.dataset.dan))));
  $$('.stavka__ukloni', el.listaSac).forEach(b =>
    b.addEventListener('click', () => ukloniSacuvano(izKljuca(b.dataset.ukloni))));
}

const prazno = (ik, nas, txt) =>
  `<div class="prazno">${ikona(ik)}<h3>${nas}</h3><p>${txt}</p></div>`;

function ukloniSacuvano(d) {
  const i = nadjiSacuvano(d);
  if (i === -1) return;
  stanje.sacuvano.splice(i, 1);
  pisi(LS.sacuvano, stanje.sacuvano);
  crtajSacuvano();
  osvjeziBrojSacuvanih();
  osvjeziFav();
  poruka('Uklonjeno iz zbirke', 'i-x');
}

/* --- stranice --- */
function naStranicu(ime) {
  stanje.stranica = ime;
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === `v-${ime}`));

  const jeSac = ime === 'sacuvano';
  el.hdrNazad.hidden = !jeSac;
  el.hdrMark.hidden = jeSac;
  el.btnSacuvano.hidden = jeSac;
  el.hdrTitle.textContent = jeSac ? 'Sačuvano' : 'Ammar Bašić';
  el.hdrSub.textContent = jeSac ? brojTekst(stanje.sacuvano.length) : 'Poruka dana';
  if (jeSac) crtajSacuvano();
  scrollTo({ top: 0 });
}

/* ---------- 10. TEMA ---------- */
function primijeniTemu() {
  const sistem = matchMedia('(prefers-color-scheme: light)').matches ? 'svijetla' : 'tamna';
  const t = stanje.autoTema ? sistem : stanje.tema;
  document.documentElement.dataset.tema = t;
  $('meta[name="theme-color"]').content = t === 'svijetla' ? '#F5F1E7' : '#0B1711';

  el.pAuto.setAttribute('aria-checked', String(stanje.autoTema));
  el.rTema.setAttribute('aria-disabled', String(stanje.autoTema));
  $$('#seg-tema button').forEach(b => b.classList.toggle('on', b.dataset.tema === t));
}

function prebaciAuto() {
  stanje.autoTema = !stanje.autoTema;
  pisi(LS.autoTema, stanje.autoTema);
  primijeniTemu();
}

function postaviTemu(t) {
  stanje.tema = t;
  pisi(LS.tema, t);
  primijeniTemu();
}

/* ---------- 11. NOTIFIKACIJE (Web Push) ---------- */
/* Dnevno slanje vodi cron na serveru (/api/send) — svima u isto vrijeme.
   Aplikacija traži dozvolu, registruje push pretplatu i pamti izbor.
   Ako backend nije podignut, prekidač i dalje radi lokalno, a test
   notifikacija se prikaže direktno preko service workera. */

const push = { javniKljuc: null, spreman: false };

/* Test notifikacija je razvojna alatka — na objavljenoj verziji je nema.
   Endpoint /api/test je tamo takođe zatvoren. */
const RAZVOJ = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

async function ucitajPushConfig() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    if (d.vapidPublicKey) { push.javniKljuc = d.vapidPublicKey; push.spreman = true; }
  } catch { /* backend nije dostupan — radimo lokalno */ }
}

/** base64url → Uint8Array, format koji traži pushManager.subscribe */
function kljucUBajtove(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const sirovo = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(sirovo, c => c.charCodeAt(0));
}

const swSpreman = () => ('serviceWorker' in navigator ? navigator.serviceWorker.ready : null);

async function pretplatiPush() {
  const reg = await swSpreman();
  if (!reg || !('pushManager' in reg)) return null;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    if (!push.spreman) return null;                     // nema VAPID ključa
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: kljucUBajtove(push.javniKljuc),
    });
  }
  try {
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
  } catch { /* server nije dostupan, pretplata ostaje lokalno */ }
  return sub;
}

async function odjaviPush() {
  const reg = await swSpreman();
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub) return;
  try {
    await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch { /* tiho */ }
  try { await sub.unsubscribe(); } catch { /* tiho */ }
}

function opisNotif() {
  if (!('Notification' in window)) return 'Preglednik ne podržava notifikacije';
  if (Notification.permission === 'denied') return 'Blokirano u postavkama preglednika';
  return stanje.notif ? 'Uključeno' : 'Isključeno';
}

function osvjeziNotif() {
  const uklj = stanje.notif && 'Notification' in window && Notification.permission === 'granted';
  el.pNotif.setAttribute('aria-checked', String(uklj));
  el.notifStanje.textContent = opisNotif();
  el.rTestNotif.hidden = !uklj || !RAZVOJ;
  el.notifNapomena.hidden = !uklj;
  el.notifNapomena.textContent = uklj
    ? (push.spreman
        ? 'Poruku dana šaljemo svaki dan u isto vrijeme.'
        : 'Dozvola je data. Dnevno slanje se uključuje kada server bude podignut.')
    : '';
}

async function prebaciNotif() {
  if (!('Notification' in window)) return poruka('Preglednik ne podržava notifikacije', 'i-info');

  if (stanje.notif) {
    stanje.notif = false;
    pisi(LS.notif, false);
    await odjaviPush();
    osvjeziNotif();
    return poruka('Podsjetnik isključen', 'i-zvono');
  }

  let dozvola = Notification.permission;
  if (dozvola === 'default') dozvola = await Notification.requestPermission();
  if (dozvola !== 'granted') {
    osvjeziNotif();
    return poruka('Dozvola za notifikacije nije data', 'i-info');
  }

  stanje.notif = true;
  pisi(LS.notif, true);
  await pretplatiPush();
  osvjeziNotif();
  poruka('Podsjetnik uključen', 'i-zvono');
}

/** Test: preko servera ako je podignut, inače lokalno kroz service worker. */
async function testNotifikacija() {
  if (Notification.permission !== 'granted') return poruka('Prvo uključi podsjetnik', 'i-info');

  const p = porukaZa(danasnji());
  const k = knjigaPo(p.knjiga);
  const tijelo = p.tekst.length > 150 ? `${p.tekst.slice(0, 147)}…` : p.tekst;

  if (push.spreman) {
    try {
      const reg = await swSpreman();
      const sub = await reg?.pushManager?.getSubscription() || await pretplatiPush();
      if (sub) {
        const r = await fetch('/api/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub }),
        });
        if (r.ok) return poruka('Test notifikacija poslana', 'i-zvono');
      }
    } catch { /* pada na lokalni prikaz */ }
  }

  try {
    const reg = await swSpreman();
    await reg.showNotification('Nova poruka dana', {
      body: tijelo,
      icon: '/assets/icons/icon-192.png',
      badge: '/assets/icons/icon-192.png',
      tag: 'poruka-test',
      renotify: true,
      data: { url: '/' },
      actions: [{ action: 'open', title: 'Pročitaj poruku' }],
    });
    poruka(`Test notifikacija prikazana${k ? '' : ''}`, 'i-zvono');
  } catch {
    poruka('Notifikacija nije prikazana', 'i-info');
  }
}

/* --- instalacija --- */
/* beforeinstallprompt zna doći par stotina milisekundi nakon učitavanja, pa
   klik na red kratko počeka na događaj prije nego padne na ručnu uputu. */

let instalPrompt = null;
let cekaci = [];

const jeInstalirana = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  matchMedia('(display-mode: minimal-ui)').matches ||
  navigator.standalone === true;

addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  instalPrompt = e;
  cekaci.forEach(f => f(e));
  cekaci = [];
  try { osvjeziInstal(); } catch { /* elementi još nisu vezani */ }
});

addEventListener('appinstalled', () => {
  instalPrompt = null;
  cekaci = [];
  try { osvjeziInstal(); } catch { /* tiho */ }
  poruka('Aplikacija je instalirana', 'i-instal');
});

function cekajPrompt(ms = 1400) {
  if (instalPrompt) return Promise.resolve(instalPrompt);
  return new Promise(res => {
    const slusac = e => { clearTimeout(t); res(e); };
    const t = setTimeout(() => {
      cekaci = cekaci.filter(f => f !== slusac);
      res(null);
    }, ms);
    cekaci.push(slusac);
  });
}

function osvjeziInstal() {
  if (jeInstalirana()) {
    el.instalOpis.textContent = 'Aplikacija je već instalirana';
    el.rInstal.setAttribute('aria-disabled', 'true');
    return;
  }
  el.rInstal.removeAttribute('aria-disabled');
  el.instalOpis.textContent = 'Dodaj na početni ekran';
}

async function instaliraj() {
  if (jeInstalirana()) return poruka('Aplikacija je već instalirana', 'i-instal');

  el.instalOpis.textContent = 'Pripremam instalaciju…';
  const p = instalPrompt || await cekajPrompt();

  if (p) {
    try {
      await p.prompt();                                  // preglednikov vlastiti dijalog
      const { outcome } = await p.userChoice;
      instalPrompt = null;
      osvjeziInstal();
      if (outcome === 'accepted') poruka('Instalacija pokrenuta', 'i-instal');
      return;
    } catch {
      instalPrompt = null;                               // potrošen ili odbijen
    }
  }

  osvjeziInstal();
  otvoriUputu();
}

/** Koraci za dodavanje na početni ekran, po platformi.
    Dijele ih i modal iz postavki i posljednji korak uvoda. */
function uputaZaUredjaj() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);

  if (iOS) return {
    uvod: 'Safari na iPhoneu i iPadu instalira aplikaciju iz menija za dijeljenje.',
    koraci: [
      'Dodirni ikonicu <b>Podijeli</b> na dnu ekrana.',
      'Skrolaj i odaberi <b>Dodaj na početni ekran</b>.',
      'Potvrdi sa <b>Dodaj</b> — ikonica se pojavi među aplikacijama.',
    ],
  };

  if (android) return {
    uvod: 'U Chromeu na Androidu instalacija je u meniju preglednika.',
    koraci: [
      'Dodirni <b>⋮</b> u gornjem desnom uglu.',
      'Odaberi <b>Instaliraj aplikaciju</b> ili <b>Dodaj na početni ekran</b>.',
      'Potvrdi — aplikacija se otvara u svom prozoru.',
    ],
  };

  return {
    uvod: 'Na računaru instalaciju nudi sam preglednik u adresnoj traci.',
    koraci: [
      'Klikni ikonicu <b>instalacije</b> na desnoj strani adresne trake.',
      'Ako je nema, otvori meni preglednika i traži <b>Instaliraj…</b>',
      'Potvrdi — aplikacija dobija svoj prozor i ikonicu.',
    ],
  };
}

/** Kad preglednik ne nudi svoj dijalog (iOS Safari, Firefox), pokažemo korake. */
function otvoriUputu() {
  const { uvod, koraci } = uputaZaUredjaj();
  el.instalKoraci.innerHTML = `
    <p class="koraci-uvod">${uvod}</p>
    <ol class="koraci">
      ${koraci.map((k, i) => `
        <li class="korak"><span class="korak__br">${i + 1}</span><p>${k}</p></li>`).join('')}
    </ol>`;
  otvori(el.mInstal);
}

/* ---------- 12. KNJIGE (carousel) ---------- */
function crtajKnjige() {
  const grupa = `<div class="traka__grupa">${stanje.podaci.knjige.map(k => `
    <a class="knjiga" href="${esc(k.url || stanje.podaci.autor.knjige_url)}" target="_blank" rel="noopener">
      <img src="/assets/books/${esc(k.slika)}" alt="${esc(k.naslov)}" loading="lazy" width="112" height="168">
      <b>${esc(k.naslov)}</b>${k.podnaslov ? `<span>${esc(k.podnaslov)}</span>` : ''}
    </a>`).join('')}</div>`;

  // dvije identične grupe → animacija do -50% se spaja bez šava
  $$('.traka__vrpca').forEach(v => { v.innerHTML = grupa + grupa; });
}

/* ---------- 13. DIJELJENJE (canvas) ---------- */
const slikeCache = new Map();
function ucitajSliku(src) {
  if (!slikeCache.has(src)) {
    slikeCache.set(src, new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(src));
      i.src = src;
    }));
  }
  return slikeCache.get(src);
}

function crtajKontrole() {
  el.formati.innerHTML = FORMATI.map(f => {
    const h = 28, w = Math.round(h * f.w / f.h);
    return `<button class="d-btn" data-format="${f.id}" aria-pressed="${f.id === stanje.format}">
      <span class="d-btn__vizual"><i class="d-btn__okvir" style="width:${w}px;height:${h}px"></i></span>
      <span class="d-btn__ime">${f.naziv}<small>${f.opis}</small></span>
    </button>`;
  }).join('');

  el.stilovi.innerHTML = STILOVI.map(s => `
    <button class="d-btn" data-stil="${s.id}" aria-pressed="${s.id === stanje.stil}" title="Stil ${s.naziv}">
      <span class="d-btn__vizual">
        <i class="d-btn__uzorak" style="background:linear-gradient(150deg,${s.bg[0]},${s.bg[1]});color:${s.gold}">&ldquo;</i>
      </span>
      <span class="d-btn__ime">${s.naziv}</span>
    </button>`).join('');

  $$('button', el.formati).forEach(b => b.addEventListener('click', () => {
    stanje.format = b.dataset.format; pisi(LS.format, stanje.format);
    crtajKontrole(); nacrtajPlatno();
  }));
  $$('button', el.stilovi).forEach(b => b.addEventListener('click', () => {
    stanje.stil = b.dataset.stil; pisi(LS.stil, stanje.stil);
    crtajKontrole(); nacrtajPlatno();
  }));
}

/** Lomi tekst na redove koji staju u zadanu širinu. */
function lomiTekst(c, tekst, maxW) {
  const redovi = [];
  let red = '';
  for (const rijec of tekst.split(/\s+/)) {
    const test = red ? `${red} ${rijec}` : rijec;
    if (c.measureText(test).width > maxW && red) { redovi.push(red); red = rijec; }
    else red = test;
  }
  if (red) redovi.push(red);
  return redovi;
}

/** Pregled se uklapa u dostupnu širinu modala — nikad ne prelije. */
function dimenzionirajPregled(f) {
  const dostupnaW = Math.max(160, el.pregled.clientWidth || 280);
  const maxH = Math.max(200, Math.min(320, innerHeight * 0.32));
  let h = maxH, w = h * f.w / f.h;
  if (w > dostupnaW) { w = dostupnaW; h = w * f.h / f.w; }
  el.platno.style.width = `${Math.round(w)}px`;
  el.platno.style.height = `${Math.round(h)}px`;
}

/* --- ornamenti na platnu --- */

/** Osmokraka zvijezda: dva preklopljena kvadrata. */
function zvijezda8(c, cx, cy, r) {
  const a = r * 0.72;
  c.beginPath();
  c.rect(cx - a, cy - a, a * 2, a * 2);
  c.save();
  c.translate(cx, cy);
  c.rotate(Math.PI / 4);
  c.rect(-a, -a, a * 2, a * 2);
  c.restore();
  c.stroke();
}

/** Arabeskni ugao sa zaobljenim prelazom. */
function ugaoOrnament(c, x, y, sx, sy, u) {
  c.beginPath();
  c.moveTo(x + sx * u, y);
  c.lineTo(x + sx * u * 0.4, y);
  c.quadraticCurveTo(x, y, x, y + sy * u * 0.4);
  c.lineTo(x, y + sy * u);
  c.stroke();
}

async function nacrtajPlatno() {
  const f = FORMATI.find(x => x.id === stanje.format) || FORMATI[1];
  const s = STILOVI.find(x => x.id === stanje.stil) || STILOVI[0];
  const p = porukaZa(stanje.datum);
  const k = knjigaPo(p.knjiga);

  el.platno.width = f.w;
  el.platno.height = f.h;
  dimenzionirajPregled(f);

  const c = el.platno.getContext('2d');
  const W = f.w, H = f.h;

  /* --- podloga --- */
  const grad = c.createLinearGradient(0, 0, W * 0.35, H);
  grad.addColorStop(0, s.bg[0]);
  grad.addColorStop(1, s.bg[1]);
  c.fillStyle = grad;
  c.fillRect(0, 0, W, H);

  // topli sjaj pri vrhu daje dubinu
  const sjaj = c.createRadialGradient(W / 2, H * 0.16, 0, W / 2, H * 0.16, W * 0.85);
  sjaj.addColorStop(0, `${s.gold}1C`);
  sjaj.addColorStop(1, 'transparent');
  c.fillStyle = sjaj;
  c.fillRect(0, 0, W, H);

  /* --- dvostruki okvir i arabeskni uglovi --- */
  const m = W * 0.058;
  const m2 = m + W * 0.015;
  c.strokeStyle = `${s.gold}33`;
  c.lineWidth = 1.4;
  c.strokeRect(m, m, W - m * 2, H - m * 2);
  c.strokeStyle = `${s.gold}1C`;
  c.strokeRect(m2, m2, W - m2 * 2, H - m2 * 2);

  c.strokeStyle = `${s.gold}A8`;
  c.lineWidth = W * 0.0032;
  const u = W * 0.058;
  ugaoOrnament(c, m, m, 1, 1, u);
  ugaoOrnament(c, W - m, m, -1, 1, u);
  ugaoOrnament(c, m, H - m, 1, -1, u);
  ugaoOrnament(c, W - m, H - m, -1, -1, u);

  c.textAlign = 'center';

  /* --- podnožje se gradi od dna prema gore, pa se ništa ne može preklopiti --- */
  const dno       = H - m2 - W * 0.028;
  const lsz       = W * 0.058;              // znak
  const yLogo     = dno - lsz;
  const yAutor    = yLogo - W * 0.028;
  const yPoglavlje = yAutor - W * 0.036;
  const yNaslov   = yPoglavlje - W * 0.040;
  const yNad      = yNaslov - W * 0.036;
  const yRaz      = yNad - W * 0.032;

  /* --- zaglavlje --- */
  c.fillStyle = s.gold;
  c.font = `700 ${W * 0.021}px ${SANS}`;
  const yDat = H * 0.135;
  c.save();
  c.letterSpacing = `${W * 0.0075}px`;
  c.fillText(punDatum(stanje.datum).toUpperCase(), W / 2, yDat);
  c.restore();

  const hDat = hidzri(stanje.datum);
  if (hDat) {
    c.fillStyle = `${s.ink}82`;
    c.font = `italic 400 ${W * 0.029}px ${SERIF}`;
    c.fillText(hDat, W / 2, yDat + W * 0.046);
  }

  // razdjelnik: linija — osmokraka zvijezda — linija
  const yOrn = yDat + W * 0.085;
  c.strokeStyle = `${s.gold}45`;
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(W * 0.29, yOrn); c.lineTo(W * 0.435, yOrn);
  c.moveTo(W * 0.565, yOrn); c.lineTo(W * 0.71, yOrn);
  c.stroke();
  c.strokeStyle = `${s.gold}C8`;
  c.lineWidth = W * 0.0028;
  zvijezda8(c, W / 2, yOrn, W * 0.020);

  /* --- citat: auto-fit unutar preostalog prostora --- */
  const maxW = W * 0.72;
  const gornja = yOrn + W * 0.052;
  const donja  = yRaz - W * 0.040;
  const navodProstor = W * 0.055;            // navodnici prelaze preko teksta, treba manje mjesta

  let fs = Math.round(W * 0.060), redovi, lh;
  for (;;) {
    c.font = `400 ${fs}px ${SERIF}`;
    redovi = lomiTekst(c, p.tekst, maxW);
    lh = fs * 1.56;
    if (redovi.length * lh <= donja - gornja - navodProstor * 2 || fs <= W * 0.020) break;
    fs -= 2;
  }

  const visinaBloka = redovi.length * lh;
  const yTekst = (gornja + donja) / 2 - visinaBloka / 2 + lh * 0.32;

  // dupli navodnici, veći ali blijedi
  // navodnici prate stvarni početak prvog i kraj zadnjeg reda
  // (redovi su centrirani, pa se ivice računaju iz njihove izmjerene širine)
  c.font = `400 ${fs}px ${SERIF}`;
  const prviW  = c.measureText(redovi[0]).width;
  const zadnjiW = c.measureText(redovi[redovi.length - 1]).width;
  const xPocetak = W / 2 - prviW / 2;
  const xKraj    = W / 2 + zadnjiW / 2;
  const yZadnji  = yTekst + (redovi.length - 1) * lh;

  const Fq = W * 0.20;
  c.save();
  c.font = `700 ${Fq}px ${DISPLAY}`;
  c.fillStyle = `${s.navod}40`;
  c.textAlign = 'right';
  c.fillText('\u201C', xPocetak - Fq * 0.05, yTekst - fs * 0.70 + Fq * 0.45);
  c.textAlign = 'left';
  c.fillText('\u201D', xKraj + Fq * 0.05, yZadnji + fs * 0.26 + Fq * 0.72);
  c.restore();
  c.textAlign = 'center';

  c.fillStyle = s.ink;
  c.font = `400 ${fs}px ${SERIF}`;
  redovi.forEach((r, i) => c.fillText(r, W / 2, yTekst + i * lh));

  /* --- podnožje --- */
  c.strokeStyle = `${s.gold}40`;
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(W * 0.44, yRaz); c.lineTo(W * 0.56, yRaz);
  c.stroke();

  if (k) {
    c.fillStyle = `${s.ink}75`;
    c.font = `700 ${W * 0.016}px ${SANS}`;
    c.save();
    c.letterSpacing = `${W * 0.0085}px`;
    c.fillText('IZ KNJIGE', W / 2, yNad);
    c.restore();

    c.fillStyle = s.ink;
    c.font = `500 ${W * 0.039}px ${SERIF}`;
    c.fillText(k.naslov, W / 2, yNaslov);
  }

  const poglavlje = p.poglavlje || p.tema;
  if (poglavlje) {
    c.fillStyle = `${s.gold}D0`;
    c.font = `italic 400 ${W * 0.026}px ${SERIF}`;
    c.fillText(poglavlje, W / 2, yPoglavlje);
  }

  c.fillStyle = `${s.ink}9E`;
  c.font = `400 ${W * 0.025}px ${SERIF}`;
  c.fillText(stanje.podaci.autor.ime, W / 2, yAutor);

  try {
    const logo = await ucitajSliku(`/assets/brand/ammar_basic_logo_${s.logo}_m_1.png`);
    c.globalAlpha = 0.8;
    c.drawImage(logo, W / 2 - lsz / 2, yLogo, lsz, lsz);
    c.globalAlpha = 1;
  } catch { /* bez znaka */ }
}

const imeDatoteke = () => `poruka-dana-${kljuc(stanje.datum)}.png`;
const uBlob = () => new Promise(res => el.platno.toBlob(res, 'image/png'));

async function podijeliSliku() {
  const blob = await uBlob();
  if (!blob) return poruka('Slika nije napravljena', 'i-info');
  const file = new File([blob], imeDatoteke(), { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: tekstZaDijeljenje() });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  sacuvajBlob(blob);
  poruka('Dijeljenje nije podržano — slika je preuzeta', 'i-preuzmi');
}

function sacuvajBlob(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = imeDatoteke();
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function sacuvajSliku() {
  const blob = await uBlob();
  if (!blob) return;
  sacuvajBlob(blob);
  poruka('Slika je preuzeta', 'i-preuzmi');
}

async function kopirajSliku() {
  try {
    const blob = await uBlob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    poruka('Slika kopirana', 'i-kopiraj');
  } catch {
    poruka('Kopiranje slike nije podržano', 'i-info');
  }
}

/* ---------- 14. MODALI ---------- */
function otvori(sloj) {
  sloj.classList.add('on');
  document.body.style.overflow = 'hidden';
}

function zatvoriSve() {
  $$('.sloj.on').forEach(s => s.classList.remove('on'));
  document.body.style.overflow = '';
}

async function otvoriDijeljenje() {
  crtajKontrole();
  otvori(el.mDijeli);
  try {
    await Promise.all([
      document.fonts?.load(`400 80px ${SERIF}`),
      document.fonts?.load(`700 80px ${DISPLAY}`),
    ]);
  } catch { /* fontovi nisu obavezni */ }
  nacrtajPlatno();
}

function otvoriPoruku(d) {
  const p = porukaZa(d), k = knjigaPo(p.knjiga);
  const h = hidzri(d);

  el.mpSadrzaj.innerHTML = `
    <div class="mp__dat">${naziviDana(d)} · ${punDatum(d)}</div>
    ${h ? `<div class="mp__hidzri">${h}</div>` : ''}
    <div class="razdjelnik" aria-hidden="true"><i></i>${ikona('i-zvijezda8')}<i></i></div>
    <p class="mp__tekst">&ldquo;${esc(p.tekst)}&rdquo;</p>
    <a class="mp__izvor" href="${esc(k?.url || stanje.podaci.autor.knjige_url)}" target="_blank" rel="noopener">
      ${k ? `<img class="izvor__cover" src="/assets/books/${esc(k.slika)}" alt="">` : ''}
      <span class="izvor__tekst">
        <span class="izvor__nad">Iz knjige</span>
        <b class="izvor__naslov">${esc(k ? k.naslov : '')}</b>
        <span class="izvor__tema">${esc(p.poglavlje || p.tema || '')}</span>
      </span>
      <span class="izvor__str">${ikona('i-strelica')}</span>
    </a>`;

  stanje.detalj = d;
  osvjeziDetaljFav();
  otvori(el.mPoruka);
}

function osvjeziDetaljFav() {
  if (!stanje.detalj) return;
  const ima = nadjiSacuvano(stanje.detalj) !== -1;
  el.mpFav.setAttribute('aria-pressed', String(ima));
  $('use', el.mpFav).setAttribute('href', ima ? '#i-zvijezda-f' : '#i-zvijezda');
  el.mpFavTekst.textContent = ima ? 'Sačuvano' : 'Sačuvaj';
}

function prebaciDetaljFav() {
  const d = stanje.detalj;
  if (!d) return;
  const i = nadjiSacuvano(d);
  if (i === -1) {
    stanje.sacuvano.unshift({ d: kljuc(d), id: porukaZa(d).id });
    el.mpFav.classList.add('pulse');
    setTimeout(() => el.mpFav.classList.remove('pulse'), 520);
    poruka('Sačuvano u tvoju zbirku', 'i-zvijezda-f');
  } else {
    stanje.sacuvano.splice(i, 1);
    poruka('Uklonjeno iz zbirke', 'i-x');
  }
  pisi(LS.sacuvano, stanje.sacuvano);
  osvjeziDetaljFav();
  osvjeziBrojSacuvanih();
  osvjeziFav();
  crtajSacuvano();
}

/* ---------- 15. TOAST ---------- */
function poruka(tekst, ik = 'i-kvaka') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `${ikona(ik)}<span>${esc(tekst)}</span>`;
  el.toasts.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, 2400);
}

/* ---------- 16. UVOD ---------- */
/* Četiri koraka: dobrodošlica → tema → notifikacije → instalacija.
   Korak s notifikacijama ne pušta dalje dok se dozvola ne riješi. Ako je
   preglednik trajno odbio ili ne podržava notifikacije, korak se otključa —
   inače bi aplikacija ostala zaglavljena bez izlaza. */

let uvodIdx = 0;

const notifPodrzan = () => 'Notification' in window;
const notifStanjeSad = () => (notifPodrzan() ? Notification.permission : 'nepodrzano');

/** Je li korak s notifikacijama riješen (dozvoljeno, odbijeno ili nepodržano)? */
const notifKorakRijesen = () => notifStanjeSad() !== 'default';

function crtajUvod() {
  const k = UVOD_KORACI[uvodIdx];
  el.uvodNas.textContent = k.n;
  el.uvodTekst.textContent = k.t;

  const blok = el.uvodNas.parentElement;
  blok.classList.remove('uvod__blok');
  void blok.offsetWidth;                                   // restart animacije
  blok.classList.add('uvod__blok');

  el.uvodTacke.innerHTML = UVOD_KORACI
    .map((_, i) => `<i class="${i === uvodIdx ? 'on' : ''}"></i>`).join('');

  el.uvodSadrzaj.innerHTML = '';
  el.uvodDalje.disabled = false;

  if (k.id === 'tema') {
    crtajIzborTeme();
    el.uvodDalje.textContent = 'Dalje';
  } else if (k.id === 'notif') {
    crtajKorakNotif();
  } else if (k.id === 'instal') {
    crtajKorakInstal();
    el.uvodDalje.textContent = 'Uđi u aplikaciju';
  } else {
    el.uvodDalje.textContent = 'Dalje';
  }
}

/* --- korak: tema --- */
function crtajIzborTeme() {
  const izabran = stanje.autoTema ? 'auto' : stanje.tema;
  el.uvodSadrzaj.innerHTML = `
    <div class="tema-izbor" id="tema-izbor">
      ${TEME.map(t => `
        <button class="tema-opcija" data-izbor="${t.id}" aria-pressed="${t.id === izabran}">
          <span class="tema-opcija__vizual" style="background:${t.boje}"></span>
          <span class="tema-opcija__ime">${t.ime}</span>
        </button>`).join('')}
    </div>`;

  $('#tema-izbor').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const izbor = b.dataset.izbor;
    stanje.autoTema = izbor === 'auto';
    pisi(LS.autoTema, stanje.autoTema);
    if (!stanje.autoTema) { stanje.tema = izbor; pisi(LS.tema, izbor); }
    primijeniTemu();
    crtajIzborTeme();                                      // osvježi izabrano stanje
  });
}

/* --- korak: notifikacije --- */
function crtajKorakNotif() {
  const stanjeD = notifStanjeSad();

  if (stanjeD === 'granted') {
    el.uvodSadrzaj.innerHTML =
      `<span class="uvod__stanje uvod__stanje--ok">${ikona('i-kvaka')} Notifikacije uključene</span>`;
    el.uvodDalje.textContent = 'Dalje';
    return;
  }

  if (stanjeD === 'denied') {
    el.uvodSadrzaj.innerHTML = `
      <span class="uvod__stanje uvod__stanje--pazi">${ikona('i-info')} Notifikacije su blokirane</span>
      <p class="uvod__nota" style="margin-top:16px">
        Dozvola je odbijena na nivou preglednika, pa je aplikacija ne može tražiti.
        Uključi je u postavkama sajta i podsjetnik će raditi.
      </p>`;
    el.uvodDalje.textContent = 'Nastavi bez podsjetnika';
    return;
  }

  if (stanjeD === 'nepodrzano') {
    el.uvodSadrzaj.innerHTML =
      `<span class="uvod__stanje uvod__stanje--pazi">${ikona('i-info')} Preglednik ne podržava notifikacije</span>`;
    el.uvodDalje.textContent = 'Nastavi';
    return;
  }

  // 'default' — dozvola se još može tražiti, korak drži dalje
  el.uvodSadrzaj.innerHTML = `
    <span class="uvod__stanje uvod__stanje--pazi">${ikona('i-zvono')} Dozvola nije data</span>
    <p class="uvod__nota" style="margin-top:16px">
      Šaljemo jednu poruku dnevno, ništa više. Podsjetnik se u svakom trenutku
      može isključiti u postavkama.
    </p>`;
  el.uvodDalje.textContent = 'Dozvoli notifikacije';
}

async function uvodTraziNotif() {
  el.uvodDalje.disabled = true;
  el.uvodDalje.textContent = 'Čekam dozvolu…';
  try {
    const dozvola = await Notification.requestPermission();
    if (dozvola === 'granted') {
      stanje.notif = true;
      pisi(LS.notif, true);
      await pretplatiPush();
    }
  } catch { /* preglednik je odbio zahtjev */ }
  el.uvodDalje.disabled = false;
  crtajKorakNotif();
  osvjeziNotif();
}

/* --- korak: instalacija --- */
function crtajKorakInstal() {
  if (jeInstalirana()) {
    el.uvodSadrzaj.innerHTML =
      `<span class="uvod__stanje uvod__stanje--ok">${ikona('i-kvaka')} Aplikacija je instalirana</span>`;
    return;
  }

  const { uvod, koraci } = uputaZaUredjaj();
  el.uvodSadrzaj.innerHTML = `
    ${instalPrompt ? `<button class="btn btn--obris btn--puni" id="uvod-instal"
        style="margin-bottom:20px">${ikona('i-instal')} Instaliraj sada</button>` : ''}
    <p class="uvod__nota">${uvod}</p>
    <ol class="koraci koraci--uvod">
      ${koraci.map((k, i) => `
        <li class="korak"><span class="korak__br">${i + 1}</span><p>${k}</p></li>`).join('')}
    </ol>`;

  $('#uvod-instal')?.addEventListener('click', async () => {
    await instaliraj();
    crtajKorakInstal();
  });
}

/* --- kretanje kroz korake --- */
async function uvodDalje() {
  const k = UVOD_KORACI[uvodIdx];

  if (k.id === 'notif' && !notifKorakRijesen()) {
    await uvodTraziNotif();
    return;                                                // ostajemo na koraku
  }

  if (uvodIdx < UVOD_KORACI.length - 1) {
    uvodIdx++;
    crtajUvod();
  } else {
    zavrsiUvod();
  }
}

function zavrsiUvod() {
  pisi(LS.uvod, VERZIJA);
  el.uvod.classList.remove('on');
  el.uvod.setAttribute('aria-hidden', 'true');
  osvjeziNotif();
  osvjeziInstal();
}

/* ---------- 17. START ---------- */
function vezi() {
  Object.assign(el, {
    dan: $('#d-dan'), datum: $('#d-datum'), hidzri: $('#d-hidzri'),
    tekst: $('#k-tekst'), knjiga: $('#k-knjiga'), tema: $('#k-tema'),
    citat: $('#citat'), navodO: $('#navod-o'), navodZ: $('#navod-z'),
    cover: $('#k-cover'), izvor: $('#k-izvor'), karta: $('#karta'),
    svajpTekst: $('#svajp-tekst'),
    danPrije: $('#dan-prije'), danPoslije: $('#dan-poslije'), danDanas: $('#dan-danas'),
    fav: $('#a-fav'), favTekst: $('#a-fav-tekst'),
    hdrNazad: $('#btn-nazad'), hdrMark: $('#hdr-mark'),
    hdrTitle: $('#hdr-title'), hdrSub: $('#hdr-sub'),
    btnSacuvano: $('#btn-sacuvano'), brojSac: $('#broj-sac'),
    listaSac: $('#lista-sacuvano'),
    pretragaSac: $('#pretraga-sac'), pretragaX: $('#pretraga-x'),
    pAuto: $('#p-auto'), rTema: $('#r-tema'),
    pNotif: $('#p-notif'), notifStanje: $('#r-notif-stanje'),
    notifNapomena: $('#notif-napomena'), rTestNotif: $('#r-test-notif'),
    rInstal: $('#r-instal'), instalOpis: $('#r-instal-opis'),
    mInstal: $('#m-instal'), instalKoraci: $('#instal-koraci'),
    formati: $('#dijeli-formati'), stilovi: $('#dijeli-stilovi'),
    platno: $('#platno'), pregled: $('#pregled'),
    mPostavke: $('#m-postavke'), mDijeli: $('#m-dijeli'), mPoruka: $('#m-poruka'),
    mpSadrzaj: $('#mp-sadrzaj'), mpFav: $('#mp-fav'), mpFavTekst: $('#mp-fav-tekst'),
    toasts: $('#toasts'),
    uvod: $('#uvod'), uvodNas: $('#uvod-nas'), uvodTekst: $('#uvod-tekst'),
    uvodSadrzaj: $('#uvod-sadrzaj'), uvodDalje: $('#uvod-dalje'), uvodTacke: $('#uvod-tacke'),
  });
}

function slusaci() {
  // dani
  el.danPrije.addEventListener('click', () => pomjeriDan(-1));
  el.danPoslije.addEventListener('click', () => pomjeriDan(1));
  el.danDanas.addEventListener('click', naDanas);
  postaviSwipe(el.karta);

  addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('.sloj.on')) return zatvoriSve();
      if (stanje.stranica !== 'danas') return naStranicu('danas');
      return;
    }
    if ($('.sloj.on') || el.uvod.classList.contains('on')) return;
    if (stanje.stranica !== 'danas') return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowLeft')  pomjeriDan(-1);
    if (e.key === 'ArrowRight') pomjeriDan(1);
  });

  // navodnici: mjeri ponovo kad se tekst, font ili širina promijene
  el.tekst.addEventListener('animationend', zakaziMjerenje);
  if ('ResizeObserver' in window) new ResizeObserver(zakaziMjerenje).observe(el.citat);
  else addEventListener('resize', zakaziMjerenje);
  document.fonts?.ready.then(zakaziMjerenje).catch(() => {});

  // akcije
  el.fav.addEventListener('click', prebaciFav);
  $('#a-dijeli').addEventListener('click', otvoriDijeljenje);
  $('#a-kopiraj').addEventListener('click', kopirajTekst);

  // stranice
  el.hdrNazad.addEventListener('click', () => naStranicu('danas'));
  el.btnSacuvano.addEventListener('click', () => { zatvoriSve(); naStranicu('sacuvano'); });

  // postavke
  $('#btn-postavke').addEventListener('click', () => otvori(el.mPostavke));
  $('#r-auto').addEventListener('click', prebaciAuto);
  $('#seg-tema').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) postaviTemu(b.dataset.tema);
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (stanje.autoTema) primijeniTemu();
  });

  $('#r-notif').addEventListener('click', prebaciNotif);
  el.rTestNotif.addEventListener('click', testNotifikacija);
  $('#r-instal').addEventListener('click', instaliraj);

  // sačuvano
  el.pretragaSac.addEventListener('input', crtajSacuvano);
  el.pretragaX.addEventListener('click', () => { el.pretragaSac.value = ''; crtajSacuvano(); el.pretragaSac.focus(); });

  // detalj poruke
  el.mpFav.addEventListener('click', prebaciDetaljFav);
  $('#mp-dijeli').addEventListener('click', () => {
    if (stanje.detalj) { stanje.datum = stanje.detalj; prikaziDan(false); }
    zatvoriSve();
    otvoriDijeljenje();
  });

  // dijeljenje
  $('#btn-share').addEventListener('click', podijeliSliku);
  $('#btn-save').addEventListener('click', sacuvajSliku);
  $('#btn-copy-img').addEventListener('click', kopirajSliku);
  addEventListener('resize', () => {
    if (el.mDijeli.classList.contains('on')) {
      dimenzionirajPregled(FORMATI.find(x => x.id === stanje.format) || FORMATI[1]);
    }
  });

  // modali
  $$('[data-zatvori]').forEach(b => b.addEventListener('click', zatvoriSve));

  // uvod
  el.uvodDalje.addEventListener('click', uvodDalje);

  // ponovni ulazak: provjeri je li se datum promijenio
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && stanje.podaci) {
      if (istiDan(stanje.datum, danasnji())) prikaziDan(false);
    }
  });
}

function greska(e) {
  $('.wrap').innerHTML = prazno('i-info', 'Podaci nisu učitani',
    `${esc(e.message)}. Provjeri da data/poruke.json postoji i da se stranica servira preko HTTP-a.`);
  console.error(e);
}

async function start() {
  vezi();
  primijeniTemu();
  slusaci();
  $('#verzija').textContent = `Verzija ${VERZIJA}`;

  try {
    stanje.podaci = await ucitajPodatke();
  } catch (e) {
    return greska(e);
  }

  const a = stanje.podaci.autor;
  $('#autor-ime').textContent = a.ime;
  $('#autor-opis').textContent = a.opis;
  $('#autor-domen').textContent = a.sajt.replace(/^https?:\/\//, '').replace(/\/$/, '');
  $('#link-sajt').href = a.sajt;
  $('#link-narudzba').href = a.knjige_url;
  $('#link-knjige').href = a.knjige_url;
  $('#link-biografija').href = a.biografija || a.sajt;

  crtajKnjige();
  prikaziDan();
  crtajSacuvano();
  osvjeziBrojSacuvanih();
  osvjeziInstal();
  osvjeziNotif();

  await ucitajPushConfig();
  osvjeziNotif();
  if (stanje.notif && Notification.permission === 'granted') pretplatiPush();

  if (cita(LS.uvod, null) !== VERZIJA) {
    uvodIdx = 0;
    crtajUvod();
    el.uvod.classList.add('on');
    el.uvod.setAttribute('aria-hidden', 'false');
  }
}

start();

/* --- service worker: potreban je za push i offline; mrežа-prvo strategija
       u sw.js znači da se izmjene i u razvoju vide odmah --- */
if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
