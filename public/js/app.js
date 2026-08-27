/* ============================================================
   PORUKA DANA — aplikacija
   ------------------------------------------------------------
   1 Konstante · 2 Helperi · 3 Datum · 4 Stanje · 5 Podaci
   6 Kartica · 7 Dani + swipe · 8 Akcije · 9 Sačuvano
   10 Tema · 11 Notifikacije · 11b Vodič za instalaciju
   12 Knjige · 13 Dijeljenje · 14 Modali · 15 Toast · 16 Uvod
   17 Nadogradnja i reset · 18 Start
   ============================================================ */

const VERZIJA = '1.4.0';

/* Verzija uvoda je odvojena od verzije aplikacije: podiže se samo kad se
   tok stvarno promijeni, da obična nadogradnja ne tjera sve korisnike
   ponovo kroz onboarding. Dodan korak izbora izgleda u PWA toku, pa ide 3. */
const UVOD_VERZIJA = 3;

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
const SANS  = '"IBM Plex Sans", system-ui, sans-serif';

const FORMATI = [
  { id: 'prica',   naziv: 'Priča',   opis: '9:16', w: 1080, h: 1920 },
  { id: 'objava',  naziv: 'Objava',  opis: '4:5',  w: 1080, h: 1350 },
  { id: 'kvadrat', naziv: 'Kvadrat', opis: '1:1',  w: 1080, h: 1080 },
];

const STILOVI = [
  { id: 'zelena', naziv: 'Zelena', bg: ['#204234', '#0D1C15'], ink: '#F6EFDF', gold: '#E3C489', navod: '#E9C77E', logo: 'w' },
  { id: 'krem',   naziv: 'Krem',   bg: ['#F7F1E2', '#E6D9BC'], ink: '#162C21', gold: '#8E6C28', navod: '#A8813A', logo: 'b' },
];

/* Uvod ima dva odvojena toka.

   U pregledniku je jedini cilj da aplikacija dođe na početni ekran —
   dozvola za notifikacije se tu NE traži. Na iPhoneu push i ne radi iz
   Safari taba, a i na Androidu je uredniji jedan zahtjev, u aplikaciji.

   Kad se aplikacija prvi put otvori sa početnog ekrana, traži se dozvola. */
const UVOD_KORACI = {
  pocetak: { id: 'pocetak', n: 'Poruka dana',
    t: 'Svaki dan po jedna poruka iz knjiga hafiza Ammara Bašića.' },
  instal: { id: 'instal', n: 'Dodaj na početni ekran',
    t: 'Bez ovoga podsjetnik ne može raditi.' },
  kraj: { id: 'kraj', n: 'Sve je spremno',
    t: 'Nova poruka te čeka svaki dan.' },
};

/* Web tok je namjerno kratak: dva ekrana, i to je sve. Izbor izgleda tu ne
   stoji kao poseban korak — na telefonu je jedini cilj početni ekran, izgled
   dolazi na red u toku `pwa` (ispod). „Otvori sa početnog ekrana“ je zadnji
   red upute, ne poseban ekran. Na računaru instalacije nema, pa tamo idu
   dobrodošlica i kraj. */
const uvodWeb = () => okolina().desktop
  ? [UVOD_KORACI.pocetak, UVOD_KORACI.kraj]
  : [UVOD_KORACI.pocetak, UVOD_KORACI.instal];

const UVOD_PWA = [
  { id: 'notif', n: 'Dozvoli podsjetnik',
    t: 'Ostao je još samo jedan dodir.' },
  { id: 'tema', n: 'Odaberi izgled',
    t: 'Noć, papir ili prema postavkama tvog telefona. Uvijek se može promijeniti u postavkama.' },
  { id: 'gotovo', n: 'Sve je spremno',
    t: 'Poruka će te nalaziti svaki dan u isto vrijeme.' },
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
  uvodPwa:  'pd.uvodPwa',
  dodano:   'pd.dodano',
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

/* ---------- 3b. TESTIRANJE ---------- */
/* Onboarding se teško testira jer se svaki tok pamti i više ne pokreće.
   Ovi prekidači rade i lokalno i na objavljenoj adresi, pa se tok može
   provjeriti na pravom telefonu:

     ?uvod=web    ponovo pokreni tok u pregledniku
     ?uvod=pwa    ponovo pokreni tok aplikacije
     ?pwa=1       glumi da je aplikacija na početnom ekranu
     ?reset       obriši aplikaciju sa uređaja i kreni ispočetka

   Na localhostu se otvara i traka za pomjeranje dana (vidi 17), pa se
   poruke mogu pregledati i unaprijed. Na objavljenoj verziji je nema.

   Isto tako, samo na localhostu: ?instal=<stanje> i dugme PWA u razvojnoj
   traci glume platformu i stanje instalacije (vidi SIM_STANJA u 11b), da se
   vodič za iPhone može provjeriti bez iPhonea. Pravi API preglednika se pri
   tome nikad ne dira — simulacija samo bira šta se prikazuje. */

const RAZVOJ = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

let prisilanUvod = null;
let pwaSimulacija = false;
let resetUToku = false;
let simInstal = null;        // razvojna simulacija instalacije, vidi 11b
let simInstalId = null;
let simIzUrl = null;

(function testniPrekidaci() {
  let q;
  try { q = new URLSearchParams(location.search); } catch { return; }
  if (!q || ![...q.keys()].length) return;

  if (q.has('reset')) {
    ocistiUredjaj().then(() => location.replace(location.pathname));
    return;
  }

  const tok = q.get('uvod');
  if (tok === 'web' || tok === 'pwa') {
    prisilanUvod = tok;
    // bez ovoga korak instalacije preskoči sam sebe zbog ranije potvrde
    if (tok === 'web') { try { localStorage.removeItem(LS.dodano); } catch { /* tiho */ } }
  }
  if (q.get('pwa') === '1' || tok === 'pwa') pwaSimulacija = true;
  if (RAZVOJ) simIzUrl = q.get('instal');
})();

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

  el.danTekst.textContent = naziviDana(d);
  el.dan.title            = jeDanas ? 'Današnja poruka' : punDatum(d);
  el.datum.textContent    = punDatum(d);
  el.hidzri.textContent   = hidzri(d);

  if (animiraj) upisiRijeci(el.tekst, p.tekst);
  else el.tekst.textContent = p.tekst;

  el.knjiga.textContent = k ? k.naslov : '';
  el.tema.textContent   = p.poglavlje || p.tema || '';
  // duže poruke traže sitniji slog i širi stupac — CSS reaguje na ovaj atribut
  const n = p.tekst.length;
  el.karta.dataset.duzina = n > 430 ? 'vrlodugo'
                          : n > 330 ? 'dugo'
                          : n > 210 ? 'srednje' : 'kratko';
  el.izvor.href = k?.url || stanje.podaci.autor.knjige_url;
  if (k) { el.cover.src = `/assets/books/${k.slika}`; el.cover.alt = k.naslov; el.cover.hidden = false; }
  else el.cover.hidden = true;

  // povratak na danas se nudi samo kad se gleda stariji dan
  el.karta.dataset.stari = jeDanas ? '0' : '1';
  el.danDanas.hidden     = jeDanas;

  osvjeziFav();
  osvjeziRazvoj();
}

/**
 * Tekst se ispisuje riječ po riječ. Kaskada se sabija kod dužih poruka —
 * ukupno ispisivanje ostaje oko sekunde bez obzira na broj riječi.
 */
function upisiRijeci(cilj, tekst) {
  const rijeci = tekst.split(/\s+/);
  const korak = Math.min(32, 940 / Math.max(rijeci.length, 1));
  cilj.classList.remove('reveal');
  cilj.innerHTML = rijeci
    .map((r, i) => `<span class="w" style="animation-delay:${Math.round(i * korak + 110)}ms">${esc(r)}</span>`)
    .join(' ');
  requestAnimationFrame(() => cilj.classList.add('reveal'));

  // Kad kaskada završi, vraćamo čist tekst. Bez toga svaka riječ zadrži
  // `filter: blur(0)` iz animacije, pa ostane desetine kompozitnih slojeva
  // koje neki uređaji naprosto ne iscrtaju.
  clearTimeout(ciscenjeRijeci);
  ciscenjeRijeci = setTimeout(() => {
    cilj.classList.remove('reveal');
    cilj.textContent = tekst;
  }, Math.round(rijeci.length * korak + 700));
}
let ciscenjeRijeci = 0;

/* ---------- 7. DANI + SWIPE ---------- */
const mirnoKretanje = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let prijelazUToku = false;

/**
 * Kartica isklizne u smjeru poteza, tek onda se mijenja sadržaj, pa nova
 * uklizne s druge strane. Bez toga je promjena dana djelovala naglo.
 * Vraća `true` ako je prijelaz pokrenut — swipe se onda ne vraća nazad.
 */
function pomjeriDan(korak) {
  if (prijelazUToku) return false;
  const novi = new Date(stanje.datum);
  novi.setDate(novi.getDate() + korak);
  // lokalno se smije i naprijed — poruke se tako pregledaju unaprijed
  if (novi > danasnji() && !RAZVOJ) return false;
  prijedjiNa(novi, korak < 0 ? 1 : -1);
  return true;
}

function naDanas() {
  if (prijelazUToku || istiDan(stanje.datum, danasnji())) return false;
  prijedjiNa(danasnji(), -1);
  return true;
}

function prijedjiNa(noviDatum, smjer) {
  const k = el.karta;

  if (mirnoKretanje()) {
    stanje.datum = noviDatum;
    prikaziDan();
    return;
  }

  prijelazUToku = true;
  k.classList.remove('klizi', 'ulazi');
  k.classList.add('izlazi');
  k.style.transform = `translateX(${smjer * 32}%) rotate(${smjer * 2.4}deg) scale(.96)`;
  k.style.opacity = '0';

  setTimeout(() => {
    stanje.datum = noviDatum;
    prikaziDan();

    // početno stanje ulaska mora biti fiksirano prije nego se vrati tranzicija
    k.classList.remove('izlazi');
    k.style.transition = 'none';
    k.style.transform = `translateX(${-smjer * 24}%) rotate(${-smjer * 1.8}deg) scale(.96)`;
    k.style.opacity = '0';
    void k.offsetWidth;

    k.style.transition = '';
    k.classList.add('ulazi');
    k.style.transform = '';
    k.style.opacity = '';
    setTimeout(() => { k.classList.remove('ulazi'); prijelazUToku = false; }, 480);
  }, 220);
}

/**
 * Cijela kartica je slider: prevlačenje udesno vodi na raniju poruku,
 * ulijevo na noviju. Radi i mišem i dodirom (Pointer Events), a dok traje
 * potez kartica prati prst i pokazuje smjer (--vuk 0–1 + data-smjer).
 */
const VUK_PRAG = 64;      // koliko px treba preći da se dan promijeni
const VUK_PUN  = 120;     // na koliko px je pokazivač smjera pun

