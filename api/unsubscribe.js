import { svePretplate, skiniPretplatu, kvSpreman } from './_lib/kv.js';
import { citajTijelo } from './_lib/push.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ greska: 'Samo POST' });
  if (!kvSpreman()) return res.status(503).json({ greska: 'Baza pretplata nije konfigurisana' });

  const { endpoint } = citajTijelo(req) || {};
  if (!endpoint) return res.status(400).json({ greska: 'Nedostaje endpoint' });

  try {
    const sve = (await svePretplate()) || [];
    let obrisano = 0;
    for (const zapis of sve) {
      try {
        if (JSON.parse(zapis).endpoint === endpoint) { await skiniPretplatu(zapis); obrisano++; }
      } catch { /* neispravan zapis, preskoči */ }
    }
    res.status(200).json({ ok: true, obrisano });
  } catch (e) {
    res.status(500).json({ greska: e.message });
  }
}
