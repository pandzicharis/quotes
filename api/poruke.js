/* Poruke dana i raspored — admin ih uređuje, aplikacija i slanje ih čitaju.

     GET                              { poruke, raspored } — javno; CDN drži
                                      minut, pa aplikacija ne budi funkciju
     GET ?svjeze=1                    isto, mimo keša (admin poslije izmjene)
     POST   { tekst, knjiga, poglavlje }   nova poruka, na kraj kruga   (admin)
     PUT    ?id=…  { … }                    izmjena                      (admin)
     DELETE ?id=…                           brisanje (meko)              (admin)
     PUT    ?raspored=1 { dani: { 'YYYY-MM-DD': id ili null } }
                                      izbor poruke za dane; null briše izbor,
                                      pa dan nastavlja krug          (admin)

   `poruke` su sve, i obrisane (sačuvane u aplikaciji se vežu za id); u krug
   idu samo one bez `obrisana`. `raspored` je { 'YYYY-MM-DD': id }. Kako se
   iz toga dobije poruka dana — vidi porukaZaDatum u _lib/push.js.

   Dan čija je poruka već otišla (prošli dani, i danas od 10 h) se ne mijenja.

   Poruke van knjiga (dizajner u adminu) — nisu poruke dana, pa sve traži admina:
     GET    ?vlastite=1                       { poruke }, zadnje mijenjane prve
     POST   ?vlastite=1 { tekst, stil }        nova
     PUT    ?vlastite=1&id=… { tekst, stil }   izmjena
     DELETE ?vlastite=1&id=…                   brisanje (za stalno) */
import { ovlascenAdmin, odbijAdmin } from './_lib/auth.js';
import { citajTijelo, porukaZaDatum, danSarajevo, oznaciKrug } from './_lib/push.js';
import {
  bazaSpremna, svePoruke, dodajPoruku, izmijeniPoruku,
  rasporedPoruka, zakaziPoruke, otkaziPoruke,
  sveVlastite, dodajVlastitu, izmijeniVlastitu, obrisiVlastitu,
} from './_lib/baza.js';

const DAN = /^\d{4}-\d{2}-\d{2}$/;
const SAT_PORUKE = process.env.SAT_PORUKE ? Number(process.env.SAT_PORUKE) : 10;
const satSarajevo = () => Number(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Sarajevo', hour: '2-digit', hourCycle: 'h23',
}).format(new Date()));

/** Zašto se dan ne smije mijenjati, ili null. */
function zakljucan(dan) {
  const danas = danSarajevo();
  if (dan < danas) return 'Prošli dani se ne mijenjaju — njihova poruka je već otišla';
  if (dan === danas && satSarajevo() >= SAT_PORUKE) return `Današnja poruka je otišla u ${SAT_PORUKE} h — više se ne mijenja`;
  return null;
}

/** Iz tijela uzima samo poznata polja. Vraća { greska } ili čist red. */
function ocisti(t) {
  const tekst = typeof t?.tekst === 'string' ? t.tekst.trim() : '';
  if (!tekst) return { greska: 'Tekst poruke je prazan' };
  if (tekst.length > 2000) return { greska: 'Poruka je duža od 2000 znakova' };
  const knjiga = typeof t.knjiga === 'string' ? t.knjiga.trim() : '';
  if (!/^[a-z0-9-]{0,80}$/.test(knjiga)) return { greska: 'Knjiga nije ispravna' };
  const poglavlje = typeof t.poglavlje === 'string' ? t.poglavlje.trim().slice(0, 120) : '';
  return { tekst, knjiga, poglavlje: poglavlje || null };
}

/* Nova ili obrisana poruka mijenja broj poruka u krugu, a time i to koja je
   poruka danas (ako danas nije izabrana). Današnja je možda već otišla u
   notifikaciji — zato se prije promjene upiše kao izbor za danas, pa se krug
   pomjera tek od sutra. */
async function zadrziDanasnju(sve) {
  const dan = danSarajevo();
  const raspored = await rasporedPoruka();
  const aktivne = sve.filter(p => !p.obrisana);
  if (!aktivne.length || aktivne.some(p => p.id === raspored[dan])) return;
  await zakaziPoruke([{ dan, poruka: porukaZaDatum({ poruke: aktivne, sve: oznaciKrug(sve) }, dan, raspored).id }]);
}

/* ---------- poruke van knjiga ---------- */
const STILOVI_SLIKE = ['zelena', 'krem'];
// dužina nije ograničena za pisanje — slika smanji slova da poruka stane;
// ovo je samo zaštita od pogrešno zalijepljenog teksta (isto kao u bazi)
const NAJVISE_ZNAKOVA = 10000;

function ocistiVlastitu(t) {
  const tekst = typeof t?.tekst === 'string' ? t.tekst.trim() : '';
  if (!tekst) return { greska: 'Tekst poruke je prazan' };
  if (tekst.length > NAJVISE_ZNAKOVA) return { greska: `Poruka je duža od ${NAJVISE_ZNAKOVA} znakova` };
  return { tekst, stil: STILOVI_SLIKE.includes(t.stil) ? t.stil : 'zelena' };
}

