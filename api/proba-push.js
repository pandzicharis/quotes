/* PROBA OPTEREĆENJA — samo na testu (Vercel Preview).
   Glumi push servis (FCM, Apple, Mozilla) za lažne pretplate iz
   scripts/proba-1300.mjs: slanje poruke dana se tako provjeri s brojem
   korisnika kao u produkciji, a nijedan pravi telefon ne dobije stotine
   obavijesti. Lažna pretplata nosi svoj `tip` u adresi i ponaša se po njemu:

     ok        201 za 50–400 ms                — većina uređaja
     sporo     201 za 2–4 s                    — spor push servis
     prolazno  503 ili 201, pola-pola          — servis privremeno pao
     gust      429 (Retry-After 1) ili 201     — servis traži da se uspori
     mrtva     410                             — aplikacija obrisana s telefona
     visi      ne odgovori 9,5 s               — pošiljalac odustane na 8 s

   Uz CRON_SECRET još dvije stvari za skriptu:
     GET  ?izvjestaj=dan:YYYY-MM-DD  kome je od lažnih stiglo, po tipu
     POST ?ocisti=1                  briše sve lažne pretplate

   U produkciji i lokalno vraća 404 — tamo ga nema. */
import { ovlascen, odbij } from './_lib/auth.js';
import { svePretplate, isporucene, skiniPretplate, bazaSpremna, KLJUC_OBAVIJESTI } from './_lib/baza.js';

const PROBA = process.env.VERCEL_ENV === 'preview';
export const OZNAKA = '/api/proba-push?';

const pauza = ms => new Promise(r => setTimeout(r, ms));
const izmedju = (a, b) => a + Math.random() * (b - a);
const parametar = (endpoint, ime) => { try { return new URL(endpoint).searchParams.get(ime); } catch { return null; } };

export default async function handler(req, res) {
  if (!PROBA) return res.status(404).json({ greska: 'Nije dostupno' });
  const q = new URL(req.url, 'http://x').searchParams;

  /* ---------- za skriptu: izvještaj i čišćenje ---------- */
  if (q.has('izvjestaj') || q.has('ocisti')) {
    if (!ovlascen(req)) return odbij(res);
    if (!bazaSpremna()) return res.status(503).json({ greska: 'Baza nije konfigurisana' });
    res.setHeader('Cache-Control', 'no-store');
    const lazne = (await svePretplate()).filter(s => s.endpoint.includes(OZNAKA));

    if (q.has('ocisti')) {
      if (req.method !== 'POST') return res.status(405).json({ greska: 'Samo POST' });
      return res.status(200).json({ ok: true, obrisano: await skiniPretplate(lazne.map(s => s.id)) });
    }

    const kljuc = q.get('izvjestaj');
    if (!KLJUC_OBAVIJESTI.test(kljuc || '')) return res.status(400).json({ greska: 'izvjestaj=dan:YYYY-MM-DD' });
    const dobili = await isporucene(kljuc);
    const poTipu = {};
    for (const s of lazne) {
      const t = (poTipu[parametar(s.endpoint, 'tip') || '?'] ||= { pretplata: 0, stiglo: 0, nije: [] });
      t.pretplata++;
      if (dobili.has(s.id)) t.stiglo++;
      else if (t.nije.length < 10) t.nije.push(Number(parametar(s.endpoint, 'id')));
    }
    return res.status(200).json({ kljuc, laznih: lazne.length, poTipu });
  }

  /* ---------- „push servis“ ---------- */
  if (req.method !== 'POST') return res.status(405).end();
  // kao pravi servis: bez VAPID potpisa i šifrovanog sadržaja ne prima ništa
  if (!/^vapid t=/.test(req.headers.authorization || '') || req.headers['content-encoding'] !== 'aes128gcm') {
    return res.status(400).end();
  }
  switch (q.get('tip')) {
    case 'mrtva': return res.status(410).end();
    case 'visi': await pauza(9500); return res.status(201).end();
    case 'sporo': await pauza(izmedju(2000, 4000)); return res.status(201).end();
    case 'prolazno': await pauza(izmedju(50, 300)); return res.status(Math.random() < 0.5 ? 503 : 201).end();
    case 'gust':
      await pauza(izmedju(50, 300));
      if (Math.random() < 0.5) { res.setHeader('Retry-After', '1'); return res.status(429).end(); }
      return res.status(201).end();
    default: await pauza(izmedju(50, 400)); return res.status(201).end();
  }
}