function postaviSwipe(karta) {
  let id = null, x0 = 0, y0 = 0, dx = 0, vuce = false, prati = false;

  const oznaci = () => {
    const j = Math.min(Math.abs(dx) / VUK_PUN, 1);
    karta.style.transform = `translateX(${dx}px) rotate(${(dx * 0.014).toFixed(3)}deg)`;
    karta.style.opacity = String(1 - Math.min(Math.abs(dx) / 900, 0.22));
    karta.style.setProperty('--vuk', j.toFixed(3));
    karta.dataset.smjer = dx > 0 ? 'ranije' : 'kasnije';
  };

  karta.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('button, a, input, textarea, select')) return;
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY;
    dx = 0; vuce = false; prati = true;
    karta.classList.remove('klizi');
  });

  karta.addEventListener('pointermove', e => {
    if (!prati || e.pointerId !== id) return;
    const x = e.clientX - x0;
    const y = e.clientY - y0;
    if (!vuce) {
      if (Math.abs(x) < 8) return;
      if (Math.abs(y) > Math.abs(x)) { prati = false; return; }   // vertikalni scroll ima prednost
      vuce = true;
      karta.classList.add('vuce');
      try { karta.setPointerCapture(id); } catch { /* nebitno */ }
    }
    // preko „danas“ se ne ide — otpor umjesto zida
    dx = (x > 0 || !istiDan(stanje.datum, danasnji())) ? x : x * 0.22;
    oznaci();
  });

  const kraj = e => {
    if (e && id !== null && e.pointerId !== id) return;
    if (!prati && !vuce) return;
    const presao = vuce && Math.abs(dx) > VUK_PRAG;
    const smjer = dx > 0 ? -1 : 1;
    prati = false; vuce = false; id = null;
    karta.classList.remove('vuce');
    karta.style.setProperty('--vuk', '0');
    delete karta.dataset.smjer;

    // ako je prag pređen, animacija prijelaza preuzima karticu odakle je stala
    if (presao && pomjeriDan(smjer)) { dx = 0; return; }

    karta.classList.add('klizi');
    karta.style.transform = '';
    karta.style.opacity = '';
    dx = 0;
    setTimeout(() => karta.classList.remove('klizi'), 360);
  };

  karta.addEventListener('pointerup', kraj);
  karta.addEventListener('pointercancel', kraj);
  karta.addEventListener('lostpointercapture', kraj);
  // klik na link/dugme ne smije opaliti nakon prevlačenja
  karta.addEventListener('click', e => {
    if (karta.classList.contains('vuce')) { e.preventDefault(); e.stopPropagation(); }
  }, true);
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
  el.hdrIme.hidden = jeSac;                 // na sačuvanim je dovoljan sam „‹ Poruke“
  el.hdrTitle.textContent = 'Ammar Bašić';
  el.hdrSub.textContent = 'Poruka dana';
  if (jeSac) crtajSacuvano();
  scrollTo({ top: 0 });
}

/* ---------- 10. TEMA ---------- */

/** Brend znak ima svijetlu i tamnu varijantu — inače nestane na papiru. */
function primijeniZnakove(tema) {
  const t = tema || document.documentElement.dataset.tema;
  const v = t === 'svijetla' ? 'b' : 'w';
  $$('img[data-znak]').forEach(i => { i.src = `/assets/brand/ammar_basic_logo_${v}_m_1.png`; });
}

function primijeniTemu() {
  const sistem = matchMedia('(prefers-color-scheme: light)').matches ? 'svijetla' : 'tamna';
  const t = stanje.autoTema ? sistem : stanje.tema;
  document.documentElement.dataset.tema = t;
  $('meta[name="theme-color"]').content = t === 'svijetla' ? '#F5F1E7' : '#0B1711';

  primijeniZnakove(t);

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

const NOTIF_MAKS = 120;

/**
 * Na telefonu se od notifikacije vidi tek red-dva, pa u nju ide samo prva
 * rečenica. Ako je i ona duža od `maks`, siječe se na granici riječi —
 * nikad usred riječi. Kad je bilo šta odsječeno, na kraj ide „…“.
 * Isto pravilo živi i u api/_lib/push.js, koji šalje prave notifikacije.
 */
function kratkaPoruka(tekst, maks = NOTIF_MAKS) {
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

  if (!skraceno) return isjecak;
  return `${isjecak.replace(/[\s.,;:!?…„“”»«—–-]+$/, '')}…`;
}

/* Test notifikacija je razvojna alatka (RAZVOJ, vidi 3b) — na objavljenoj
   verziji je nema, a endpoint /api/test je tamo takođe zatvoren. */

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
    // šaljemo i ključeve: server tako briše zapis odmah, bez prolaska kroz set
    await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys }),
    });
  } catch { /* tiho */ }
  try { await sub.unsubscribe(); } catch { /* tiho */ }
}

function opisNotif() {
  if (!notifPodrzan()) return 'Preglednik ne podržava notifikacije';
  if (trebaInstalZaPush()) return 'Prvo dodaj aplikaciju na početni ekran';
  if (Notification.permission === 'denied') return 'Blokirano u postavkama uređaja';
  return stanje.notif ? 'Uključeno' : 'Isključeno';
}

function osvjeziNotif() {
  const uklj = stanje.notif && notifPodrzan() && Notification.permission === 'granted';
  const zakljucan = trebaInstalZaPush();
  el.pNotif.setAttribute('aria-checked', String(uklj));
  el.rNotif.toggleAttribute('data-zakljucan', zakljucan);
  el.notifStanje.textContent = opisNotif();
  el.rTestNotif.hidden = !uklj || !RAZVOJ;
  el.rPonoviUvod.hidden = !RAZVOJ;
  el.notifNapomena.hidden = !uklj && !zakljucan;
  el.notifNapomena.textContent = zakljucan
    ? 'iPhone šalje notifikacije samo aplikaciji sa početnog ekrana. Dodaj je, otvori odatle i dozvoli podsjetnik.'
    : uklj
      ? (push.spreman
          ? 'Poruku dana šaljemo svaki dan u isto vrijeme.'
          : 'Dozvola je data. Dnevno slanje se uključuje kada server bude podignut.')
      : '';
}

async function prebaciNotif() {
  if (!notifPodrzan()) return poruka('Preglednik ne podržava notifikacije', 'i-info');

  // na iPhoneu iz Safari taba dozvola ne vrijedi — vodimo na instalaciju
  if (trebaInstalZaPush()) {
    poruka('Prvo dodaj aplikaciju na početni ekran', 'i-instal');
    return otvoriUputu();
  }

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
  const tijelo = kratkaPoruka(p.tekst);

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
    poruka('Test notifikacija prikazana', 'i-zvono');
  } catch {
    poruka('Notifikacija nije prikazana', 'i-info');
  }
}

/* --- instalacija --- */
/* beforeinstallprompt zna doći par stotina milisekundi nakon učitavanja, pa
   klik na red kratko počeka na događaj prije nego padne na ručnu uputu. */

let instalPrompt = null;
let cekaci = [];

const jeInstalirana = () => {
  if (simInstal) return !!simInstal.instalirano;
  return pwaSimulacija ||
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    matchMedia('(display-mode: minimal-ui)').matches ||
    navigator.standalone === true;
};

/* Bez service workera nema instalacije ni na jednoj platformi — tada se
   dugme uopšte ne nudi, umjesto da vodi u uputu koja ne može uspjeti. */
const instalMoguc = () => (simInstal ? simInstal.podrzano !== false : 'serviceWorker' in navigator);

addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  instalPrompt = e;
  cekaci.forEach(f => f(e));
  cekaci = [];
  try {
    osvjeziInstal();
    // ako uvod već stoji na koraku instalacije, sada mu možemo ponuditi dugme
    if (el.uvod?.classList.contains('on') && uvodKoraci()[uvodIdx]?.id === 'instal') crtajKorakInstal();
  } catch { /* elementi još nisu vezani */ }
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

/* Jedini ulaz u instalaciju. Red se sakriva kad je aplikacija instalirana,
   kad preglednik instalaciju ne podržava, i na računaru — dugme koje ništa
   ne može uraditi je gore od nikakvog. */
function osvjeziInstal() {
  const nema = jeInstalirana() || !instalMoguc() || okolina().desktop;
  el.rInstal.hidden = nema;
  if (nema) return;
  el.rInstal.removeAttribute('aria-disabled');
  el.instalOpis.textContent = 'Dodaj na početni ekran';
}

