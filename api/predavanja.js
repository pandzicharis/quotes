/* Predavanja — javna lista za aplikaciju i upis iz admin buildera.

     GET                 javna lista (objavljena, od prije 60 dana nadalje),
                         drži je CDN 5 minuta — aplikacija ne budi funkciju
     GET ?sve=1          sve, i neobjavljena          (admin)
     GET ?k=…            jedno, po privatnom ključu   (link za dijeljenje plakata)
     GET ?ics=…          objavljeno predavanje kao .ics (iPhone ga otvara u Kalendaru)
     POST                novo predavanje               (admin)
     PUT ?id=…           izmjena                       (admin)
     DELETE ?id=…        brisanje                      (admin)                */
import { ovlascenAdmin, odbijAdmin } from './_lib/auth.js';
import { ics } from '../public/js/predavanja-jezgro.js';
import { citajTijelo, postaviVapid, vapidSpreman } from './_lib/push.js';
import { obavijestiONovom } from './_lib/obavijesti.js';
import {
  bazaSpremna, listaPredavanja, predavanjePoKljucu, dodajPredavanje, izmijeniPredavanje, obrisiPredavanje,
} from './_lib/baza.js';

/* Push „Novo predavanje“ svima koji ga nisu isključili. Uključuje se tek s
   PREDAVANJA_PUSH=1 — dok je modul u aplikaciji iza zastavice, korisnici ne
   smiju dobijati obavijest o nečemu što ne vide.

   Odavde se šalje koliko stane u kratak rok, da admin brzo dobije odgovor;
   ostatak (i sve što padne) dostavi cron kroz /api/send?nadoknadi=1. Rok je
   kratak i zato što posljednje slanje pred rok može trajati još ~25 s, a sve
   mora stati u maxDuration od 60 s. */
/** 'YYYY-MM-DDTHH:MM' sada, u zoni predavanja. */
function sadaUZoni(zona) {
  const d = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zona || 'Europe/Sarajevo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${d.year}-${d.month}-${d.day}T${d.hour}:${d.minute}`;
}
/* Predavanje čiji je početak prošao aplikacija ne prikazuje, a cron ga
   briše — za njega nema ni dodavanja ni obavijesti „Novo“. */
const vecPoceo = p => `${p.datum}T${p.vrijeme}` < sadaUZoni(p.zona);

async function obavijesti(p) {
  if (process.env.PREDAVANJA_PUSH !== '1' || !vapidSpreman() || !p.objavljeno || vecPoceo(p)) return null;
  postaviVapid();
  const r = await obavijestiONovom(p, { rokMs: 15_000 });
  return r.kasnije ? { kasnije: r.kasnije } : { poslano: r.poslano, palo: r.palo };
}

const OPCIJE = ['hidzri'];
const TEKST = { naslov: 200, podnaslov: 200, vrijeme_opis: 80, organizator: 200, mjesto: 200, adresa: 300, grad: 120, opis: 4000, link: 500 };

/** Iz tijela uzima samo poznata polja i provjerava ih. Vraća { greska } ili čist red. */
function ocisti(t) {
  if (!t || typeof t !== 'object') return { greska: 'Prazan zahtjev' };
  const p = {};
  for (const [k, max] of Object.entries(TEKST)) {
    const v = typeof t[k] === 'string' ? t[k].trim().slice(0, max) : '';
    p[k] = v || null;
  }
  if (!p.naslov) return { greska: 'Naslov je obavezan' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.datum || '')) return { greska: 'Datum nije ispravan' };
  if (!/^[0-2]\d:[0-5]\d$/.test(t.vrijeme || '')) return { greska: 'Vrijeme nije ispravno' };
  if (!/^[A-Z]{2}$/.test(t.drzava || '')) return { greska: 'Država nije ispravna' };
  try { new Intl.DateTimeFormat('en', { timeZone: t.zona }); } catch { return { greska: 'Vremenska zona nije ispravna' }; }
  if (p.link && !/^https?:\/\//i.test(p.link)) return { greska: 'Link mora početi sa http:// ili https://' };
  Object.assign(p, {
    datum: t.datum, vrijeme: t.vrijeme, drzava: t.drzava, zona: t.zona,
    stil: t.stil === 'krem' ? 'krem' : 'zelena',
    objavljeno: t.objavljeno !== false,
    opcije: Object.fromEntries(OPCIJE.filter(k => typeof t.opcije?.[k] === 'boolean').map(k => [k, t.opcije[k]])),
  });
  return p;
}

