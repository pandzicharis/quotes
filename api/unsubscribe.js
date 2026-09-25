import { skiniPretplatu, bazaSpremna } from './_lib/baza.js';
import { citajTijelo } from './_lib/push.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ greska: 'Samo POST' });
  if (!bazaSpremna()) return res.status(503).json({ greska: 'Baza pretplata nije konfigurisana' });

  /* Klijent šalje i ključeve, ali ih ovdje ne treba: `endpoint` je jedinstven
     u tabeli, pa je brisanje jedan upit bez ikakvog prolaska kroz zapise. */
  const { endpoint } = citajTijelo(req) || {};
  if (!endpoint) return res.status(400).json({ greska: 'Nedostaje endpoint' });

  try {
    const obrisano = await skiniPretplatu(endpoint);
    res.status(200).json({ ok: true, obrisano });
  } catch (e) {
    res.status(500).json({ greska: e.message });
  }
}
