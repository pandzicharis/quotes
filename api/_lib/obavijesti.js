/* Obavijesti o predavanjima: „Novo predavanje“ i podsjetnik dan prije za
   praćena. Šalje ih admin pri čuvanju (odmah) i cron (/api/send?nadoknadi=1),
   koji dostavi ono što prvi put nije stiglo.

   Sve ide kroz dnevnik isporuka (`isporuke`, ključ 'novo:<id>' odnosno
   'podsjetnik:<id>'): uređaj koji je obavijest već dobio ne dobija je opet,
   a onaj koji nije — dobije je u sljedećem pozivu, koliko god puta zatrebalo. */
import { razasalji } from './push.js';
import {
  svePretplate, skiniPretplate, isporucene, zabiljeziIsporuke, zabiljeziSlanje,
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
 * Šalje obavijest `kljuc` pretplatama iz `pretplate` koje je još nemaju,
 * bilježi isporuke i briše mrtve pretplate. Bez dnevnika (tabela još nije
 * napravljena) baca grešku — tada se ne šalje ništa, umjesto da isti ljudi
 * dobijaju istu obavijest na svaki poziv crona.
 */
export async function dostavi(kljuc, pretplate, sadrzaj, opcije = {}, nacin = 'nadoknada', naslov = null) {
  const pocetak = Date.now();
  // prvo slanje (iz admina) ide i bez dnevnika — jednom je, pa nema ponavljanja
  let imaju, dnevnik = true;
  try { imaju = await isporucene(kljuc); }
  catch (e) { if (nacin !== 'slanje') throw e; imaju = new Set(); dnevnik = false; }
  const ostali = pretplate.filter(s => !imaju.has(s.id));
  if (!ostali.length) return { kljuc, vec: imaju.size, poslano: 0 };
  const r = await razasalji(ostali, sadrzaj, { ...opcije, zabiljezi: dnevnik ? idevi => zabiljeziIsporuke(kljuc, idevi) : null });
  if (r.mrtve.length) { try { await skiniPretplate(r.mrtve); } catch { /* sljedeći put */ } }
  const dostavljeno = pretplate.filter(s => imaju.has(s.id)).length + r.poslano;
  // naslov ostaje u pregledu i kad se prošlo predavanje obriše
  await zapisiSlanje(kljuc, nacin, { pretplata: pretplate.length - r.mrtve.length, dostavljeno, r, pocetak, naslov });
  return { kljuc, vec: imaju.size, ...r, mrtve: r.mrtve.length };
}

/** „Novo predavanje“ svima koji ga nisu isključili, iz admina. Prvo se
    zabilježi da je obavijest krenula — i ako ovaj poziv padne, cron je
    dovršava. Noću (22–7 h po Sarajevu) i dok traje drugo slanje ne šalje se
    odavde: vraća `{ kasnije: 'jutro' | 'uskoro' }`, a cron je pošalje u 7 h,
    odnosno u narednih 15 minuta. */
export async function obavijestiONovom(p, opcije) {
  let oznaceno = true;
  try { await oznaciObavijest(p.id); } catch { oznaceno = false; /* šema još nije dopunjena */ }
  // bez oznake cron ne zna za ovu obavijest — tada ide odmah, i noću, kao ranije
  if (oznaceno && !DANJU(sadaU('Europe/Sarajevo').sat)) return { kasnije: 'jutro' };
  let brava = null;                                     // null — bez dnevnika, šalje se bez brave
  try { brava = await uzmiBravu('slanje'); } catch { /* bez dnevnika */ }
  if (brava === false) {
    if (oznaceno) return { kasnije: 'uskoro' };
    brava = null;
  }
  try {
    return await dostavi(`novo:${p.id}`, await svePretplate({ zaPredavanja: true }), sadrzajNovog(p), opcije, 'slanje', p.naslov);
  } finally {
    if (brava) await pustiBravu('slanje').catch(() => { /* istekne sama */ });
  }
}

/** Današnji datum i sat u zoni predavanja ('YYYY-MM-DD', 0–23). */
function sadaU(zona) {
  const d = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zona || 'Europe/Sarajevo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { dan: `${d.year}-${d.month}-${d.day}`, sat: Number(d.hour) };
}
const sutra = dan => new Date(Date.parse(`${dan}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

/* Obavijesti o predavanjima ne bude nikoga noću, ma kad cron zvao: šalju se
   samo između 7 i 22 h po vremenu mjesta (za „novo“ — po Sarajevu). */
const DANJU = sat => sat >= 7 && sat < 22;

/**
 * Nadoknada za predavanja (zove je /api/send?nadoknadi=1):
 *   1. „Novo predavanje“ — dovrši za sva kojima je obavijest krenula u
 *      zadnja dva dana, a nije stigla do svih;
 *   2. podsjetnik — za predavanja koja su sutra (po vremenu mjesta), onima
 *      koji ih prate.
 * Svaki dio ima svoj try: greška u jednom ne zaustavlja ostale.
 */
export async function nadoknadiPredavanja(opcije) {
  const izv = [];
  const probaj = async (opis, fn) => {
    try { izv.push(await fn()); } catch (e) { izv.push({ kljuc: opis, greska: e.message }); }
  };

  if (DANJU(sadaU('Europe/Sarajevo').sat)) {
    const nova = await predavanjaUObavjestavanju().catch(() => []);
    if (nova.length) {
      const pretplate = await svePretplate({ zaPredavanja: true });
      for (const p of nova) await probaj(`novo:${p.id}`, () => dostavi(`novo:${p.id}`, pretplate, sadrzajNovog(p), opcije, 'nadoknada', p.naslov));
    }
  }

  for (const p of await predavanjaUskoro().catch(() => [])) {
    const s = sadaU(p.zona);
    if (p.datum !== sutra(s.dan) || !DANJU(s.sat)) continue;
    await probaj(`podsjetnik:${p.id}`, async () =>
      dostavi(`podsjetnik:${p.id}`, await svePretplate({ prati: p.id }), sadrzajPodsjetnika(p), opcije, 'nadoknada', p.naslov));
  }
  return izv;
}