async function instaliraj() {
  if (jeInstalirana()) return poruka('Aplikacija je već instalirana', 'i-instal');

  /* Razvojna simulacija: pravi `beforeinstallprompt` se ne glumi — samo se
     kaže šta bi preglednik uradio, a vodič se otvara kao i na telefonu. */
  if (simInstal) {
    if (simInstal.prompt) return poruka('Simulacija: ovdje bi preglednik otvorio svoj dijalog', 'i-instal');
    return otvoriUputu(simInstal.korak || 0);
  }

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

/* ---------- 11b. VODIČ ZA INSTALACIJU ---------- */
/* Samo iPhone i Android. Na računaru instalacije nema — red se sakriva, a
   uvod ima dva ekrana (vidi `uvodWeb()`), jer podsjetnik pripada telefonu.

   Maketa je namjerno u BOJAMA SISTEMA, ne aplikacije: korisnik na svom
   ekranu traži tačno ono što mu pokazujemo, pa bi zelena kartica u našoj
   paleti odmagala. Zato je kroma preglednika vjerna — iOS sheet je tamnosiv
   sa bijelim tekstom, Chromeov meni je Chromeov — a unutra je naša stranica,
   baš kako i izgleda na pravom screenshotu.

   Uvijek tamna varijanta: postoji na svakom uređaju i sjeda na obje naše
   teme, a jedna varijanta znači pola koda i pola rizika.

   Označeno mjesto: sitan cilj (ikonica u traci, dugme potvrde) nosi zlatnu
   konturu i oblačić sa strelicom; cijeli red u listi nosi samo konturu —
   red je širok koliko i sheet, kontura ga već izdvaja, a oblačić bi gdje god
   stao pokrio susjedni red.

   Maketa je ukras (`aria-hidden` na sceni), pa svaki korak nosi naslov i
   opis: čitač ekrana i `prefers-reduced-motion` dobiju cijelu uputu bez
   ijedne animacije. */

const IKONA_APP = '/assets/icons/icon-192.png';

/**
 * Oblačić sa strelicom. Ide unutar označenog cilja, pa mu je pozicija tačna
 * gdje god cilj bio. `smjer`: 'dolje' (iznad cilja) | 'gore' (ispod cilja).
 */
const oblacic = (tekst, smjer = 'dolje', kraj = false) =>
  `<span class="oblacic oblacic--${smjer}${kraj ? ' oblacic--kraj' : ''}">${esc(tekst)}</span>`;

/** Statusna traka — sitnica po kojoj se ekran odmah čita kao telefonski. */
const status = () => `
  <div class="mstatus">
    <b>9:41</b>
    <span class="mstatus__d"><i></i><i></i><u></u></span>
  </div>`;

/** Naša stranica u malom — ovo je sadržaj, pa ostaje u našim bojama. */
const stranica = () => `
  <div class="mstrana">
    <span class="mstrana__nad"></span>
    <div class="mstrana__karta"><i></i><i></i><i></i><i></i></div>
    <div class="mstrana__izvor"><u></u><span><i></i><i></i></span></div>
  </div>`;

/* ---------- iPhone ---------- */
/* Safari na iPhoneu (iOS 15+) drži adresu i alatnu traku NA DNU — zato je
   ikonica Podijeli tamo gdje je uputa i kaže.

   `vrhMeni` mijenja gornju traku u minimalnu traku preglednika ugrađenog u
   drugu aplikaciju (Instagram/FB): X za zatvaranje lijevo, ⋯ desno — tako
   ti preglednici zaista izgledaju, na iOS-u i na Androidu podjednako, pa
   nema potrebe za posebnom Android inačicom ovog slučaja.
   `dnoMeni` mijenja zadnju ikonicu alatne trake u ⋮ — Chrome na iPhoneu (za
   razliku od Safarija) drži svoj meni tamo, ne u zasebnoj traci. */
function makIphone({ cilj = '', poziv = '', sloj = '', vrhMeni = false, dnoMeni = false } = {}) {
  const alat = (id, oznaka) => `
    <span class="ios-alat__ik${cilj === oznaka ? ' cilj' : ''}">
      ${ikona(id)}${cilj === oznaka ? poziv : ''}
    </span>`;

  const vrh = vrhMeni ? `
    <div class="ios-vrhtraka">
      ${ikona('i-x')}
      <span class="ios-vrhtraka__adr">${ikona('i-vani')}${esc(location.host)}</span>
      <span class="ios-vrhtraka__meni${cilj === 'meni' ? ' cilj' : ''}">
        ${ikona('i-meni')}${cilj === 'meni' ? poziv : ''}
      </span>
    </div>` : '';

  return `
    <div class="mak mak--ios">
      <div class="mak__ekran">
        <i class="mak__ostrvo"></i>
        ${status()}
        ${vrh}
        ${stranica()}
        <div class="ios-dno">
          <span class="ios-polje">${ikona('i-lupa')}<span>${esc(location.host)}</span></span>
          <div class="ios-alat">
            ${alat('i-nazad', 'nazad')}
            ${alat('i-strelica', 'naprijed')}
            ${alat('i-ios-dijeli', 'dijeli')}
            ${dnoMeni ? alat('i-meni', 'meni') : alat('i-knjiga', 'knjige')}
            ${alat('i-kopiraj', 'tabovi')}
          </div>
        </div>
        ${sloj}
      </div>
    </div>`;
}

/** Red u iOS listi — natpis lijevo, glif desno, kako i jeste. */
const iosRed = (tekst, ik, cilj = false) => `
  <div class="ios-red${cilj ? ' ios-red--cilj cilj cilj--red' : ''}">
    <span>${tekst}</span>${ikona(ik)}
  </div>`;

/** Kružić aplikacije u redu za dijeljenje — po njemu se sheet i prepoznaje. */
const iosApp = (ime, vrsta) => `
  <span class="ios-app">
    <i class="ios-app__ik ios-app__ik--${vrsta}"></i><span>${ime}</span>
  </span>`;

/** iOS lista dijeljenja. */
const iosSheetDijeli = () => `
  <div class="ios-sheet">
    <i class="ios-sheet__ruc"></i>
    <div class="ios-sheet__zag">
      <img src="${IKONA_APP}" alt="" width="30" height="30">
      <span class="ios-sheet__ime"><b>Poruka dana</b><span>${esc(location.host)}</span></span>
      <span class="ios-sheet__opcije">Opcije ›</span>
    </div>
    <div class="ios-apps">
      ${iosApp('AirDrop', 'airdrop')}
      ${iosApp('Poruke', 'poruke')}
      ${iosApp('Mail', 'mail')}
      ${iosApp('Više', 'vise')}
    </div>
    <div class="ios-lista">
      ${iosRed('Kopiraj', 'i-kopiraj')}
      ${iosRed('Dodaj u listu za čitanje', 'i-knjiga')}
      ${iosRed('Dodaj oznaku', 'i-zvijezda')}
      ${iosRed('Dodaj na početni ekran', 'i-plus-kv', true)}
      ${iosRed('Nađi na stranici', 'i-lupa')}
    </div>
  </div>`;

/** iOS potvrda „Na početni ekran“ — Dodaj je gore desno. */
const iosSheetPotvrda = () => `
  <div class="ios-potvrda">
    <div class="ios-potvrda__vrh">
      <span class="ios-potvrda__tiho">Otkaži</span>
      <b>Na početni ekran</b>
      <span class="ios-potvrda__ok cilj cilj--tekst">Dodaj${oblacic('Potvrdi', 'gore', true)}</span>
    </div>
    <div class="ios-potvrda__telo">
      <img src="${IKONA_APP}" alt="" width="42" height="42">
      <span class="ios-potvrda__polje"><b>Poruka dana</b><span>${esc(location.host)}</span></span>
    </div>
    <p class="ios-potvrda__nota">Na početni ekran dodat će se ikona za brz pristup ovoj stranici.</p>
  </div>
  ${pocetniEkran()}`;

/* ---------- Android ---------- */
function makAndroid({ cilj = '', poziv = '', sloj = '' } = {}) {
  return `
    <div class="mak mak--and">
      <div class="mak__ekran">
        <i class="mak__oko"></i>
        ${status()}
        <div class="and-traka">
          <span class="and-polje">${ikona('i-lupa')}<span>${esc(location.host)}</span></span>
          <span class="and-tabovi">3</span>
          <span class="and-meni-ik${cilj === 'meni' ? ' cilj' : ''}">
            ${ikona('i-meni')}${cilj === 'meni' ? poziv : ''}
          </span>
        </div>
        ${stranica()}
        ${sloj}
      </div>
    </div>`;
}

/** Red u Chromeovom meniju — ikonica lijevo, natpis desno, kako i jeste. */
const andRed = (tekst, ik, cilj = false) => `
  <div class="and-red${cilj ? ' and-red--cilj cilj cilj--red' : ''}">
    ${ikona(ik)}<span>${tekst}</span>
  </div>`;

/** Chromeov meni: red ikonica na vrhu, pa stavke — kao na pravom telefonu. */
const andMeni = () => `
  <div class="and-meni">
    <div class="and-meni__vrh">
      ${ikona('i-strelica')}${ikona('i-zvijezda')}${ikona('i-info')}${ikona('i-preuzmi')}
    </div>
    ${andRed('Nova kartica', 'i-vani')}
    ${andRed('Historija', 'i-sat')}
    ${andRed('Preuzimanja', 'i-preuzmi')}
    ${andRed('Instaliraj aplikaciju', 'i-instal', true)}
    ${andRed('Postavke', 'i-postavke')}
  </div>`;

/** Chromeov dijalog instalacije, pa ikona na početnom ekranu. */
const andDijalog = () => `
  <div class="and-dijalog">
    <div class="and-dijalog__vrh">
      <img src="${IKONA_APP}" alt="" width="38" height="38">
      <span class="and-dijalog__ime"><b>Instaliraj aplikaciju</b><span>Poruka dana</span></span>
    </div>
    <div class="and-dijalog__dug">
      <span class="and-dijalog__tiho">Otkaži</span>
      <span class="and-dijalog__ok cilj cilj--tekst">Instaliraj${oblacic('Potvrdi', 'gore', true)}</span>
    </div>
  </div>
  ${pocetniEkran()}`;

/* ---------- ishod: ikona na početnom ekranu ---------- */
/* Ciklus, a ne jednokratni prelaz: korak traži da se dodirne potvrda, pa se
   maketa mora vraćati na nju. Kad je pokret isključen, sloj ostaje sklonjen
   (`opacity: 0`) i vidi se potvrda — koja i jeste uputa ovog koraka. */
const pocetniEkran = () => `
  <div class="pocetni">
    <i></i><i></i><i></i><i></i>
    <img src="${IKONA_APP}" alt="" width="34" height="34"><i></i><i></i><i></i>
    <b>Poruka dana</b>
  </div>`;

const dugmeKopiraj = () =>
  `<button class="btn btn--obris btn--puni" id="vodic-kopiraj">${ikona('i-kopiraj')} Kopiraj adresu</button>`;

/** Koraci vodiča po platformi. Redoslijed je tačno onaj koji korisnik prolazi. */
function vodicKoraci() {
  const o = okolina();

  /* Na računaru instalacije nema — nema ni vodiča. */
  if (!o.iOS && !o.android) return [];

  /* preglednik ugrađen u Instagram/Facebook — odatle instalacije nema.
     Ta traka izgleda isto na iOS-u i Androidu, pa je maketa ista; samo je
     uređaj oko nje drugačiji, jer to korisnik i drži u ruci. */
  if (o.uApp) return [{
    naslov: 'Otvori u pravom pregledniku',
    opis: `Stranicu si otvorio unutar druge aplikacije. Dodirni ⋮ u uglu, pa
           <b>${o.iOS ? 'Otvori u Safariju' : 'Otvori u Chromeu'}</b>.`,
    scena: o.iOS
      ? makIphone({ vrhMeni: true, cilj: 'meni', poziv: oblacic('Ovdje', 'dolje', true) })
      : makAndroid({ cilj: 'meni', poziv: oblacic('Ovdje', 'gore', true) }),
    dodatno: dugmeKopiraj(),
  }];

  const iosKoraci = [
    {
      naslov: 'Dodirni Podijeli',
      opis: `Ikonica ${uIkona('i-ios-dijeli')} <b>Podijeli</b> je na dnu ekrana, u sredini.`,
      scena: makIphone({ cilj: 'dijeli', poziv: oblacic('Dodirni ovdje') }),
    },
    {
      naslov: 'Odaberi Dodaj na početni ekran',
      opis: `Otvorit će se lista. Pomjeri se malo niže i dodirni ${uIkona('i-plus-kv')} <b>Dodaj na početni ekran</b>.`,
      scena: makIphone({ sloj: iosSheetDijeli() }),
    },
    {
      naslov: 'Dodirni Dodaj',
      opis: 'Dugme <b>Dodaj</b> je u gornjem desnom uglu. Nakon toga aplikaciju pokreni s početnog ekrana.',
      scena: makIphone({ sloj: iosSheetPotvrda() }),
    },
  ];

  /* iPhone, ali nije Safari: „Dodaj na početni ekran“ ima samo Safari. Chrome
     na iPhoneu i dalje ima iOS-ov izgled (donja traka), samo mu je zadnja
     ikonica meni ⋮ umjesto tabova — ne Androidov Chrome. */
  if (o.iosDrugi) return [{
    naslov: 'Otvori u Safariju',
    opis: 'Chrome i ostali preglednici na iPhoneu nemaju „Dodaj na početni ekran“. Kopiraj adresu i zalijepi je u Safari.',
    scena: makIphone({ dnoMeni: true, cilj: 'meni', poziv: oblacic('Ovdje') }),
    dodatno: dugmeKopiraj(),
  }, ...iosKoraci];

  if (o.iOS) return iosKoraci;

  return [
    {
      naslov: 'Dodirni meni',
      opis: `Ikonica sa tri tačke ${uIkona('i-meni')} je u gornjem desnom uglu, pored adrese.`,
      scena: makAndroid({ cilj: 'meni', poziv: oblacic('Dodirni ovdje', 'gore', true) }),
    },
    {
      naslov: 'Odaberi Instaliraj aplikaciju',
      opis: 'U meniju odaberi <b>Instaliraj aplikaciju</b>. Na starijim verzijama piše <b>Dodaj na početni ekran</b>.',
      scena: makAndroid({ sloj: andMeni() }),
    },
    {
      naslov: 'Dodirni Instaliraj',
      opis: 'Preglednik traži potvrdu. Nakon toga aplikacija ima svoju ikonu i otvara se u svom prozoru.',
      scena: makAndroid({ sloj: andDijalog() }),
    },
  ];
}

let vodicIdx = 0;
let vodicSad = [];

/** Otvara vodič; `korak` služi razvojnoj simulaciji i vraćanju na isti korak. */
function otvoriUputu(korak = 0) {
  vodicSad = vodicKoraci();
  if (!vodicSad.length) return;
  vodicIdx = Math.min(Math.max(korak | 0, 0), vodicSad.length - 1);
  crtajVodic();
  otvori(el.mInstal);
}

function crtajVodic() {
  const k = vodicSad[vodicIdx];
  if (!k) return;
  const n = vodicSad.length;

  el.vodicTacke.hidden = n < 2;
  el.vodicTacke.innerHTML = vodicSad.map((_, i) => `<i class="${i === vodicIdx ? 'on' : ''}"></i>`).join('');
  el.vodicBrojac.textContent = n > 1 ? `Korak ${vodicIdx + 1} od ${n}` : 'Instalacija';
  el.vodicNaslov.textContent = k.naslov;
  el.vodicOpis.innerHTML = k.opis;
  el.vodicScena.innerHTML = k.scena;                 // novi DOM = animacija ispočetka
  el.vodicDodatno.innerHTML = k.dodatno || '';
  if (k.dodatno) vezikopiraj('#vodic-kopiraj');

  el.vodicDugmad.dataset.sam = vodicIdx === 0 ? '1' : '0';
  el.vodicDalje.innerHTML = vodicIdx === n - 1
    ? `${ikona('i-kvaka')} Razumijem`
    : `Dalje ${ikona('i-strelica')}`;
}

function vodicPomjeri(korak) {
  if (!el.mInstal.classList.contains('on')) return;
  const novi = vodicIdx + korak;
  if (novi < 0) return;
  if (novi >= vodicSad.length) return zatvoriSve();
  vodicIdx = novi;
  crtajVodic();
}

/* --- razvojna simulacija stanja instalacije (samo localhost) --- */
const SIM_STANJA = [
  { id: 'android',     ime: 'Android · native prompt', nap: 'dijalog preglednika', s: { o: { android: true }, prompt: true } },
  { id: 'android-bez', ime: 'Android · bez prompta',   nap: 'vodič ⋮ → Instaliraj', s: { o: { android: true } } },
  { id: 'ios-1',       ime: 'iPhone · korak 1',        nap: 'Podijeli',             s: { o: { iOS: true }, korak: 0 } },
  { id: 'ios-2',       ime: 'iPhone · korak 2',        nap: 'lista dijeljenja',     s: { o: { iOS: true }, korak: 1 } },
  { id: 'ios-3',       ime: 'iPhone · korak 3',        nap: 'potvrda + ekran',      s: { o: { iOS: true }, korak: 2 } },
  { id: 'ipad',        ime: 'iPad · Safari',           nap: 'Podijeli je gore',     s: { o: { iOS: true, iPad: true } } },
  { id: 'ios-chrome',  ime: 'iPhone · Chrome',         nap: 'prvo u Safari',        s: { o: { iOS: true, iosDrugi: true } } },
  { id: 'uapp',        ime: 'Instagram/FB preglednik', nap: 'otvori vani',          s: { o: { uApp: true, android: true } } },
  { id: 'racunar',     ime: 'Računar',                 nap: 'nema instalacije',     s: { o: { desktop: true } } },
  { id: 'instalirano', ime: 'Već instalirano',         nap: 'dugmeta nema',         s: { instalirano: true } },
];

function primijeniSim(id) {
  if (!RAZVOJ) return;
  const st = SIM_STANJA.find(x => x.id === id);
  simInstalId = st ? st.id : null;
  simInstal = st ? { korak: 0, ...st.s } : null;

  osvjeziInstal();
  osvjeziNotif();
  crtajSimPanel();
  el.rzPwa.setAttribute('aria-pressed', String(!!st));

  if (!st) { zatvoriSve(); return poruka('Simulacija instalacije isključena', 'i-instal'); }
  // stanja u kojima nema šta pokazati u vodiču (računar ga uopšte ne dobija)
  if (simInstal.instalirano || simInstal.podrzano === false || simInstal.prompt || simInstal.o?.desktop) {
    zatvoriSve();
    return poruka(`Simulacija: ${st.ime}`, 'i-instal');
  }
  otvoriUputu(simInstal.korak || 0);
}

/** Dok je panel otvoren traka ide iznad modala — inače stoji ispod njega. */
function pokaziSimPanel(otvori) {
  el.rzPanel.hidden = !otvori;
  if (otvori) el.razvoj.dataset.panel = '1';
  else delete el.razvoj.dataset.panel;
}

function crtajSimPanel() {
  if (!RAZVOJ) return;
  el.rzPanel.innerHTML = `
    <b>Stanja instalacije</b>
    ${SIM_STANJA.map(x => `
      <button data-sim="${x.id}" aria-pressed="${x.id === simInstalId}">
        ${esc(x.ime)}${x.nap ? `<i>${esc(x.nap)}</i>` : ''}
      </button>`).join('')}
    <button data-sim="" aria-pressed="${!simInstalId}">Bez simulacije<i>pravo stanje</i></button>`;
}

/* ---------- 12. KNJIGE ---------- */
function crtajKnjige() {
  const knjige = stanje.podaci.knjige.map(k => `
    <a class="knjiga" href="${esc(k.url || stanje.podaci.autor.knjige_url)}" target="_blank" rel="noopener">
      <img src="/assets/books/${esc(k.slika)}" alt="${esc(k.naslov)}" loading="lazy" width="112" height="168">
      <b>${esc(k.naslov)}</b>${k.podnaslov ? `<span>${esc(k.podnaslov)}</span>` : ''}
    </a>`).join('');

  $$('.traka__vrpca').forEach(v => { v.innerHTML = `<div class="traka__grupa">${knjige}</div>`; });
  $$('.traka').forEach(pokreniTraku);
}

/**
 * Traka se pomjera sama, ali kroz `scrollLeft` — dakle istim mehanizmom
 * kojim je pomjera i korisnik, pa se njih dvoje ne bore. Dodir samo
 * pauzira kretanje; kad korisnik prestane, nastavlja se odatle gdje je
 * stao. Pošto je svaka knjiga u nizu tačno jednom, na kraju se ne vraća
 * skokom nego se okrene i ide nazad.
 */
const TRAKA_BRZINA = 16;      // px u sekundi
const TRAKA_MIR    = 1800;    // koliko mirovanja treba da se kretanje nastavi
const TRAKA_STANKA = 1400;    // predah na svakom kraju

function pokreniTraku(traka) {
  if (traka.dataset.traka === '1') return;
  traka.dataset.traka = '1';

  let poz = 0, smjer = 1, pauzaDo = 0, zadnji = 0, nadMisem = false, nasPomak = -1;
  const pauziraj = (koliko = TRAKA_MIR) => { pauzaDo = performance.now() + koliko; };

  traka.addEventListener('mouseenter', () => { nadMisem = true; });
  traka.addEventListener('mouseleave', () => { nadMisem = false; });

  // Svaki scroll koji nismo izazvali mi — prst, kotačić, inercija poslije
  // dodira — pomjera sidro i odgađa kretanje.
  traka.addEventListener('scroll', () => {
    if (Math.abs(traka.scrollLeft - nasPomak) < 1) return;
    poz = traka.scrollLeft;
    nasPomak = traka.scrollLeft;
    pauziraj();
  }, { passive: true });

  ['pointerdown', 'touchstart', 'wheel', 'keydown']
    .forEach(t => traka.addEventListener(t, () => pauziraj(), { passive: true }));

  function korak(t) {
    if (!traka.isConnected) return;
    const dt = zadnji ? Math.min((t - zadnji) / 1000, 0.05) : 0;
    zadnji = t;

    const kraj = traka.scrollWidth - traka.clientWidth;

    if (kraj > 1 && !nadMisem && !vuce && t >= pauzaDo && !mirnoKretanje()) {
      poz += TRAKA_BRZINA * dt * smjer;
      if (poz >= kraj) { poz = kraj; smjer = -1; pauziraj(TRAKA_STANKA); }
      else if (poz <= 0) { poz = 0; smjer = 1; pauziraj(TRAKA_STANKA); }
      traka.scrollLeft = poz;
      nasPomak = traka.scrollLeft;            // da nam vlastiti scroll ne pauzira traku
    }
    requestAnimationFrame(korak);
  }
  requestAnimationFrame(korak);

  /* povlačenje mišem — na dodiru se native scroll ionako brine */
  let vuce = false, x0 = 0, s0 = 0, pomjeren = false;
  traka.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    vuce = true; pomjeren = false;
    x0 = e.clientX; s0 = traka.scrollLeft;
    traka.classList.add('vuce');
  });
  traka.addEventListener('pointermove', e => {
    if (!vuce) return;
    const d = e.clientX - x0;
    if (Math.abs(d) > 3) {
      if (!pomjeren) { pomjeren = true; try { traka.setPointerCapture(e.pointerId); } catch { /* nebitno */ } }
      traka.scrollLeft = s0 - d;
      poz = traka.scrollLeft;
      pauziraj();
    }
  });
  const pusti = () => { if (!vuce) return; vuce = false; traka.classList.remove('vuce'); pauziraj(); };
  traka.addEventListener('pointerup', pusti);
  traka.addEventListener('pointercancel', pusti);
  traka.addEventListener('click', e => { if (pomjeren) { e.preventDefault(); e.stopPropagation(); } }, true);
}

