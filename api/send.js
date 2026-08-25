/* Dnevno slanje — poziva Vercel Cron (vercel.json → crons).
   Vercel automatski šalje Authorization: Bearer $CRON_SECRET.
   Ručno testiranje:  curl -H "Authorization: Bearer <CRON_SECRET>" https://<domen>/api/send  */
import { svePretplate, skiniPretplatu, kvSpreman } from './_lib/kv.js';
import { postaviVapid, vapidSpreman, ucitajPoruke, porukaZaDatum, napraviSadrzaj, posalji } from './_lib/push.js';

function ovlascen(req) {
  const tajna = process.env.CRON_SECRET;
  if (!tajna) return true;                       // bez tajne endpoint je otvoren (samo za razvoj)
  const zaglavlje = req.headers.authorization || '';
  if (zaglavlje === `Bearer ${tajna}`) return true;
  const url = new URL(req.url, 'http://x');
  return url.searchParams.get('secret') === tajna;
}

export default async function handler(req, res) {
  if (!ovlascen(req)) return res.status(401).json({ greska: 'Nije ovlašćeno' });
  if (!vapidSpreman()) return res.status(503).json({ greska: 'VAPID ključevi nisu postavljeni' });
  if (!kvSpreman()) return res.status(503).json({ greska: 'Baza pretplata nije konfigurisana' });

  try {
    postaviVapid();
    const podaci = await ucitajPoruke(req);
    const poruka = porukaZaDatum(podaci);
    const sadrzaj = napraviSadrzaj(podaci, poruka);

    const zapisi = (await svePretplate()) || [];
    let poslano = 0, palo = 0, ocisceno = 0;

    // u serijama, da se ne otvori previše konekcija odjednom
    const SERIJA = 50;
    for (let i = 0; i < zapisi.length; i += SERIJA) {
      const grupa = zapisi.slice(i, i + SERIJA);
      const rezultati = await Promise.all(grupa.map(async zapis => {
        let sub;
        try { sub = JSON.parse(zapis); } catch { return { mrtva: true, zapis }; }
        const r = await posalji(sub, sadrzaj);
        return { ...r, zapis };
      }));

      for (const r of rezultati) {
        if (r.ok) poslano++;
        else {
          palo++;
          if (r.mrtva) { try { await skiniPretplatu(r.zapis); ocisceno++; } catch { /* tiho */ } }
        }
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      porukaId: poruka.id,
      pretplata: zapisi.length,
      poslano, palo, ocisceno,
    });
  } catch (e) {
    res.status(500).json({ greska: e.message });
  }
}
