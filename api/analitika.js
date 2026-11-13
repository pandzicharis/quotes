/* Pregled (stranica /analytics) i brojanje događaja.

     POST  { vrsta, kljuc }   uređaj javi da se nešto desilo — notifikacija
                              stigla ili dodirnuta, aplikacija otvorena,
                              poruka podijeljena… Samo vrsta i ključ, ništa
                              o uređaju (javno; vidi DOGADJAJI u baza.js)
     GET                      zadnjih 7 dana: slanja po obavijesti i
                              brojači događaja                     (admin)
     GET ?poruke=1            po poruci: koliko je puta bila poruka dana,
                              zadnji put, dijeljenja i čuvanja     (admin)

   Jedna funkcija za oboje, da Vercel ne broji još jednu. Brojanje je dodatak:
   ako baza nije spremna ili tabela još ne postoji, uređaj dobije 204 i ide
   dalje — ništa u aplikaciji ne čeka na ovo. */
import { ovlascenAdmin, odbijAdmin } from './_lib/auth.js';
import { citajTijelo } from './_lib/push.js';
import {
  bazaSpremna, DOGADJAJI, zabiljeziDogadjaj, dogadjajiOd, slanjaOd, brojPretplata, brojInstalacija, PLATFORME,
  dogadjajiPoruka, zapisanePorukeDana,
} from './_lib/baza.js';
import { danUTC } from './_lib/push.js';

// pregled je sedmica — manje redova iz baze, brži odgovor
const DANA = 7;

/* „Koliko je puta poruka bila poruka dana“. Od pokretanja aplikacije do
   prvog slanja koje zapiše id poruke vrijedi lista kakva je objavljena od
   8. septembra 2026 — 35 poruka, ovim redom, poruka dana = dan % 35. Od tog
   zapisa naovamo broji se ono što je zaista otišlo, pa dodavanje ili
   premještanje poruka ne kvari brojku. */
const POKRENUTO = '2026-10-13';
const PRVA_LISTA = [8, 10, 1, 9, 11, 2, 12, 13, 6, 14, 3, 15, 16, 17, 4, 18, 19, 5, 20, 21, 7,
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35];
const danBroj = dan => Math.floor(Date.parse(`${dan}T00:00:00Z`) / 86400000);

async function statistikaPoruka() {
  const [zapisi, dogadjaji] = await Promise.all([
    zapisanePorukeDana().catch(() => []),
    dogadjajiPoruka().catch(() => []),
  ]);
  const poDanu = new Map(zapisi.filter(z => z.kljuc?.startsWith('dan:')).map(z => [z.kljuc.slice(4), z.poruka]));
  const prviZapis = [...poDanu.keys()].sort()[0] || '9999-12-31';
  const poruke = {};
  const za = id => (poruke[id] ||= { prikazano: 0, zadnje: null });
  for (let b = danBroj(POKRENUTO), kraj = danBroj(danUTC()); b <= kraj; b++) {
    const dan = new Date(b * 86400000).toISOString().slice(0, 10);
    const id = dan < prviZapis ? PRVA_LISTA[b % PRVA_LISTA.length] : poDanu.get(dan);
    if (id == null) continue;                       // dan bez slanja (cron nije radio)
    const p = za(id);
    p.prikazano++;
    p.zadnje = dan;
  }
  for (const { vrsta, kljuc, broj } of dogadjaji) {
    const p = za(Number(kljuc.split(':')[1]));
    p[vrsta] = (p[vrsta] || 0) + broj;
  }
  return { od: POKRENUTO, poruke };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST') {
    const t = citajTijelo(req) || {};
    const vrsta = t.vrsta || 'otvoreno';            // stariji worker je slao samo ključ dodirnute obavijesti
    const kljuc = typeof t.kljuc === 'string' ? t.kljuc : '';
    if (typeof vrsta !== 'string' || !Object.hasOwn(DOGADJAJI, vrsta) || !DOGADJAJI[vrsta].test(kljuc)) {
      return res.status(400).json({ greska: 'Nepoznat događaj' });
    }
    if (bazaSpremna()) {
      try { await zabiljeziDogadjaj(vrsta, kljuc); } catch { /* pregled je dodatak — korisniku se ne javlja greška */ }
    }
    return res.status(204).end();
  }
  if (req.method !== 'GET') return res.status(405).json({ greska: 'Metoda nije podržana' });
  if (!ovlascenAdmin(req)) return odbijAdmin(res);
  if (!bazaSpremna()) return res.status(503).json({ greska: 'Baza nije konfigurisana' });

  try {
    if (new URL(req.url, 'http://x').searchParams.get('poruke') === '1') {
      return res.status(200).json(await statistikaPoruka());
    }
    const od = new Date(Date.now() - DANA * 86400000);
    const [redovi, dogadjaji, pretplata, ...instalacije] = await Promise.all([
      slanjaOd(od.toISOString()),
      // bez tabele `dogadjaji` (šema još nije dopunjena) pregled slanja i dalje radi
      dogadjajiOd(od.toISOString().slice(0, 10)).catch(() => null),
      brojPretplata(),
      ...PLATFORME.map(p => brojInstalacija(p).catch(() => 0)),
    ]);

    // zbir po (vrsta, ključ) kroz sve dane — za stiglo/otvoreno po obavijesti
    const zbir = new Map();
    for (const d of dogadjaji || []) zbir.set(`${d.vrsta}|${d.kljuc}`, (zbir.get(`${d.vrsta}|${d.kljuc}`) || 0) + d.broj);
    const koliko = (vrsta, kljuc) => (dogadjaji ? zbir.get(`${vrsta}|${kljuc}`) || 0 : null);

    // jedna stavka po obavijesti: zadnji poziv nosi ukupno stanje, svi zajedno istoriju
    const po = new Map();
    for (const r of redovi) {                       // najnoviji prvi
      let o = po.get(r.kljuc);
      if (!o) {
        o = { kljuc: r.kljuc, naslov: r.naslov || null, pretplata: r.pretplata, dostavljeno: r.dostavljeno, prvo: r.napravljeno, zadnje: r.napravljeno, pozivi: [] };
        po.set(r.kljuc, o);
      }
      o.dostavljeno = Math.max(o.dostavljeno, r.dostavljeno);
      o.naslov ||= r.naslov || null;
      o.prvo = r.napravljeno;
      o.pozivi.push({
        kad: r.napravljeno, nacin: r.nacin, poslano: r.poslano, palo: r.palo,
        preskoceno: r.preskoceno, greske: r.greske, trajanjeMs: r.trajanje_ms,
      });
    }
    const obavijesti = [...po.values()].map(o => ({ ...o, stiglo: koliko('stiglo', o.kljuc), otvorilo: koliko('otvoreno', o.kljuc) }));

    return res.status(200).json({
      osvjezeno: new Date().toISOString(),
      pretplata,
      instalacije: Object.fromEntries(PLATFORME.map((p, i) => [p, instalacije[i]])),
      obavijesti,
      dogadjaji,                                    // [{ dan, vrsta, kljuc, broj }] ili null bez tabele
    });
  } catch (e) {
    return res.status(500).json({ greska: e.message });
  }
}