/* --- veze na autorove kanale --- */
const VEZA_IKONA = { web: 'i-web', facebook: 'i-facebook', instagram: 'i-instagram' };

function crtajVeze() {
  const mreze = stanje.podaci.autor.mreze;
  if (!el.veze) return;
  if (!Array.isArray(mreze) || !mreze.length) { el.veze.innerHTML = ''; return; }

  el.veze.innerHTML = mreze.map(m => {
    const ik = `<span class="veza__ikona">${ikona(VEZA_IKONA[m.vrsta] || 'i-web')}</span>`;
    const pecat = m.ovjeren
      ? `<svg class="veza__ovjera" aria-hidden="true"><use href="#i-ovjera"/></svg>` : '';
    const ime = `<span class="veza__ime"><b>${esc(m.naziv)}</b>${pecat}</span>`;
    const opis = `${m.opis || ''} — ${m.naziv}`.replace(/^ — /, '');
    // bez adrese kanal se i dalje vidi, ali nije link
    return m.url
      ? `<a class="veza" href="${esc(m.url)}" target="_blank" rel="noopener" title="${esc(opis)}">${ik}${ime}</a>`
      : `<span class="veza veza--bez" title="${esc(opis)}">${ik}${ime}</span>`;
  }).join('');
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

/** Arabeskni ugao sa zaobljenim prelazom. */
function ugaoOrnament(c, x, y, sx, sy, u) {
  c.beginPath();
  c.moveTo(x + sx * u, y);
  c.lineTo(x + sx * u * 0.4, y);
  c.quadraticCurveTo(x, y, x, y + sy * u * 0.4);
  c.lineTo(x, y + sy * u);
  c.stroke();
}

/**
 * Slika za dijeljenje.
 * Slog ide u tri pojasa — zaglavlje (datum, hidžri, brend znak), citat i
 * podnožje (knjiga, poglavlje, autor). Zaglavlje se gradi odozgo, podnožje
 * odozdo, a citat se auto-uklapa u ono što ostane između. Svi razmaci su
 * udio širine, pa svaki format drži isti ritam.
 */
async function nacrtajPlatno() {
  const f = FORMATI.find(x => x.id === stanje.format) || FORMATI[1];
  const s = STILOVI.find(x => x.id === stanje.stil) || STILOVI[0];
  const p = porukaZa(stanje.datum);
  const k = knjigaPo(p.knjiga);

  // znak se učitava prije crtanja da se slog ne mijenja naknadno
  let znak = null;
  try { znak = await ucitajSliku(`/assets/brand/ammar_basic_logo_${s.logo}_m_1.png`); } catch { /* bez znaka */ }

  el.platno.width = f.w;
  el.platno.height = f.h;
  dimenzionirajPregled(f);

  const c = el.platno.getContext('2d');
  const W = f.w, H = f.h;
  const odnos = H / W;

  /* --- podloga --- */
  const grad = c.createLinearGradient(0, 0, W * 0.35, H);
  grad.addColorStop(0, s.bg[0]);
  grad.addColorStop(1, s.bg[1]);
  c.fillStyle = grad;
  c.fillRect(0, 0, W, H);

  // topli sjaj pri vrhu i tiha sjena pri dnu daju dubinu
  const sjaj = c.createRadialGradient(W / 2, H * 0.18, 0, W / 2, H * 0.18, W * 0.9);
  sjaj.addColorStop(0, `${s.gold}26`);
  sjaj.addColorStop(1, 'transparent');
  c.fillStyle = sjaj;
  c.fillRect(0, 0, W, H);

  const dubina = c.createLinearGradient(0, H * 0.62, 0, H);
  dubina.addColorStop(0, 'transparent');
  dubina.addColorStop(1, `${s.bg[1]}66`);
  c.fillStyle = dubina;
  c.fillRect(0, H * 0.62, W, H * 0.38);

  /* --- dvostruki okvir i arabeskni uglovi --- */
  const m  = W * 0.062;
  const m2 = m + W * 0.016;
  c.strokeStyle = `${s.gold}33`;
  c.lineWidth = Math.max(1.2, W * 0.0013);
  c.strokeRect(m, m, W - m * 2, H - m * 2);
  c.strokeStyle = `${s.gold}1C`;
  c.strokeRect(m2, m2, W - m2 * 2, H - m2 * 2);

  c.strokeStyle = `${s.gold}A8`;
  c.lineWidth = W * 0.0032;
  const u = W * 0.052;
  ugaoOrnament(c, m, m, 1, 1, u);
  ugaoOrnament(c, W - m, m, -1, 1, u);
  ugaoOrnament(c, m, H - m, 1, -1, u);
  ugaoOrnament(c, W - m, H - m, -1, -1, u);

  c.textAlign = 'center';
  c.textBaseline = 'middle';

  /* --- ritam: uži formati traže manje zraka, viši više --- */
  const zrak = W * (odnos < 1.1 ? 0.034 : odnos < 1.5 ? 0.056 : 0.092);
  const F = {
    dat:       W * 0.0215,
    hidzri:    W * 0.0280,
    nad:       W * 0.0165,
    naslov:    W * 0.0390,
    poglavlje: W * 0.0260,
    autor:     W * 0.0250,
  };
  const znakP = W * 0.092;                    // brend znak — nasljeđuje mjesto zvjezdice

  /* --- zaglavlje, odozgo --- */
  let y = m2 + zrak;

  y += F.dat / 2;
  c.fillStyle = s.gold;
  c.save();
  // dan + datum u jednom redu; ako je red predug, slog se sabije da stane
  const zaglavlje = `${naziviDana(stanje.datum)} · ${punDatum(stanje.datum)}`.toUpperCase();
  let fDat = F.dat, razmak = W * 0.0072;
  for (;;) {
    c.font = `700 ${fDat}px ${SANS}`;
    c.letterSpacing = `${razmak}px`;
    if (c.measureText(zaglavlje).width <= W * 0.80 || fDat <= W * 0.014) break;
    fDat -= W * 0.0008; razmak *= 0.94;
  }
  c.fillText(zaglavlje, W / 2, y);
  c.restore();
  y += F.dat / 2;

  const hDat = hidzri(stanje.datum);
  if (hDat) {
    y += W * 0.030 + F.hidzri / 2;
    c.fillStyle = `${s.ink}82`;
    c.font = `italic 400 ${F.hidzri}px ${SERIF}`;
    c.fillText(hDat, W / 2, y);
    y += F.hidzri / 2;
  }

  // razdjelnik: linija — brend znak — linija
  y += W * 0.042 + znakP / 2;
  const poluL = znakP / 2 + W * 0.034;        // linije se drže dalje od znaka
  c.strokeStyle = `${s.gold}45`;
  c.lineWidth = Math.max(1.2, W * 0.0013);
  c.beginPath();
  c.moveTo(W / 2 - W * 0.215, y); c.lineTo(W / 2 - poluL, y);
  c.moveTo(W / 2 + poluL, y);     c.lineTo(W / 2 + W * 0.215, y);
  c.stroke();
  if (znak) {
    c.globalAlpha = 0.95;
    c.drawImage(znak, W / 2 - znakP / 2, y - znakP / 2, znakP, znakP);
    c.globalAlpha = 1;
  }
  y += znakP / 2;

  const gornja = y + zrak * 1.15;

  /* --- podnožje, odozdo --- */
  let b = H - m2 - zrak;

  b -= F.autor / 2;
  c.fillStyle = `${s.ink}9E`;
  c.font = `400 ${F.autor}px ${SERIF}`;
  c.fillText(stanje.podaci.autor.ime, W / 2, b);
  b -= F.autor / 2;

  const poglavlje = p.poglavlje || p.tema;
  if (poglavlje) {
    b -= W * 0.034 + F.poglavlje / 2;
    c.fillStyle = `${s.gold}D0`;
    c.font = `italic 400 ${F.poglavlje}px ${SERIF}`;
    c.fillText(poglavlje, W / 2, b);
    b -= F.poglavlje / 2;
  }

  if (k) {
    b -= W * 0.030 + F.naslov / 2;
    c.fillStyle = s.ink;
    c.font = `500 ${F.naslov}px ${SERIF}`;
    c.fillText(k.naslov, W / 2, b);
    b -= F.naslov / 2;

    b -= W * 0.026 + F.nad / 2;
    c.fillStyle = `${s.ink}75`;
    c.font = `700 ${F.nad}px ${SANS}`;
    c.save();
    c.letterSpacing = `${W * 0.0085}px`;
    c.fillText('IZ KNJIGE', W / 2, b);
    c.restore();
    b -= F.nad / 2;
  }

  // kratka crtica koja odvaja citat od podnožja
  b -= W * 0.046;
  c.strokeStyle = `${s.gold}40`;
  c.lineWidth = Math.max(1.2, W * 0.0013);
  c.beginPath();
  c.moveTo(W / 2 - W * 0.055, b); c.lineTo(W / 2 + W * 0.055, b);
  c.stroke();

  const donja = b - zrak * 1.15;

  /* --- citat: auto-fit u ono što je ostalo --- */
  const maxW = W * 0.70;
  const prostor = Math.max(W * 0.2, donja - gornja);

  let fs = Math.round(W * 0.062), redovi, lh;
  for (;;) {
    c.font = `400 ${fs}px ${SERIF}`;
    redovi = lomiTekst(c, p.tekst, maxW);
    lh = fs * 1.52;
    if (redovi.length * lh <= prostor || fs <= W * 0.021) break;
    fs -= Math.max(1, Math.round(W * 0.0018));
  }

  const visinaBloka = (redovi.length - 1) * lh;
  const yPrvi = (gornja + donja) / 2 - visinaBloka / 2;

  // navodnici se vežu za okvir bloka teksta, ne za pojedini red —
  // tako ne mogu naletjeti na tekst bez obzira na dužinu poruke
  const blokW = Math.min(maxW, Math.max(...redovi.map(r => c.measureText(r).width)));
  const xL = W / 2 - blokW / 2;
  const xR = W / 2 + blokW / 2;
  const yZadnji = yPrvi + visinaBloka;
  const Fq = fs * 2.4;

  c.save();
  c.textBaseline = 'top';
  c.font = `700 ${Fq}px ${DISPLAY}`;
  c.fillStyle = `${s.navod}52`;
  c.textAlign = 'right';
  c.fillText('“', xL - fs * 0.24, yPrvi - fs * 0.38 - Fq * 0.25);
  c.textAlign = 'left';
  c.fillText('”', xR + fs * 0.24, yZadnji + fs * 0.48 - Fq * 0.25);
  c.restore();

  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = s.ink;
  c.font = `400 ${fs}px ${SERIF}`;
  redovi.forEach((r, i) => c.fillText(r, W / 2, yPrvi + i * lh));
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
  resetPocetno();                     // potvrda brisanja se ne nosi u sljedeće otvaranje
}

async function otvoriDijeljenje() {
  crtajKontrole();
  otvori(el.mDijeli);
  try {
    await Promise.all([
      document.fonts?.load(`400 80px ${SERIF}`),
      document.fonts?.load(`700 40px ${SANS}`),
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
    <div class="razdjelnik razdjelnik--znak" aria-hidden="true"><i></i>
      <img class="razdjelnik__znak" data-znak src="/assets/brand/ammar_basic_logo_w_m_1.png" alt="" width="40" height="40">
    <i></i></div>
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

  primijeniZnakove();
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
/* Dva toka, vidi uvodWeb() / UVOD_PWA. U pregledniku vodimo korisnika do
   početnog ekrana; dozvolu za notifikacije tražimo tek u aplikaciji.
   Ako ovaj korak padne, sve ostalo pada s njim — zato su upute po
   uređaju i pregledniku, a ne jedna generička. */

let uvodIdx = 0;
let uvodTok = 'web';                                   // 'web' | 'pwa'

const uvodKoraci = () => (uvodTok === 'pwa' ? UVOD_PWA : uvodWeb());

const notifPodrzan = () => 'Notification' in window;
const notifStanjeSad = () => (notifPodrzan() ? Notification.permission : 'nepodrzano');
const pushPodrzan = () => 'PushManager' in window && 'serviceWorker' in navigator;

/** Na iPhoneu push radi tek kad je aplikacija na početnom ekranu. */
const trebaInstalZaPush = () => okolina().iOS && !jeInstalirana();

/** Preglednik i platforma — upute moraju biti tačne, ne približne. */
function okolina() {
  const ua = navigator.userAgent;
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const iOS = /iPad|iPhone|iPod/.test(ua) || iPadOS;
  const android = /Android/.test(ua);
  // preglednik ugrađen u drugu aplikaciju (Instagram, Facebook…) — odatle se
  // ne može instalirati, a većina korisnika baš tako i otvori link
  const uApp = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Line\/|Twitter|WhatsApp|Snapchat|TikTok|Viber|MicroMessenger|GSA\//i.test(ua);
  // na iPhoneu „Dodaj na početni ekran“ ima samo Safari
  const iosDrugi = iOS && /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(ua);
  if (simInstal?.o) return { ...OKOLINA_NULE, ...simInstal.o };
  return { iOS, android, uApp, iosDrugi,
           iPad: /iPad/.test(ua) || iPadOS, desktop: !iOS && !android };
}

const OKOLINA_NULE = { iOS: false, android: false, uApp: false, iosDrugi: false,
                       iPad: false, desktop: false };

const stanjeOk   = t => `<span class="uvod__stanje uvod__stanje--ok">${ikona('i-kvaka')} ${t}</span>`;
const stanjePazi = t => `<span class="uvod__stanje uvod__stanje--pazi">${ikona('i-pazi')} ${t}</span>`;

/** Numerisani koraci; svaki može imati ikonicu ispred teksta. */
const koraciHtml = koraci => `<ol class="koraci koraci--uvod">${koraci.map((k, i) => `
  <li class="korak"><span class="korak__br">${i + 1}</span><p>${k}</p></li>`).join('')}</ol>`;

function crtajUvod() {
  const koraci = uvodKoraci();
  const k = koraci[uvodIdx];
  el.uvodNas.textContent = k.n;
  el.uvodTekst.textContent = k.t;

  const blok = el.uvodNas.parentElement;
  blok.classList.remove('uvod__blok');
  void blok.offsetWidth;                               // restart animacije
  blok.classList.add('uvod__blok');

  el.uvodTacke.innerHTML = koraci.map((_, i) => `<i class="${i === uvodIdx ? 'on' : ''}"></i>`).join('');

  el.uvodSadrzaj.innerHTML = '';
  el.uvodDalje.disabled = false;
  el.uvodDalje.hidden = false;
  el.uvodPreskoci.hidden = true;
  el.uvodPreskoci.onclick = null;
  el.uvodPreskoci.textContent = 'Preskoči za sada';

  if (k.id === 'instal')        crtajKorakInstal();
  else if (k.id === 'notif')    crtajKorakNotif();
  else if (k.id === 'tema')     crtajIzborTeme();
  else if (k.id === 'gotovo')   crtajKorakGotovo();
  else if (k.id === 'kraj')     crtajKorakKraj();
  else el.uvodDalje.textContent = 'Dalje';
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
  el.uvodDalje.textContent = 'Dalje';

  $('#tema-izbor').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const izbor = b.dataset.izbor;
    stanje.autoTema = izbor === 'auto';
    pisi(LS.autoTema, stanje.autoTema);
    if (!stanje.autoTema) { stanje.tema = izbor; pisi(LS.tema, izbor); }
    primijeniTemu();
    crtajIzborTeme();
  });
}

/* --- korak: instalacija (samo u WEB toku, samo telefon) --- */
/* Ovo je korak koji ne pušta dalje. Gdje preglednik nudi svoj dijalog
   (Android Chrome) zovemo ga direktno; gdje ga nema (iPhone) stoji maketa
   sa označenim mjestom i kratka lista, pa korisnik sam potvrdi.

   Maketa pokazuje onaj trenutak u kojem se ljudi izgube — otvorenu listu sa
   označenim redom — a ne prvi dodir, koji je i bez slike očit.

   Sve stoji na jednom ekranu, bez koračanja kroz maketu: korisnik odlazi iz
   preglednika da ovo izvede, a čim otvori listu dijeljenja naša stranica je
   pokrivena i „Dalje“ nema ko stisnuti. Cijelu uputu zato mora vidjeti
   prije nego krene. Vodič korak-po-korak ostaje u postavkama.

   Ovo je i zadnji ekran uvoda u pregledniku: dozvola za podsjetnik se traži
   kad se aplikacija prvi put otvori sa početnog ekrana (tok `pwa`). */

const dodanoRucno = () => cita(LS.dodano, false) === true;

/** Maketa unutar koraka uvoda — ukras, uputa je u tekstu ispod. */
const uvodScena = html => `<div class="uvod__scena" aria-hidden="true">${html}</div>`;

function crtajKorakInstal() {
  const o = okolina();

  /* Već dodano — nema šta pokazati. Ide `naprijed()`, ne `uvodIdx++`: instal je
     sad zadnji korak, pa ručno uvećavanje izađe iz liste i `crtajUvod` pukne. */
  if (jeInstalirana() || dodanoRucno()) { naprijed(); return; }

  /* preglednik ugrađen u Instagram/Facebook — odatle se ne može instalirati */
  if (o.uApp && !okolinaOverride) {
    el.uvodSadrzaj.innerHTML = `
      ${stanjePazi('Otvori u pravom pregledniku')}
      <p class="uvod__nota">Stranicu si otvorio unutar druge aplikacije. Odatle se
        ne može dodati na početni ekran.</p>
      ${koraciHtml([
        'Dodirni <b>⋯</b> ili <b>⋮</b> u uglu ekrana.',
        `Odaberi <b>${o.iOS ? 'Otvori u Safariju' : 'Otvori u Chromeu'}</b>.`,
        'Vrati se na ovaj korak kad se stranica otvori.',
      ])}
      ${dugmeKopirajAdresu()}`;
    vezikopiraj();
    el.uvodDalje.hidden = true;
    izlazAkoPogresnaDetekcija();
    return;
  }

  /* iPhone, ali nije Safari — samo Safari ume dodati na ekran */
  if (o.iosDrugi && !okolinaOverride) {
    el.uvodSadrzaj.innerHTML = `
      ${stanjePazi('Na iPhoneu ovo može samo Safari')}
      <p class="uvod__nota">Chrome i ostali preglednici na iPhoneu nemaju
        „Dodaj na početni ekran“.</p>
      ${koraciHtml([
        'Kopiraj adresu dugmetom ispod.',
        'Otvori <b>Safari</b> i zalijepi je u traku.',
        'Nastavi po uputi koja te tamo dočeka.',
      ])}
      ${dugmeKopirajAdresu()}`;
    vezikopiraj();
    el.uvodDalje.hidden = true;
    izlazAkoPogresnaDetekcija();
    return;
  }

  /* iPhone / iPad, Safari — nema API-ja, ide maketa pa tačne upute */
  if (o.iOS) {
    el.uvodSadrzaj.innerHTML = `
      ${uvodScena(makIphone({ sloj: iosSheetDijeli() }))}
      ${koraciHtml([
        `Dodirni ${uIkona('i-ios-dijeli')} <b>Podijeli</b> ${o.iPad ? 'gore desno' : 'na dnu ekrana'}.`,
        `Pomjeri se niz listu do ${uIkona('i-plus-kv')} <b>Dodaj na početni ekran</b>.`,
        'Dodirni <b>Dodaj</b> u gornjem desnom uglu.',
      ])}
      ${zadnjiRed()}`;
    el.uvodDalje.textContent = 'Dodao sam';
    return;
  }

  /* Android — preglednik najčešće ima svoj dijalog, jedan dodir i gotovo */
  if (instalPrompt) {
    el.uvodSadrzaj.innerHTML = `
      <p class="uvod__nota">Dodirni dugme ispod i potvrdi u prozoru koji se otvori.</p>`;
    el.uvodDalje.textContent = 'Dodaj na početni ekran';
    return;
  }

  /* Android bez dijaloga — ide kroz meni preglednika */
  el.uvodSadrzaj.innerHTML = `
    ${uvodScena(makAndroid({ sloj: andMeni() }))}
    ${koraciHtml([
      `Dodirni ikonicu sa tri tačke ${uIkona('i-meni')} u gornjem desnom uglu.`,
      'Odaberi <b>Instaliraj aplikaciju</b>.',
      'Dodirni <b>Instaliraj</b> za potvrdu.',
    ])}
    ${zadnjiRed()}`;
  el.uvodDalje.textContent = 'Dodao sam';
}

/* Uputa koja je prije bila cijeli peti ekran („Otvori aplikaciju“). Jedan red
   na kraju liste radi isti posao, a uvod je kraći za jedan ekran. */
const zadnjiRed = () => `
  <p class="uvod__nota">Aplikaciju zatim pokreni s početnog ekrana —
    podsjetnik se uključuje unutar nje.</p>`;

/* --- korak: kraj uvoda na računaru --- */
/* Na računaru se aplikacija ne instalira, pa uvod tu i završava. Podsjetnik
   ostaje dostupan u postavkama — samo mu je mjesto na telefonu, gdje se
   poruka i čita. */
function crtajKorakKraj() {
  el.uvodSadrzaj.innerHTML = `
    <p class="uvod__nota">Podsjetnik radi na telefonu. Otvori ovu adresu na telefonu
      i dodaj aplikaciju na početni ekran. Ovdje možeš čitati i bez podsjetnika, a
      uključiti ga možeš u postavkama.</p>
    ${dugmeKopirajAdresu()}`;
  vezikopiraj();
  el.uvodDalje.textContent = 'Uđi u aplikaciju';
}

/** Zadnja brana: ako smo pogrešno prepoznali preglednik, korisnik ne smije
    ostati na koraku bez ijednog izlaza. */
function izlazAkoPogresnaDetekcija() {
  el.uvodPreskoci.hidden = false;
  el.uvodPreskoci.textContent = 'Ovdje mogu dodati na ekran';
  el.uvodPreskoci.onclick = () => {
    el.uvodPreskoci.onclick = null;
    okolinaOverride = true;
    crtajKorakInstal();
  };
}

let okolinaOverride = false;

const dugmeKopirajAdresu = () =>
  `<button class="btn btn--obris btn--puni" id="uvod-kopiraj">${ikona('i-kopiraj')} Kopiraj adresu</button>`;

/** Ikonica unutar rečenice — onakva kakvu korisnik traži na ekranu. */
const uIkona = id => `<span class="korak__ik">${ikona(id)}</span>`;

function vezikopiraj(sel = '#uvod-kopiraj') {
  $(sel)?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      poruka('Adresa kopirana', 'i-kopiraj');
    } catch { poruka('Kopiranje nije uspjelo', 'i-info'); }
  });
}

