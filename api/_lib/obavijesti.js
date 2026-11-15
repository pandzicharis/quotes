/* Obavijesti o predavanjima: „Novo predavanje“ i podsjetnik dan prije za
   praćena. Šalje ih admin pri čuvanju (odmah) i cron (/api/send?nadoknadi=1),
   koji dostavi ono što prvi put nije stiglo.

   Sve ide kroz dnevnik isporuka (`isporuke`, ključ 'novo:<id>' odnosno
   'podsjetnik:<id>'): uređaj koji je obavijest već dobio ne dobija je opet,
   a onaj koji nije — dobije je u sljedećem pozivu, koliko god puta zatrebalo. */
import { razasalji } from './push.js';
import {
  svePretplate, kojiNemaju, skiniPretplate, zabiljeziIsporuke, zabiljeziSlanje,
  predavanjaUObavjestavanju, predavanjaUskoro, oznaciObavijest, uzmiBravu, pustiBravu,
} from './baza.js';

const MJESECI = ['januar', 'februar', 'mart', 'april', 'maj', 'juni',
                 'juli', 'august', 'septembar', 'oktobar', 'novembar', 'decembar'];

const ZAJEDNICKO = { icon: '/assets/icons/icon-192.png', badge: '/assets/icons/badge-96.png' };
const kad = p => `${p.vrijeme} h${p.vrijeme_opis ? ` (${p.vrijeme_opis})` : ''}`;
const gdje = p => [p.mjesto, p.grad].filter(Boolean).join(', ');

export function sadrzajNovog(p) {
  const [, m, d] = p.datum.split('-').map(Number);
  return {
    ...ZAJEDNICKO,
    title: 'Novo predavanje',
    body: `${p.naslov} — ${d}. ${MJESECI[m - 1]} u ${kad(p)}${p.grad ? `, ${p.grad}` : ''}`,
    tag: `predavanje-${p.id}`,
    kljuc: `novo:${p.id}`,
    url: `/?predavanje=${p.id}`,
    akcija: 'Pogledaj predavanje',
  };
}

export function sadrzajPodsjetnika(p) {
  return {
    ...ZAJEDNICKO,
    title: `Sutra: ${p.naslov}`,
    body: `U ${kad(p)}${gdje(p) ? ` · ${gdje(p)}` : ''}`,
    tag: `podsjetnik-${p.id}`,
    kljuc: `podsjetnik:${p.id}`,
    url: `/?predavanje=${p.id}`,
    akcija: 'Pogledaj predavanje',
  };
}

/**
 * Sažetak jednog slanja ide u `slanja` (pregled na /analytics). Ne smije
 * oboriti slanje — bez tabele samo nema pregleda.
 */
export async function zapisiSlanje(kljuc, nacin, { pretplata, dostavljeno, r, pocetak, naslov = null, poruka = null }) {
  try {
    await zabiljeziSlanje({
      kljuc, nacin, naslov, poruka, pretplata, dostavljeno,
      poslano: r.poslano, palo: r.palo, preskoceno: r.preskoceno, greske: r.greske,
      trajanje_ms: Date.now() - pocetak,
    });
  } catch { /* pregled je dodatak */ }
}

/**
 * Šalje obavijest `kljuc` pretplatama (filter kao u `svePretplate`) koje je
 * još nemaju, bilježi isporuke i briše mrtve pretplate. Kad su svi već
 * dobili, čita samo id-eve — poziv crona ostaje jeftin. Bez dnevnika (tabela
 * još nije napravljena) baca grešku — tada se ne šalje ništa, umjesto da isti
 * ljudi dobijaju istu obavijest na svaki poziv crona.
 */
export async function dostavi(kljuc, filter, sadrzaj, opcije = {}, nacin = 'nadoknada', naslov = null) {
  const pocetak = Date.now();
  let ukupno, dobilo = 0, ostali, dnevnik = true;
  try { ({ ukupno, dobilo, ostali } = await kojiNemaju(kljuc, filter)); }
  catch (e) {
    // prvo slanje (iz admina) ide i bez dnevnika — jednom je, pa nema ponavljanja
    if (nacin !== 'slanje') throw e;
    ostali = await svePretplate(filter); ukupno = ostali.length; dnevnik = false;
  }
  if (!ostali.length) return { kljuc, vec: dobilo, poslano: 0 };
  const r = await razasalji(ostali, sadrzaj, { ...opcije, zabiljezi: dnevnik ? idevi => zabiljeziIsporuke(kljuc, idevi) : null });
  if (r.mrtve.length) { try { await skiniPretplate(r.mrtve); } catch { /* sljedeći put */ } }
  // naslov ostaje u pregledu i kad se prošlo predavanje obriše
  await zapisiSlanje(kljuc, nacin, { pretplata: ukupno - r.mrtve.length, dostavljeno: dobilo + r.poslano, r, pocetak, naslov });
  return { kljuc, vec: dobilo, ...r, mrtve: r.mrtve.length };
}

/** „Novo predavanje“ svima koji ga nisu isključili, iz admina. Prvo se
    zabilježi da je obavijest krenula — i ako ovaj poziv padne, cron je
    dovršava. Šalje se odmah, u bilo koje doba — samo dok traje drugo slanje
    vraća `{ kasnije: 'uskoro' }`, a cron je pošalje pri sljedećem pozivu
    (najkasnije za sat). */
