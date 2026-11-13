/* ============================================================
   PREDAVANJA — jezgro koje dijele aplikacija i admin builder
   ------------------------------------------------------------
   Zemlje i zone, trenutak predavanja (za odbrojavanje i kalendar)
   i pristup podacima. Na localhostu bez /api (python http.server) sve
   ide u localStorage, da se cijeli tok može probati bez baze.
   ============================================================ */

/* [ISO, naziv, zona glavnog grada] — zona se nudi čim se izabere država. */
export const ZEMLJE = [
  ['BA', 'Bosna i Hercegovina', 'Europe/Sarajevo'],
  ['HR', 'Hrvatska', 'Europe/Zagreb'],
  ['RS', 'Srbija', 'Europe/Belgrade'],
  ['ME', 'Crna Gora', 'Europe/Podgorica'],
  ['SI', 'Slovenija', 'Europe/Ljubljana'],
  ['MK', 'Sjeverna Makedonija', 'Europe/Skopje'],
  ['XK', 'Kosovo', 'Europe/Belgrade'],
  ['AL', 'Albanija', 'Europe/Tirane'],
  ['AT', 'Austrija', 'Europe/Vienna'],
  ['DE', 'Njemačka', 'Europe/Berlin'],
  ['CH', 'Švicarska', 'Europe/Zurich'],
  ['LU', 'Luksemburg', 'Europe/Luxembourg'],
  ['NL', 'Holandija', 'Europe/Amsterdam'],
  ['BE', 'Belgija', 'Europe/Brussels'],
  ['FR', 'Francuska', 'Europe/Paris'],
  ['IT', 'Italija', 'Europe/Rome'],
  ['SE', 'Švedska', 'Europe/Stockholm'],
  ['NO', 'Norveška', 'Europe/Oslo'],
  ['DK', 'Danska', 'Europe/Copenhagen'],
  ['FI', 'Finska', 'Europe/Helsinki'],
  ['GB', 'Velika Britanija', 'Europe/London'],
  ['IE', 'Irska', 'Europe/Dublin'],
  ['TR', 'Turska', 'Europe/Istanbul'],
  ['SA', 'Saudijska Arabija', 'Asia/Riyadh'],
  ['AE', 'Ujedinjeni Arapski Emirati', 'Asia/Dubai'],
  ['QA', 'Katar', 'Asia/Qatar'],
  ['KW', 'Kuvajt', 'Asia/Kuwait'],
  ['MY', 'Malezija', 'Asia/Kuala_Lumpur'],
  ['US', 'SAD', 'America/New_York'],
  ['CA', 'Kanada', 'America/Toronto'],
  ['AU', 'Australija', 'Australia/Sydney'],
  ['NZ', 'Novi Zeland', 'Pacific/Auckland'],
];

/* Zone koje se nude u adminu: zone svih zemalja, plus one koje glavni
   grad ne pokriva (SAD, Kanada i Australija imaju ih više). */
export const ZONE = [...new Set([
  ...ZEMLJE.map(z => z[2]),
  'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Vancouver',
  'Australia/Melbourne', 'Australia/Perth',
])];

export const SARAJEVO = 'Europe/Sarajevo';

export const zemlja = iso => ZEMLJE.find(z => z[0] === iso) || null;
export const imeZemlje = iso => zemlja(iso)?.[1] || iso || '';

/* Isto kao u app.js — datum se piše jednako u cijeloj aplikaciji. */
export const DANI = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];
export const MJESECI = ['januar', 'februar', 'mart', 'april', 'maj', 'juni',
                        'juli', 'august', 'septembar', 'oktobar', 'novembar', 'decembar'];
export const MJESECI_KRATKO = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];

/** `YYYY-MM-DD` → [godina, mjesec (0–11), dan]. */
const rastavi = datum => { const [g, m, d] = datum.split('-').map(Number); return [g, m - 1, d]; };

export const danUSedmici = datum => { const [g, m, d] = rastavi(datum); return DANI[new Date(Date.UTC(g, m, d)).getUTCDay()]; };
export const punDatumP = datum => { const [g, m, d] = rastavi(datum); return `${d}. ${MJESECI[m]} ${g}.`; };

/**
 * Lokalno vrijeme mjesta (datum + `HH:MM` u zoni) → stvarni trenutak.
 * Bez biblioteke: pretpostavi se da je to UTC, pita se Intl koliko je to
 * sati u zoni, i razlika je pomak zone tog dana (ljetno računanje uključeno).
 */