/* --- korak: notifikacije (samo u PWA toku) --- */
function crtajKorakNotif() {
  const o = okolina();

  if (!notifPodrzan() || !pushPodrzan()) {
    el.uvodSadrzaj.innerHTML = o.iOS
      ? `${stanjePazi('Potreban je noviji iOS')}
         <p class="uvod__nota">Podsjetnici na iPhoneu rade od <b>iOS-a 16.4</b>.
           Ažuriraj sistem pa ih uključi u postavkama aplikacije.</p>`
      : `${stanjePazi('Uređaj ne podržava podsjetnike')}
         <p class="uvod__nota">Aplikacija radi normalno, samo bez dnevne notifikacije.</p>`;
    el.uvodDalje.textContent = 'Nastavi';
    return;
  }

  const d = notifStanjeSad();

  if (d === 'granted') {
    el.uvodSadrzaj.innerHTML = stanjeOk('Podsjetnik je uključen');
    el.uvodDalje.textContent = 'Dalje';
    return;
  }

  if (d === 'denied') {
    const putanja = o.iOS
      ? 'Postavke → Notifikacije → <b>Poruka dana</b> → uključi <b>Dozvoli obavijesti</b>'
      : o.android
        ? 'Postavke → Aplikacije → <b>Poruka dana</b> → Notifikacije → uključi'
        : 'Klikni katanac lijevo od adrese → Notifikacije → <b>Dozvoli</b>';
    el.uvodSadrzaj.innerHTML = `
      ${stanjePazi('Notifikacije su blokirane')}
      <p class="uvod__nota">Dozvola je odbijena, pa je aplikacija više ne može tražiti.</p>
      ${koraciHtml([putanja, 'Vrati se u aplikaciju — podsjetnik radi odmah.'])}`;
    el.uvodDalje.textContent = 'Nastavi bez podsjetnika';
    return;
  }

  el.uvodSadrzaj.innerHTML = `
    <p class="uvod__nota">Kad dodirneš dugme, ${o.iOS ? 'iPhone' : o.android ? 'telefon' : 'preglednik'}
      će pitati dozvoljavaš li obavijesti. Odaberi <b>Dozvoli</b>.</p>`;
  el.uvodDalje.textContent = 'Dozvoli notifikacije';
}

