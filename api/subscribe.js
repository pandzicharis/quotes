import { dodajPretplatu, bazaSpremna } from './_lib/baza.js';
import { citajTijelo } from './_lib/push.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ greska: 'Samo POST' });
  if (!bazaSpremna()) return res.status(503).json({ greska: 'Baza pretplata nije konfigurisana' });

  const sub = citajTijelo(req);
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ greska: 'Neispravna pretplata' });
  }

  try {
    await dodajPretplatu(sub);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ greska: e.message });
  }
}