export function trenutak(p) {
  const [g, m, d] = rastavi(p.datum);
  const [h, mi] = (p.vrijeme || '00:00').split(':').map(Number);
  const kaoUtc = Date.UTC(g, m, d, h, mi);
  const dijelovi = new Intl.DateTimeFormat('en-US', {
    timeZone: p.zona || SARAJEVO, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(kaoUtc));
  const v = t => Number(dijelovi.find(x => x.type === t).value);
  const uZoni = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
  return new Date(kaoUtc - (uZoni - kaoUtc));
}

/* ---------- hidžretski datum (opcionalno, na plakatu) ---------- */

/* Isto kao HIDZRI_MJESECI u app.js. */
const HIDZRI_MJESECI = ['muharrem', 'safer', 'rebiu-l-evvel', 'rebiu-l-ahir', 'džumade-l-ula', 'džumade-l-uhra',
                        'redžeb', "ša'ban", 'ramazan', 'ševval', "zu-l-ka'de", 'zu-l-hidždže'];
const hidzriFmt = (() => {
  for (const cal of ['islamic-umalqura', 'islamic-civil', 'islamic']) {
    try {
      const f = new Intl.DateTimeFormat(`en-u-ca-${cal}`, { timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric' });
      if (f.resolvedOptions().calendar.startsWith('islamic')) return f;
    } catch { /* dalje */ }
  }
  return null;
})();

/** `YYYY-MM-DD` → „14. džumade-l-ula 1448. h.“ (prazno ako preglednik nema islamski kalendar). */
export function hidzriDatum(datum) {
  if (!hidzriFmt || !datum) return '';
  try {
    const [g, m, d] = rastavi(datum);
    const p = Object.fromEntries(hidzriFmt.formatToParts(new Date(Date.UTC(g, m, d, 12))).map(x => [x.type, x.value]));
    const mj = HIDZRI_MJESECI[Number(p.month) - 1];
    return mj ? `${Number(p.day)}. ${mj} ${Number(p.year)}. h.` : '';
  } catch { return ''; }
}

/* ---------- dizajn plakata ---------- */

/* Opcija plakata koja se bira u adminu, po predavanju: hidžretski datum,
   isključen dok ga neko ne uključi. Fotografija i zastava (van BiH) su uvijek. */
export const OPCIJE = { hidzri: false };
export const opcijePlakata = p => ({ ...OPCIJE, ...(p?.opcije || {}) });

/** Predavanje traje okvirno dva sata — do tada se vodi kao „u toku“, ne „održano“. */
export const TRAJANJE_MS = 2 * 3600000;
export const proslo = (p, sada = Date.now()) => trenutak(p).getTime() + TRAJANJE_MS < sada;

/* ---------- podaci ---------- */

const API = '/api/predavanja';
const LOKALNO = 'pd.predavanjaLokalno';
const jeLokalniHost = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

/* Kad /api ne postoji (statični server), na localhostu se radi iz localStorage.
   Na objavljenoj verziji toga nema — greška se javlja, ne skriva. */
let lokalniRezim = null;
export const radiLokalno = () => lokalniRezim === true;

function lokalnaLista() {
  let l;
  try { l = JSON.parse(localStorage.getItem(LOKALNO)) || []; } catch { return []; }
  // stari testni podaci znaju imati ponovljen id — svaki dobije svoj, jednom
  const vidjeni = new Set();
  let max = Math.max(0, ...l.map(x => x.id)), popravljeno = false;
  for (const x of l) {
    if (vidjeni.has(x.id)) { x.id = ++max; popravljeno = true; }
    vidjeni.add(x.id);
  }
  if (popravljeno) pisiLokalno(l);
  return l;
}
const pisiLokalno = l => localStorage.setItem(LOKALNO, JSON.stringify(l));
const poredaj = l => l.sort((a, b) => (a.datum + a.vrijeme).localeCompare(b.datum + b.vrijeme));

async function poziv(metoda, upit = '', { tajna, tijelo } = {}) {
  const r = await fetch(`${API}${upit}`, {
    method: metoda,
    cache: 'no-store',
    headers: {
      ...(tajna ? { Authorization: `Bearer ${tajna}` } : {}),
      ...(tijelo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: tijelo ? JSON.stringify(tijelo) : undefined,
  });
  const tip = r.headers.get('content-type') || '';
  if (!tip.includes('json')) {
    if (jeLokalniHost()) { lokalniRezim = true; return null; }
    throw new Error(`Server je vratio ${r.status}`);
  }
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.greska || `Greška ${r.status}`), { status: r.status });
  lokalniRezim = false;
  return d;
}

/** Lista predavanja. `sve` (admin) vraća i neobjavljena i sva održana.
    `svjeze` (id iz notifikacije) zaobilazi CDN keš od 5 minuta — tek dodano
    predavanje inače još ne bi bilo u listi. Svi koji dodirnu istu
    notifikaciju traže isti URL, pa CDN i ovo drži za njih. */
export async function ucitajPredavanja({ sve = false, tajna, svjeze } = {}) {
  if (lokalniRezim !== true) {
    try {
      const upit = sve ? '?sve=1' : svjeze ? `?v=${encodeURIComponent(svjeze)}` : '';
      const d = await poziv('GET', upit, { tajna });
      if (d) return d.predavanja;
    } catch (e) {
      if (!jeLokalniHost() || e.status) throw e;
      lokalniRezim = true;
    }
  }
  const l = poredaj(lokalnaLista());
  return sve ? l : l.filter(p => p.objavljeno !== false);
}

/** Jedno predavanje po privatnom ključu — za stranicu /plakat/?k=… */
export async function predavanjePoKljucu(k) {
  if (lokalniRezim !== true) {
    try {
      const d = await poziv('GET', `?k=${encodeURIComponent(k)}`);
      if (d) return d.predavanje;
    } catch (e) {
      if (!jeLokalniHost() || e.status) throw e;
      lokalniRezim = true;
    }
  }
  return lokalnaLista().find(p => p.kljuc === k) || null;
}

/** Nasumičan ključ za privatni link (32 hex znaka). */
export const noviKljuc = () => (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^a-f0-9]/g, '').slice(0, 32).padEnd(32, '0');

export const linkPlakata = p => (p?.kljuc ? `${location.origin}/plakat/?k=${p.kljuc}` : '');

/** Čuva predavanje. Vraća { predavanje, obavijest } — obavijest je koliko je
    push notifikacija otišlo za novo predavanje (null kad se nije slalo). */
export async function sacuvajPredavanje(p, tajna) {
  if (!radiLokalno()) {
    const d = await poziv(p.id ? 'PUT' : 'POST', p.id ? `?id=${p.id}` : '', { tajna, tijelo: p });
    if (d) return { predavanje: d.predavanje, obavijest: d.obavijest || null };
  }
  const l = lokalnaLista();
  const sada = new Date().toISOString();
  const { obavijest: _, ...bez } = p;            // izbor obavijesti nije dio predavanja
  p = bez;
  if (p.id) {
    const i = l.findIndex(x => x.id === p.id);
    if (i >= 0) l[i] = { ...l[i], ...p, izmijenjeno: sada };
  } else {
    // više upisa u istoj milisekundi („Test mjesec“) ne smije dobiti isti id
    const id = Math.max(Date.now(), ...l.map(x => x.id + 1));
    p = { ...p, id, kljuc: noviKljuc(), napravljeno: sada, izmijenjeno: sada };
    l.push(p);
  }
  pisiLokalno(l);
  return { predavanje: l.find(x => x.id === p.id), obavijest: null };
}

export async function obrisiPredavanjeId(id, tajna) {
  if (!radiLokalno()) {
    const d = await poziv('DELETE', `?id=${id}`, { tajna });
    if (d) return;
  }
  pisiLokalno(lokalnaLista().filter(x => x.id !== id));
}

/* ---------- kalendar ---------- */

const icsTekst = s => String(s || '').replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
const icsVrijeme = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Jedan događaj u kalendaru — vrijeme ide u UTC, kalendar ga sam prevede. */
function dogadjajIcs(p, autor) {
  const t = trenutak(p);
  const mjesto = [p.mjesto, p.adresa, p.grad, imeZemlje(p.drzava)].filter(Boolean).join(', ');
  return [
    'BEGIN:VEVENT',
    `UID:predavanje-${p.id}@poruka-dana`,
    `DTSTAMP:${icsVrijeme(new Date())}`,
    `DTSTART:${icsVrijeme(t)}`,
    `DTEND:${icsVrijeme(new Date(t.getTime() + TRAJANJE_MS))}`,
    `SUMMARY:${icsTekst(`${p.naslov}${autor ? ` — ${autor}` : ''}`)}`,
    mjesto ? `LOCATION:${icsTekst(mjesto)}` : '',
    p.vrijeme_opis || p.opis || p.link ? `DESCRIPTION:${icsTekst([p.vrijeme_opis, p.opis, p.link].filter(Boolean).join('\n\n'))}` : '',
    'END:VEVENT',
  ].filter(Boolean);
}

/** .ics s više predavanja (izvoz iz admina). */
export const icsZa = (lista, autor = '') => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Poruka dana//Predavanja//BS', 'CALSCALE:GREGORIAN',
  ...lista.flatMap(p => dogadjajIcs(p, autor)),
  'END:VCALENDAR',
].join('\r\n');

/** .ics za „Dodaj u kalendar“ — jedno predavanje. */
export const ics = (p, autor = '') => icsZa([p], autor);