/* --- korak: zadnji podsjetnik --- */
function crtajKorakGotovo() {
  const uklj = notifStanjeSad() === 'granted';
  el.uvodSadrzaj.innerHTML = uklj
    ? `${stanjeOk('Podsjetnik radi')}
       <p class="uvod__nota">Jedna poruka dnevno, u isto vrijeme. Možeš je isključiti
         u postavkama kad god poželiš.</p>`
    : `<p class="uvod__nota">Podsjetnik nije uključen, pa poruku otvaraj sam.
         Uključiti ga možeš bilo kada u postavkama.</p>`;
  el.uvodDalje.textContent = 'Uđi u aplikaciju';
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

/* --- kretanje kroz korake --- */
function naprijed() {
  el.uvodPreskoci.onclick = null;
  if (uvodIdx < uvodKoraci().length - 1) { uvodIdx++; crtajUvod(); }
  else zavrsiUvod();
}

async function uvodDalje() {
  const k = uvodKoraci()[uvodIdx];

  if (k.id === 'notif' && notifPodrzan() && pushPodrzan() && notifStanjeSad() === 'default') {
    await uvodTraziNotif();
    return;                                            // ostajemo na koraku
  }

  if (k.id === 'instal' && !jeInstalirana()) {
    if (instalPrompt) {                                // preglednik ima svoj dijalog
      await instaliraj();
      crtajKorakInstal();
      return;
    }
    pisi(LS.dodano, true);                             // korisnik potvrdio da je dodao
  }

  naprijed();
}

function zavrsiUvod() {
  pisi(uvodTok === 'pwa' ? LS.uvodPwa : LS.uvod, UVOD_VERZIJA);
  if (uvodTok === 'pwa') pisi(LS.dodano, true);
  el.uvod.classList.remove('on');
  el.uvod.setAttribute('aria-hidden', 'true');
  osvjeziNotif();
  osvjeziInstal();
}

function pokreniUvod(tok) {
  uvodTok = tok;
  uvodIdx = 0;
  crtajUvod();
  el.uvod.classList.add('on');
  el.uvod.setAttribute('aria-hidden', 'false');
}

/** Instalacija se može desiti dok je uvod otvoren — korak to odmah pokaže. */
addEventListener('appinstalled', () => {
  pisi(LS.dodano, true);
  if (el.uvod?.classList.contains('on') && uvodKoraci()[uvodIdx]?.id === 'instal') crtajKorakInstal();
});

/* ---------- 17. NADOGRADNJA I RESET ---------- */
/* Aplikacija se ne smije mijenjati korisniku pod rukom, pa novi service
   worker stoji u stanju „waiting“ dok se ne potvrdi (vidi sw.js). Traka na
   dnu ekrana i red u postavkama nude instalaciju; kada novi worker preuzme
   kontrolu, stranica se osvježi i radi na novoj verziji. */

let swReg = null;
let nadogradnjaKrenula = false;

function pokaziNadogradnju() {
  if (nadogradnjaKrenula) return;
  if (el.rNadogradnja) el.rNadogradnja.hidden = false;
  if (!el.nadogradnja) return;
  el.nadogradnja.hidden = false;
  // toast i razvojna traka se dižu iznad trake, da se ne poklope
  document.documentElement.dataset.nadogradnja = '1';
}

function sakrijNadogradnju() {
  el.nadogradnja.hidden = true;
  delete document.documentElement.dataset.nadogradnja;
}

function instalirajNadogradnju() {
  const ceka = swReg?.waiting;
  if (!ceka) return location.reload();

  nadogradnjaKrenula = true;
  el.nvInstaliraj.disabled = true;
  el.nadogradnjaOpis.textContent = 'Instaliram novu verziju…';
  ceka.postMessage({ tip: 'PRESKOCI_CEKANJE' });

  // ako `controllerchange` ne dođe (stariji WebKit), osvježi ipak
  setTimeout(() => location.reload(), 3500);
}

function postaviServiceWorker() {
  if (!('serviceWorker' in navigator) || resetUToku) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (nadogradnjaKrenula) location.reload();
  });

  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then(reg => {
      swReg = reg;

      // novi worker je preuzet u nekom ranijem otvaranju i još čeka
      if (reg.waiting && navigator.serviceWorker.controller) pokaziNadogradnju();

      reg.addEventListener('updatefound', () => {
        const novi = reg.installing;
        if (!novi) return;
        novi.addEventListener('statechange', () => {
          // bez kontrolera ovo je prva instalacija, a ne nadogradnja
          if (novi.state === 'installed' && navigator.serviceWorker.controller) pokaziNadogradnju();
        });
      });

      /* Instalirana aplikacija se zna držati otvorena danima, a i sam
         preglednik provjerava sw.js samo pri navigaciji — zato provjeru
         tražimo sami, pri svakom vraćanju u aplikaciju i periodično. */
      const provjeri = () => { try { reg.update(); } catch { /* tiho */ } };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') provjeri();
      });
      setInterval(provjeri, 30 * 60 * 1000);
    })
    .catch(() => { /* bez service workera aplikacija radi, samo bez offlinea */ });
}

