/* Dnevno slanje.
   Okida ga cron — vanjska konzola ili Vercel Cron. Tajna se prihvata kao
   x-cron-secret,  Authorization: Bearer  ili  ?secret=

   Endpoint šalje na SVAKI poziv, bez provjere je li danas već slao. Koliko
   puta korisnik dobije poruku određuje raspored crona, ne aplikacija.

   curl -H "x-cron-secret: <CRON_SECRET>" https://<domen>/api/send  */
import { svePretplate, skiniPretplate, kvSpreman } from './_lib/kv.js';
import { ovlascen, odbij } from './_lib/auth.js';
import { postaviVapid, vapidSpreman, ucitajPoruke, porukaZaDatum, napraviSadrzaj, posalji, danUTC } from './_lib/push.js';

/* Koliko slanja ide paralelno. Bazen radnika, ne serije: u serijama cijela
   grupa čeka najsporiji uređaj, a ovako spor uređaj drži samo svoje mjesto
   dok ostali teku dalje. Posao je čekanje na mrežu, ne procesor, pa je 100
   otvorenih socketa sigurno unutar limita deskriptora koje instanca dijeli. */
const RADNIKA = 100;

/* Kad se približimo granici trajanja funkcije, prestajemo uzimati nove
   pretplate i vraćamo iskren izvještaj — inače nas platforma presiječe na
   504 bez ijednog podatka o tome dokle se stiglo.

   Vezano za `functions["api/send.js"].maxDuration` u vercel.json: ovo mora
   ostati ispod te vrijednosti. Mijenjaš jedno — provjeri drugo. */
const ROK_MS = 240_000;

export default async function handler(req, res) {
  if (!ovlascen(req)) return odbij(res);
  if (!vapidSpreman()) return res.status(503).json({ greska: 'VAPID ključevi nisu postavljeni' });
  if (!kvSpreman()) return res.status(503).json({ greska: 'Baza pretplata nije konfigurisana' });

  res.setHeader('Cache-Control', 'no-store');
  const pocetak = Date.now();

  try {
    postaviVapid();
    const podaci = await ucitajPoruke(req);
    const poruka = porukaZaDatum(podaci);
    // isti payload za sve — serijalizuje se jednom, ne po uređaju
    const sadrzaj = JSON.stringify(napraviSadrzaj(podaci, poruka));

    const zapisi = (await svePretplate()) || [];

    let poslano = 0, palo = 0, preskoceno = 0;
    const mrtve = [];
    const greske = {};   // kod → { broj, primjer }

    const zabiljezi = (kod, tekst) => {
      const g = greske[kod] || (greske[kod] = { broj: 0, primjer: tekst });
      g.broj++;
    };

    let sljedeci = 0;
    const radnik = async () => {
      for (;;) {
        const i = sljedeci++;
        if (i >= zapisi.length) return;

        // rok istekao — ostatak reda samo prebrojimo, da izvještaj bude tačan
        if (Date.now() - pocetak > ROK_MS) { preskoceno++; continue; }

        const zapis = zapisi[i];
        let sub;
        try {
          sub = JSON.parse(zapis);
        } catch {
          palo++; zabiljezi('zapis', 'neispravan zapis u bazi'); mrtve.push(zapis); continue;
        }

        const r = await posalji(sub, sadrzaj);
        if (r.ok) { poslano++; continue; }

        palo++;
        zabiljezi(r.kod, r.greska);
        if (r.mrtva) mrtve.push(zapis);
      }
    };

    await Promise.all(Array.from({ length: Math.min(RADNIKA, zapisi.length) }, radnik));

    // mrtve pretplate odlaze u grupama, ne poziv po zapisu
    let ocisceno = 0;
    if (mrtve.length) {
      try { ocisceno = await skiniPretplate(mrtve); } catch { /* tiho — slanje je prošlo */ }
    }

    res.status(200).json({
      ok: preskoceno === 0,
      dan: danUTC(),
      porukaId: poruka.id,
      pretplata: zapisi.length,
      poslano, palo, ocisceno,
      trajanjeMs: Date.now() - pocetak,
      ...(preskoceno
        ? { preskoceno, napomena: `Rok od ${ROK_MS / 1000}s dostignut — ${preskoceno} pretplata nije obrađeno` }
        : {}),
      ...(Object.keys(greske).length ? { greske } : {}),
      ...(zapisi.length ? {} : { napomena: 'Nema ni jedne pretplate u bazi — uređaji nisu registrovani' }),
    });
  } catch (e) {
    res.status(500).json({ greska: e.message, trajanjeMs: Date.now() - pocetak });
  }
}
