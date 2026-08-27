import { svePretplate, skiniPretplatu, skiniPretplate, kvSpreman } from './_lib/kv.js';
import { citajTijelo } from './_lib/push.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ greska: 'Samo POST' });
  if (!kvSpreman()) return res.status(503).json({ greska: 'Baza pretplata nije konfigurisana' });

  const { endpoint, keys } = citajTijelo(req) || {};
  if (!endpoint) return res.status(400).json({ greska: 'Nedostaje endpoint' });

  try {
    /* Ako je klijent poslao cijelu pretplatu, zapis je poznat — briše se jednim
       pozivom, bez čitanja cijelog seta. Isti oblik i isti red ključeva kao u
       /api/subscribe, inače se niz ne bi poklopio. */
    if (keys?.p256dh && keys?.auth) {
      const zapis = JSON.stringify({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
      const obrisano = await skiniPretplatu(zapis);
      if (obrisano) return res.status(200).json({ ok: true, obrisano });
      // nije se poklopilo (zapis starije verzije) — padamo na pretragu ispod
    }

    /* Stariji klijenti šalju samo endpoint. Tada nema druge nego proći set;
       poklopljeni zapisi odlaze u jednom SREM-u. */
    const sve = (await svePretplate()) || [];
    const zaBrisanje = sve.filter(zapis => {
      try { return JSON.parse(zapis).endpoint === endpoint; }
      catch { return false; }     // neispravan zapis, preskoči
    });

    const obrisano = zaBrisanje.length ? await skiniPretplate(zaBrisanje) : 0;
    res.status(200).json({ ok: true, obrisano });
  } catch (e) {
    res.status(500).json({ greska: e.message });
  }
}