export default async function handler(req, res) {
  if (!bazaSpremna()) return res.status(503).json({ greska: 'Baza nije konfigurisana' });

  const url = new URL(req.url, 'http://x');
  const id = Number(url.searchParams.get('id'));

  try {
    if (req.method === 'GET') {
      const k = url.searchParams.get('k');
      if (k !== null) {
        if (!/^[a-f0-9]{32}$/.test(k)) return res.status(404).json({ greska: 'Plakat ne postoji' });
        res.setHeader('Cache-Control', 'private, no-store');
        const p = await predavanjePoKljucu(k);
        return p ? res.status(200).json({ predavanje: p }) : res.status(404).json({ greska: 'Plakat ne postoji' });
      }
      const icsId = Number(url.searchParams.get('ics'));
      if (icsId) {
        // iOS .ics s pravog linka (ne preuzet fajl) otvara kao „Dodaj u Kalendar“
        const p = (await listaPredavanja(false)).find(x => x.id === icsId);
        if (!p) return res.status(404).json({ greska: 'Predavanje ne postoji' });
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="predavanje-${p.datum}.ics"`);
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
        return res.status(200).send(ics(p, 'Hafiz Ammar Bašić'));
      }
      const sve = url.searchParams.get('sve') === '1';
      if (sve && !ovlascenAdmin(req)) return odbijAdmin(res);
      /* Samo 5 s na CDN-u i bez posluživanja zastarjelog: novo predavanje je u
         aplikaciji odmah po dodavanju (ponuda pri otvaranju, box). CDN i dalje
         upija navalu kad obavijest ode svima — baza dobije najviše jedan upit
         u 5 s po regiji. */
      res.setHeader('Cache-Control', sve
        ? 'no-store'
        : 'public, max-age=0, s-maxage=5');
      return res.status(200).json({ predavanja: await listaPredavanja(sve) });
    }

    if (!ovlascenAdmin(req)) return odbijAdmin(res);
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'DELETE' && id) {
      return res.status(200).json({ obrisano: await obrisiPredavanje(id) });
    }
    if (req.method === 'POST' || (req.method === 'PUT' && id)) {
      const tijelo = citajTijelo(req);
      const p = ocisti(tijelo);
      if (p.greska) return res.status(400).json(p);
      const novo = req.method === 'POST';
      if (novo && vecPoceo(p)) {
        return res.status(400).json({ greska: 'Datum i vrijeme su već prošli — takvo predavanje se u aplikaciji ne vidi. Provjeri datum.' });
      }
      const red = novo ? await dodajPredavanje(p) : await izmijeniPredavanje(id, p);
      if (!red) return res.status(404).json({ greska: 'Predavanje ne postoji' });
      /* Obavijest ide samo za novo predavanje, i samo kad je admin traži
         (prekidač „Pošalji obavijest“). Izmjena nikad ne budi telefone. */
      let obavijest = null;
      if (novo && tijelo?.obavijest === true) {
        try { obavijest = await obavijesti(red); } catch { /* predavanje je sačuvano; cron dovršava */ }
      }
      return res.status(novo ? 201 : 200).json({ predavanje: red, obavijest });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ greska: 'Metoda nije podržana' });
  } catch (e) {
    return res.status(500).json({ greska: e.message });
  }
}
