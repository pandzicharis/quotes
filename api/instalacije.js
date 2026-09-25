/* Broj instalacija po platformi — najmanje što treba da se zna koliko je
   ljudi stavilo aplikaciju na početni ekran, bez ikakvog dashboarda.

     POST /api/instalacije                  ← aplikacija se javi, jednom po uređaju
     GET  /api/instalacije?secret=<tajna>   ← obican tekst sa brojevima

   GET je zaštićen istom tajnom kao /api/send i /api/test (CRON_SECRET), pa je
   dovoljno spasiti tu adresu u zabilješke preglednika i otvoriti je kad zatreba.
   Prihvata i `x-cron-secret` i `Authorization: Bearer`, vidi _lib/auth.js. */

import { bazaSpremna, zabiljeziInstalaciju, sveInstalacije, brojPretplata, PLATFORME } from './_lib/baza.js';
import { citajTijelo } from './_lib/push.js';
import { ovlascen, odbij } from './_lib/auth.js';

/* Oznaka uređaja je nasumičan heksadecimalni niz koji aplikacija sama napravi.
   Granice su tu da niko ne ubacuje proizvoljno velike zapise u bazu. */
const JE_OZNAKA = s => typeof s === 'string' && /^[a-f0-9]{8,64}$/.test(s);

const NAZIVI = { ios: 'iPhone / iPad', android: 'Android', ostalo: 'Računar / ostalo' };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST') return zabiljezi(req, res);
  if (req.method === 'GET') return izvjestaj(req, res);
  return res.status(405).json({ greska: 'Samo GET ili POST' });
}

/* ---------- POST: aplikacija javlja instalaciju ---------- */
async function zabiljezi(req, res) {
  if (!bazaSpremna()) return res.status(503).json({ greska: 'Baza nije konfigurisana' });

  const t = citajTijelo(req);
  const platforma = PLATFORME.includes(t?.platforma) ? t.platforma : null;
  if (!platforma || !JE_OZNAKA(t?.uredjaj)) {
    return res.status(400).json({ greska: 'Neispravna platforma ili oznaka uređaja' });
  }

  try {
    const dodano = await zabiljeziInstalaciju(platforma, t.uredjaj);
    // `novo: false` znači da je uređaj već brojan — aplikacija svejedno upamti
    // da se javila, pa se ovo ne ponavlja pri svakom otvaranju
    res.status(200).json({ ok: true, novo: dodano === 1 });
  } catch (e) {
    res.status(500).json({ greska: e.message });
  }
}

/* ---------- GET: tekstualni izvještaj ---------- */
async function izvjestaj(req, res) {
  if (!ovlascen(req)) return odbij(res);
  if (!bazaSpremna()) return res.status(503).json({ greska: 'Baza nije konfigurisana' });

  try {
    const [brojevi, pretplata] = await Promise.all([sveInstalacije(), brojPretplata()]);
    const ukupno = PLATFORME.reduce((z, p) => z + brojevi[p], 0);

    // brojevi poravnati desno, da se kolona čita odozgo nadolje
    const sirina = Math.max(...Object.values(NAZIVI).map(n => n.length), 'Ukupno'.length);
    const red = (ime, broj) => `${ime.padEnd(sirina)}  ${String(broj).padStart(6)}`;

    const tekst = [
      'PORUKA DANA — instalacije',
      `osvježeno: ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`,
      '',
      ...PLATFORME.map(p => red(NAZIVI[p], brojevi[p])),
      '-'.repeat(sirina + 8),
      red('Ukupno', ukupno),
      '',
      `Pretplaćeno na notifikacije: ${pretplata ?? 0}`,
      '',
      'Broji se uređaj, ne otvaranje: ista aplikacija otvorena sto puta ostaje',
      'jedan. Broji se tek kad aplikacija radi sa početnog ekrana — otvaranje',
      'u pregledniku ne ulazi u račun.',
      '',
    ].join('\n');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(tekst);
  } catch (e) {
    res.status(500).json({ greska: e.message });
  }
}
