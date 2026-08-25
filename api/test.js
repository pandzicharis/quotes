/* Test notifikacija na jedan uređaj — poziva aplikacija iz postavki. */
import { postaviVapid, vapidSpreman, ucitajPoruke, porukaZaDatum, napraviSadrzaj, posalji, citajTijelo } from './_lib/push.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ greska: 'Samo POST' });
  if (!vapidSpreman()) return res.status(503).json({ greska: 'VAPID ključevi nisu postavljeni' });

  const { subscription } = citajTijelo(req) || {};
  if (!subscription?.endpoint) return res.status(400).json({ greska: 'Nedostaje pretplata' });

  try {
    postaviVapid();
    const podaci = await ucitajPoruke(req);
    const sadrzaj = napraviSadrzaj(podaci, porukaZaDatum(podaci));
    sadrzaj.title = 'Test · Poruka dana';
    sadrzaj.tag = 'poruka-test';

    const r = await posalji(subscription, sadrzaj);
    if (!r.ok) return res.status(502).json({ greska: r.greska });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ greska: e.message });
  }
}
