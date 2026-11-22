/* Reels iz hafizovih predavanja — admin strana. Ide kroz /api/poruke?reels=…
   (bez nove Vercel funkcije). Posao radi radnik u Dockeru na laptopu
   (alati/reels/radnik.py): čita red iz `reels_poslovi`, gotove reelse stavlja
   u Storage bucket `reels`. Ovdje admin samo upisuje i čita; sve traži admina.

     GET  ?reels=lista                 { poslovi, radnik: { vidjen, ziv } }
     GET  ?reels=posao&id=…            posao + potpisani linkovi (reelsi, rečenice)
     POST ?reels=novi     { url }      novi posao (isti video → postojeći)
     POST ?reels=sacuvaj  { id, verzija, isjecci, tema?, tema_rucno? }
     POST ?reels=napravi  { … isto }   sačuvaj i traži izradu izmijenjenih
     POST ?reels=predlozi { id }       AI bira iznova (izmjene se gube)
     POST ?reels=obrisi   { id }       posao i njegovi fajlovi, za stalno   */
import { ovlascenAdmin, odbijAdmin } from './auth.js';
import { citajTijelo } from './push.js';
import {
  reelsPoslovi, reelsPosao, reelsPoYoutubeu, reelsNovi, reelsIzmijeni, reelsObrisi, reelsRadnik,
  potpisiFajlove, obrisiFolder,
} from './baza.js';

const BUCKET = 'reels';
const ZIV_S = 90;                     // radnik se javlja svakih ~20 s
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const greska = (status, poruka) => Object.assign(new Error(poruka), { status });

export function youtubeId(url) {
  const s = String(url || '').trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(s) ? s : null;
}

const idIz = v => {
  const id = String(v || '');
  if (!UUID.test(id)) throw greska(400, 'Neispravan posao');
  return id;
};

/** Isječci od admina: niz objekata, razumne veličine (titlovi su unutra). */
function isjecciIz(t) {
  if (!Array.isArray(t.isjecci) || t.isjecci.length > 20 || JSON.stringify(t.isjecci).length > 400_000) {
    throw greska(400, 'Neispravni isječci');
  }
  return t.isjecci;
}

function izmjena(t) {
  const p = { isjecci: isjecciIz(t) };
  if (typeof t.tema === 'string') p.tema = t.tema.trim().slice(0, 80);
  if (typeof t.tema_rucno === 'boolean') p.tema_rucno = t.tema_rucno;
  return p;
}

async function sacuvaj(t, dodatno = {}) {
  const id = idIz(t.id);
  const red = await reelsIzmijeni(id, { ...izmjena(t), ...dodatno }, t.verzija);
  if (!red) throw greska(409, 'AI je u međuvremenu napravio novi izbor isječaka. Osvježi stranicu.');
  return { ok: true, verzija: red.verzija };
}

async function lista() {
  const [poslovi, radnik] = await Promise.all([reelsPoslovi(), reelsRadnik()]);
  const vidjen = radnik?.vidjen || null;
  return {
    poslovi: poslovi.map(({ gotovi, ...p }) => ({ ...p, gotovih: (gotovi || []).length })),
    radnik: { vidjen, ziv: Boolean(vidjen) && Date.now() - Date.parse(vidjen) < ZIV_S * 1000, posao: radnik?.posao || null },
  };
}

async function posao(idParam) {
  const id = idIz(idParam);
  const p = await reelsPosao(id);
  if (!p) throw greska(404, 'Nema tog posla');
  const putevi = [...(p.gotovi || []).map(g => g.put), `${id}/recenice.json`];
  const linkovi = await potpisiFajlove(BUCKET, putevi).catch(() => ({}));
  p.gotovi = (p.gotovi || []).map(g => linkovi[g.put]
    ? { ...g, url: linkovi[g.put], preuzmi: `${linkovi[g.put]}&download=${encodeURIComponent(g.ime)}` }
    : g);
  p.recenice_url = linkovi[`${id}/recenice.json`] || null;
  return p;
}

export async function reels(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!ovlascenAdmin(req)) return odbijAdmin(res);
  const radnja = new URL(req.url, 'http://x').searchParams.get('reels');
  try {
    if (req.method === 'GET') {
      if (radnja === 'lista') return res.status(200).json(await lista());
      if (radnja === 'posao') return res.status(200).json(await posao(new URL(req.url, 'http://x').searchParams.get('id')));
    }
    if (req.method === 'POST') {
      const t = citajTijelo(req) || {};
      if (radnja === 'novi') {
        const yt = youtubeId(t.url);
        if (!yt) throw greska(400, 'Ne prepoznajem YouTube link.');
        const postoji = await reelsPoYoutubeu(yt);
        if (postoji) return res.status(200).json({ id: postoji.id, postoji: true });
        const red = await reelsNovi({ url: `https://www.youtube.com/watch?v=${yt}`, yt_id: yt });
        return res.status(201).json({ id: red.id });
      }
      if (radnja === 'sacuvaj') return res.status(200).json(await sacuvaj(t));
      if (radnja === 'napravi') return res.status(200).json(await sacuvaj(t, { zahtjev: 'napravi', greska: null }));
      if (radnja === 'predlozi') {
        const red = await reelsIzmijeni(idIz(t.id), { zahtjev: 'predlozi', greska: null });
        if (!red) throw greska(404, 'Nema tog posla');
        return res.status(200).json({ ok: true });
      }
      if (radnja === 'obrisi') {
        const id = idIz(t.id);
        await obrisiFolder(BUCKET, id);
        await reelsObrisi(id);
        return res.status(200).json({ ok: true });
      }
    }
    return res.status(400).json({ greska: 'Nepoznata radnja' });
  } catch (e) {
    return res.status(e.status || 500).json({ greska: e.message });
  }
}