/** Koja je verzija keša aktivna na ovom uređaju — ide pored verzije aplikacije. */
function verzijaKesa() {
  return new Promise(daj => {
    const sw = navigator.serviceWorker?.controller;
    if (!sw) return daj(null);
    const kanal = new MessageChannel();
    const kraj = setTimeout(() => daj(null), 900);
    kanal.port1.onmessage = e => { clearTimeout(kraj); daj(e.data?.verzija || null); };
    try { sw.postMessage({ tip: 'VERZIJA' }, [kanal.port2]); }
    catch { clearTimeout(kraj); daj(null); }
  });
}

function ispisiVerziju(kes) {
  $('#verzija').textContent = kes ? `Verzija ${VERZIJA} · keš ${kes}` : `Verzija ${VERZIJA}`;
}

/* --- brisanje aplikacije sa uređaja --- */
/* Instalirana aplikacija na iPhoneu ima svoj prostor, odvojen od Safarija,
   pa ?reset iz preglednika ne dodiruje njene podatke. Zato dugme živi u
   postavkama same aplikacije: skida service worker, keš i sve zapise, tako
   da se pri sljedećem otvaranju sve preuzme ispočetka. */

async function ocistiUredjaj() {
  resetUToku = true;

  try { await odjaviPush(); } catch { /* tiho */ }

  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map(r => r.unregister().catch(() => false)));
  } catch { /* tiho */ }

  try {
    const imena = await caches.keys();
    await Promise.all(imena.map(n => caches.delete(n).catch(() => false)));
  } catch { /* tiho */ }

  try {
    const svi = new Set([...Object.keys(localStorage).filter(k => k.startsWith('pd.')), ...Object.values(LS)]);
    svi.forEach(k => localStorage.removeItem(k));
  } catch { /* private mode */ }
}

const RESET_NAS  = 'Obriši verziju sa ovog uređaja';
const RESET_OPIS = 'Briše keširanu verziju i sve zapise — aplikacija se instalira ispočetka';

let resetPotvrda = 0;

function resetPocetno() {
  if (!el.rReset) return;
  clearTimeout(resetPotvrda);
  resetPotvrda = 0;
  el.rReset.removeAttribute('data-potvrda');
  el.rResetNas.textContent = RESET_NAS;
  el.rResetOpis.textContent = RESET_OPIS;
  el.resetNapomena.hidden = true;
}

