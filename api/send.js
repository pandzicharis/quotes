/* Dnevno slanje.
   Okida ga cron — vanjska konzola ili Vercel Cron. Tajna se prihvata kao
   x-cron-secret,  Authorization: Bearer  ili  ?secret=

   Endpoint šalje na SVAKI poziv, bez provjere je li danas već slao. Koliko
   puta korisnik dobije poruku određuje raspored crona, ne aplikacija.

   curl -H "x-cron-secret: <CRON_SECRET>" https://<domen>/api/send  */
import { svePretplate, skiniPretplatu, kvSpreman } from './_lib/kv.js';
import { ovlascen, odbij } from './_lib/auth.js';
import { postaviVapid, vapidSpreman, ucitajPoruke, porukaZaDatum, napraviSadrzaj, posalji, danUTC } from './_lib/push.js';

export default async function handler(req, res) {
  if (!ovlascen(req)) return odbij(res);
  if (!vapidSpreman()) return res.status(503).json({ greska: 'VAPID ključevi nisu postavljeni' });
  if (!kvSpreman()) return res.status(503).json({ greska: 'Baza pretplata nije konfigurisana' });

  res.setHeader('Cache-Control', 'no-store');

  try {
    postaviVapid();
    const podaci = await ucitajPoruke(req);
    const poruka = porukaZaDatum(podaci);
    const sadrzaj = napraviSadrzaj(podaci, poruka);

    const zapisi = (await svePretplate()) || [];
    let poslano = 0, palo = 0, ocisceno = 0;
    const greske = [];

    // u serijama, da se ne otvori previše konekcija odjednom
    const SERIJA = 50;
    for (let i = 0; i < zapisi.length; i += SERIJA) {
      const grupa = zapisi.slice(i, i + SERIJA);
      const rezultati = await Promise.all(grupa.map(async zapis => {
        let sub;
        try { sub = JSON.parse(zapis); } catch { return { mrtva: true, greska: 'neispravan zapis', zapis }; }
        const r = await posalji(sub, sadrzaj);
        return { ...r, zapis };
      }));

      for (const r of rezultati) {
        if (r.ok) poslano++;
        else {
          palo++;
          if (greske.length < 3) greske.push(r.greska);
          if (r.mrtva) { try { await skiniPretplatu(r.zapis); ocisceno++; } catch { /* tiho */ } }
        }
      }
    }

    res.status(200).json({
      ok: true,
      dan: danUTC(),
      porukaId: poruka.id,
      pretplata: zapisi.length,
      poslano, palo, ocisceno,
      ...(greske.length ? { greske } : {}),
      ...(zapisi.length ? {} : { napomena: 'Nema ni jedne pretplate u bazi — uređaji nisu registrovani' }),
    });
  } catch (e) {
    res.status(500).json({ greska: e.message });
  }
}