export async function obavijestiONovom(p, opcije) {
  let oznaceno = true;
  try { await oznaciObavijest(p.id); } catch { oznaceno = false; /* šema još nije dopunjena */ }
  let brava = null;                                     // null — bez dnevnika, šalje se bez brave
  try { brava = await uzmiBravu('slanje'); } catch { /* bez dnevnika */ }
  if (brava === false) {
    if (oznaceno) return { kasnije: 'uskoro' };
    brava = null;
  }
  try {
    return await dostavi(`novo:${p.id}`, { zaPredavanja: true }, sadrzajNovog(p), opcije, 'slanje', p.naslov);
  } finally {
    if (brava) await pustiBravu('slanje').catch(() => { /* istekne sama */ });
  }
}

/** Datum i sat u zoni predavanja ('YYYY-MM-DD', 0–23). `sada` je zadan samo
    u simulaciji na testu (vidi api/send.js), inače je pravo vrijeme. */
function sadaU(zona, sada = new Date()) {
  const d = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zona || 'Europe/Sarajevo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(sada).map(x => [x.type, x.value]));
  return { dan: `${d.year}-${d.month}-${d.day}`, sat: Number(d.hour) };
}
const sutra = dan => new Date(Date.parse(`${dan}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

/* Podsjetnik ne budi nikoga noću: kad tamošnjih 20 h cron ne dočeka, ide
   samo između 7 i 22 h po vremenu mjesta. („Novo“ ide odmah po dodavanju.) */
const DANJU = sat => sat >= 7 && sat < 22;

/** Koliko je sada sati u zoni, u minutama od ponoći. */
function minuteU(zona, sada = new Date()) {
  const d = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zona || 'Europe/Sarajevo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(sada).map(x => [x.type, x.value]));
  return Number(d.hour) * 60 + Number(d.minute);
}

/* Podsjetnik ide dan prije, navečer: od 20 h po vremenu mjesta. Cron zove
   svaki sat od 7 do 21 h po Sarajevu, pa za BiH i Evropu stiže tačno u 20 h
   (London u 20 h svoga, kod nas 21 h), a za Zaljev, Maleziju i Australiju u
   njihovih 20 h (kod nas popodne ili prijepodne). Gdje je tamošnjih 20 h kod
   nas noć (Amerika), to veče cron nikad ne dočeka — tamo podsjetnik ide dan
   prije čim se kod njih razdani. */
const VECE = 20;
function vrijemeZaPodsjetnik(zona, sat, sada = new Date()) {
  // razlika zone prema Sarajevu u minutama, -12 h … +12 h
  const razlika = ((minuteU(zona, sada) - minuteU('Europe/Sarajevo', sada) + 720 + 1440) % 1440) - 720;
  const nasih = ((VECE * 60 - razlika) % 1440 + 1440) % 1440;     // tamošnjih 20 h po Sarajevu
  const docekaVece = nasih >= 7 * 60 && nasih <= 21 * 60;
  return docekaVece ? sat >= VECE && sat < 22 : DANJU(sat);
}

/**
 * Nadoknada za predavanja (zove je /api/send?nadoknadi=1):
 *   1. „Novo predavanje“ — dovrši za sva kojima je obavijest krenula u
 *      zadnja dva dana, a nije stigla do svih;
 *   2. podsjetnik — za predavanja koja su sutra (po vremenu mjesta), onima
 *      koji ih prate, navečer (vidi vrijemeZaPodsjetnik).
 * Svaki dio ima svoj try: greška u jednom ne zaustavlja ostale.
 */
export async function nadoknadiPredavanja(opcije) {
  const sada = opcije.sada || new Date();              // simulacija na testu, inače sada
  const izv = [];
  const probaj = async (opis, fn) => {
    try { izv.push(await fn()); } catch (e) { izv.push({ kljuc: opis, greska: e.message }); }
  };

  // „novo“ ide odmah iz admina; ovdje se samo dostavi onima do kojih nije stiglo.
  // Predavanje koje je već počelo ne javlja se kao novo (aplikacija ga i ne prikazuje).
  const nova = (await predavanjaUObavjestavanju().catch(() => []))
    .filter(p => `${p.datum}T${p.vrijeme}` >= `${sadaU(p.zona, sada).dan}T${String(sadaU(p.zona, sada).sat).padStart(2, '0')}:00`);
  for (const p of nova) await probaj(`novo:${p.id}`, () => dostavi(`novo:${p.id}`, { zaPredavanja: true }, sadrzajNovog(p), opcije, 'nadoknada', p.naslov));

  for (const p of await predavanjaUskoro().catch(() => [])) {
    const s = sadaU(p.zona, sada);
    if (p.datum !== sutra(s.dan) || !vrijemeZaPodsjetnik(p.zona, s.sat, sada)) continue;
    await probaj(`podsjetnik:${p.id}`, () =>
      dostavi(`podsjetnik:${p.id}`, { prati: p.id }, sadrzajPodsjetnika(p), opcije, 'nadoknada', p.naslov));
  }
  return izv;
}