/** Dva dodira: prvi traži potvrdu, drugi briše. Potvrda sama istekne. */
async function naReset() {
  if (!resetPotvrda) {
    el.rReset.dataset.potvrda = '1';
    el.rResetNas.textContent = 'Potvrdi brisanje';
    el.rResetOpis.textContent = 'Dodirni još jednom — nema vraćanja';
    el.resetNapomena.hidden = false;
    el.resetNapomena.textContent = 'Brišu se sačuvane poruke, podsjetnik i keširana verzija. '
      + 'Ikona ostaje na početnom ekranu; kad je otvoriš, aplikacija se preuzima ispočetka.';
    resetPotvrda = setTimeout(resetPocetno, 6000);
    return;
  }

  clearTimeout(resetPotvrda);
  el.rReset.setAttribute('aria-disabled', 'true');
  el.rResetNas.textContent = 'Brišem…';
  el.rResetOpis.textContent = 'Aplikacija se ponovo učitava';
  await ocistiUredjaj();
  location.replace(location.pathname);
}

/* --- razvojna traka: pomjeranje dana (samo localhost) --- */
/* Uz strelice na tastaturi i swipe po kartici, ovdje su dugmad i ispis koja
   je poruka po redu — tako se odmah vidi i da se knjige ne ponavljaju.

   Dugmad ne animiraju karticu: animacija traje ~0,7 s i pojede svaki brzi
   klik, a kroz cijelu listu se prolazi upravo brzim klikanjem. Strelice i
   swipe rade kao i prije, sa animacijom. */
function razvojDan(korak) {
  const novi = new Date(stanje.datum);
  if (korak) novi.setDate(novi.getDate() + korak);
  stanje.datum = korak ? novi : danasnji();
  prikaziDan(false);
}

function osvjeziRazvoj() {
  if (!RAZVOJ || !el.razvoj || !stanje.podaci) return;

  const d = stanje.datum;
  const p = porukaZa(d);
  const k = knjigaPo(p.knjiga);
  const n = stanje.podaci.poruke.length;
  const i = stanje.podaci.poruke.indexOf(p) + 1;
  const razlika = brojDana(d) - brojDana(danasnji());
  const pomak = razlika === 0 ? 'danas' : `${razlika > 0 ? '+' : '−'}${Math.abs(razlika)}`;

  el.rzInfo.innerHTML = `<b>${esc(kratkiDatum(d))} · ${esc(pomak)}</b>`
    + esc(`${i}/${n} · #${p.id} · ${k ? k.naslov : '—'}`);
  el.rzDanas.disabled = razlika === 0;
}

/* ---------- 18. START ---------- */
function vezi() {
  Object.assign(el, {
    dan: $('#d-dan'), danTekst: $('#d-dan-tekst'), datum: $('#d-datum'), hidzri: $('#d-hidzri'),
    tekst: $('#k-tekst'), knjiga: $('#k-knjiga'), tema: $('#k-tema'),
    citat: $('#citat'),
    cover: $('#k-cover'), izvor: $('#k-izvor'), karta: $('#karta'),
    danDanas: $('#dan-danas'),
    fav: $('#a-fav'), favTekst: $('#a-fav-tekst'),
    hdrNazad: $('#btn-nazad'), hdrMark: $('#hdr-mark'),
    hdrTitle: $('#hdr-title'), hdrSub: $('#hdr-sub'), hdrIme: $('.hdr__ime'),
    btnSacuvano: $('#btn-sacuvano'), brojSac: $('#broj-sac'),
    listaSac: $('#lista-sacuvano'), veze: $('#veze'),
    pretragaSac: $('#pretraga-sac'), pretragaX: $('#pretraga-x'),
    pAuto: $('#p-auto'), rTema: $('#r-tema'),
    rNotif: $('#r-notif'), pNotif: $('#p-notif'), notifStanje: $('#r-notif-stanje'),
    notifNapomena: $('#notif-napomena'), rTestNotif: $('#r-test-notif'),
    rInstal: $('#r-instal'), instalOpis: $('#r-instal-opis'),
    rPonoviUvod: $('#r-ponovi-uvod'),
    rNadogradnja: $('#r-nadogradnja'),
    nadogradnja: $('#nadogradnja'), nadogradnjaOpis: $('#nadogradnja-opis'),
    nvInstaliraj: $('#nv-instaliraj'), nvKasnije: $('#nv-kasnije'),
    rReset: $('#r-reset'), rResetNas: $('#r-reset-nas'),
    rResetOpis: $('#r-reset-opis'), resetNapomena: $('#reset-napomena'),
    razvoj: $('#razvoj'), rzInfo: $('#rz-info'),
    rzNazad: $('#rz-nazad'), rzNapred: $('#rz-napred'), rzDanas: $('#rz-danas'),
    rzPwa: $('#rz-pwa'), rzPanel: $('#rz-panel'),
    mInstal: $('#m-instal'),
    vodicTacke: $('#vodic-tacke'), vodicScena: $('#vodic-scena'),
    vodicBrojac: $('#vodic-brojac'), vodicNaslov: $('#vodic-naslov'),
    vodicOpis: $('#vodic-opis'), vodicDodatno: $('#vodic-dodatno'),
    vodicDugmad: $('#vodic-dugmad'), vodicNazad: $('#vodic-nazad'), vodicDalje: $('#vodic-dalje'),
    formati: $('#dijeli-formati'), stilovi: $('#dijeli-stilovi'),
    platno: $('#platno'), pregled: $('#pregled'),
    mPostavke: $('#m-postavke'), mDijeli: $('#m-dijeli'), mPoruka: $('#m-poruka'),
    mpSadrzaj: $('#mp-sadrzaj'), mpFav: $('#mp-fav'), mpFavTekst: $('#mp-fav-tekst'),
    toasts: $('#toasts'),
    uvod: $('#uvod'), uvodNas: $('#uvod-nas'), uvodTekst: $('#uvod-tekst'),
    uvodSadrzaj: $('#uvod-sadrzaj'), uvodDalje: $('#uvod-dalje'),
    uvodPreskoci: $('#uvod-preskoci'), uvodTacke: $('#uvod-tacke'),
  });
}

function slusaci() {
  // dani
  el.danDanas.addEventListener('click', naDanas);
  postaviSwipe(el.karta);

  addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('.sloj.on')) return zatvoriSve();
      if (stanje.stranica !== 'danas') return naStranicu('danas');
      return;
    }
    // u vodiču strelice mijenjaju korak, ne dan
    if (el.mInstal.classList.contains('on')) {
      if (e.key === 'ArrowLeft')  vodicPomjeri(-1);
      if (e.key === 'ArrowRight') vodicPomjeri(1);
      return;
    }
    if ($('.sloj.on') || el.uvod.classList.contains('on')) return;
    if (stanje.stranica !== 'danas') return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowLeft')  pomjeriDan(-1);
    if (e.key === 'ArrowRight') pomjeriDan(1);
  });

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
  el.rPonoviUvod.addEventListener('click', () => {
    zatvoriSve();
    pokreniUvod(jeInstalirana() ? 'pwa' : 'web');
  });
  $('#r-instal').addEventListener('click', instaliraj);
  el.rReset.addEventListener('click', naReset);

  // vodič za instalaciju
  el.vodicNazad.addEventListener('click', () => vodicPomjeri(-1));
  el.vodicDalje.addEventListener('click', () => vodicPomjeri(1));

  // nadogradnja: traka na dnu i red u postavkama vode na isto
  el.nvInstaliraj.addEventListener('click', instalirajNadogradnju);
  el.rNadogradnja.addEventListener('click', () => { zatvoriSve(); instalirajNadogradnju(); });
  el.nvKasnije.addEventListener('click', () => {
    sakrijNadogradnju();
    poruka('Nova verzija čeka u postavkama', 'i-preuzmi');
  });

  // razvojna traka: dan lijevo/desno (isto rade strelice i swipe)
  if (RAZVOJ) {
    el.rzNazad.addEventListener('click', () => razvojDan(-1));
    el.rzNapred.addEventListener('click', () => razvojDan(1));
    el.rzDanas.addEventListener('click', () => razvojDan(0));

    // panel sa stanjima instalacije
    el.rzPwa.addEventListener('click', () => pokaziSimPanel(el.rzPanel.hidden));
    el.rzPanel.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      pokaziSimPanel(false);
      primijeniSim(b.dataset.sim || null);
    });
    document.addEventListener('click', e => {
      if (!el.rzPanel.hidden && !el.razvoj.contains(e.target)) pokaziSimPanel(false);
    });
  }

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
  el.uvodPreskoci.addEventListener('click', naprijed);

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

/**
 * Ulazne animacije se puštaju tek kad je dokument stvarno vidljiv.
 * U pozadinskom prozoru (a PWA se zna probuditi takav) timeline stoji na
 * nuli, pa bi sve što kreće iz `opacity: 0` ostalo nevidljivo. Dok klase
 * nema, CSS drži sve u mirnom, vidljivom stanju.
 */
function pustiAnimacije() {
  document.documentElement.classList.add('anim');
}

function cekajVidljivost() {
  if (document.visibilityState === 'visible') { pustiAnimacije(); return; }
  const kad = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', kad);
    pustiAnimacije();
  };
  document.addEventListener('visibilitychange', kad);
}

async function start() {
  vezi();
  cekajVidljivost();
  primijeniTemu();
  slusaci();
  ispisiVerziju(null);
  verzijaKesa().then(ispisiVerziju);

  if (RAZVOJ) {
    document.documentElement.dataset.razvoj = '1';
    el.razvoj.hidden = false;
    crtajSimPanel();
  }

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
  crtajVeze();
  primijeniZnakove();
  prikaziDan();
  crtajSacuvano();
  osvjeziBrojSacuvanih();
  osvjeziInstal();
  osvjeziNotif();

  await ucitajPushConfig();
  osvjeziNotif();
  if (stanje.notif && Notification.permission === 'granted') pretplatiPush();

  // razvojna simulacija iz URL-a (?instal=ios-2) — samo na localhostu
  if (RAZVOJ && simIzUrl) { primijeniSim(simIzUrl); return; }

  // U pregledniku vodimo do početnog ekrana, u aplikaciji do dozvole.
  // Dva odvojena zapisa, jer korisnik prolazi kroz oba — svaki jednom.
  if (prisilanUvod) pokreniUvod(prisilanUvod);
  else if (jeInstalirana()) {
    if (cita(LS.uvodPwa, null) !== UVOD_VERZIJA) pokreniUvod('pwa');
  } else if (cita(LS.uvod, null) !== UVOD_VERZIJA) {
    pokreniUvod('web');
  }
}

start();

/* --- service worker: potreban je za push i offline; mrežа-prvo strategija
       u sw.js znači da se izmjene i u razvoju vide odmah. Registracija i
       ponuda nadogradnje su u odjeljku 17. --- */
addEventListener('load', postaviServiceWorker);