async function vlastite(req, res, id) {
  if (!ovlascenAdmin(req)) return odbijAdmin(res);
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return res.status(200).json({ poruke: await sveVlastite() });
    if (req.method === 'POST' || (req.method === 'PUT' && id)) {
      const p = ocistiVlastitu(citajTijelo(req));
      if (p.greska) return res.status(400).json(p);
      if (req.method === 'POST') return res.status(201).json({ poruka: await dodajVlastitu(p) });
      const red = await izmijeniVlastitu(id, p);
      return red ? res.status(200).json({ poruka: red }) : res.status(404).json({ greska: 'Poruka ne postoji' });
    }
    if (req.method === 'DELETE' && id) {
      return await obrisiVlastitu(id) ? res.status(200).json({ ok: true }) : res.status(404).json({ greska: 'Poruka ne postoji' });
    }
    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ greska: 'Metoda nije podržana' });
  } catch (e) {
    // tabela još nije napravljena: pokrene se sql/shema.sql
    if (/PGRST205|42P01/.test(e.message)) {
      return res.status(503).json({ greska: 'U bazi nema tabele vlastite_poruke — pokreni sql/shema.sql u Supabase' });
    }
    return res.status(500).json({ greska: e.message });
  }
}

export default async function handler(req, res) {
  if (!bazaSpremna()) return res.status(503).json({ greska: 'Baza nije konfigurisana' });

  const url = new URL(req.url, 'http://x');
  const id = Number(url.searchParams.get('id'));
  if (url.searchParams.has('vlastite')) return vlastite(req, res, id);

  try {
    if (req.method === 'GET') {
      const [poruke, raspored] = await Promise.all([svePoruke(), rasporedPoruka()]);
      res.setHeader('Cache-Control', url.searchParams.has('svjeze')
        ? 'no-store'
        : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
      return res.status(200).json({ poruke, raspored });
    }

    if (!ovlascenAdmin(req)) return odbijAdmin(res);
    res.setHeader('Cache-Control', 'no-store');

    // raspored: izbor poruke za jedan ili više dana
    if (req.method === 'PUT' && url.searchParams.has('raspored')) {
      const dani = citajTijelo(req)?.dani;
      if (!dani || typeof dani !== 'object' || Array.isArray(dani)) return res.status(400).json({ greska: 'Nema dana za upis' });
      const unosi = Object.entries(dani);
      if (!unosi.length || unosi.length > 400) return res.status(400).json({ greska: 'Najviše 400 dana odjednom' });
      const aktivni = new Set((await svePoruke()).filter(p => !p.obrisana).map(p => p.id));
      const upis = [], brisanje = [];
      for (const [dan, poruka] of unosi) {
        if (!DAN.test(dan)) return res.status(400).json({ greska: `Datum nije ispravan: ${dan}` });
        const razlog = zakljucan(dan);
        if (razlog) return res.status(409).json({ greska: razlog });
        if (poruka == null) brisanje.push(dan);
        else if (aktivni.has(poruka)) upis.push({ dan, poruka });
        else return res.status(400).json({ greska: 'Te poruke nema među aktivnim' });
      }
      await zakaziPoruke(upis);
      await otkaziPoruke(brisanje);
      return res.status(200).json({ ok: true, upisano: upis.length, obrisano: brisanje.length });
    }

    if (req.method === 'POST' || (req.method === 'PUT' && id)) {
      const p = ocisti(citajTijelo(req));
      if (p.greska) return res.status(400).json(p);
      const sve = await svePoruke();
      // prazna tabela: novi id bi se sudario s porukama iz sql/poruke-pocetne.sql
      if (!sve.length) return res.status(409).json({ greska: 'Baza poruka je prazna — prvo pokreni sql/poruke-pocetne.sql' });
      if (req.method === 'POST') {
        await zadrziDanasnju(sve);
        return res.status(201).json({ poruka: await dodajPoruku(p, sve) });
      }
      const red = await izmijeniPoruku(id, p);
      return red ? res.status(200).json({ poruka: red }) : res.status(404).json({ greska: 'Poruka ne postoji' });
    }

    if (req.method === 'DELETE' && id) {
      const sve = await svePoruke();
      const p = sve.find(x => x.id === id);
      if (!p) return res.status(404).json({ greska: 'Poruka ne postoji' });
      if (sve.filter(x => !x.obrisana).length <= 1) return res.status(400).json({ greska: 'Mora ostati bar jedna poruka' });
      if (!p.obrisana) {
        await zadrziDanasnju(sve);
        await izmijeniPoruku(id, { obrisana: true });
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ greska: 'Metoda nije podržana' });
  } catch (e) {
    return res.status(500).json({ greska: e.message });
  }
}
