/* Kratka dijagnostika — je li sve spremno za dnevno slanje.
   Vraca samo IMENA nadenih varijabli, nikad vrijednosti. */
import { vapidSpreman } from './_lib/push.js';
import { bazaSpremna, brojPretplata, bazaVarijable } from './_lib/baza.js';

export default async function handler(req, res) {
  let pretplata = null, greska = null;
  if (bazaSpremna()) {
    try { pretplata = await brojPretplata(); } catch (e) { greska = e.message; }
  }

  const vapid = vapidSpreman();
  const baza = bazaSpremna();
  const varijable = bazaVarijable();
  const cronTajna = Boolean(process.env.CRON_SECRET);

  const nedostaje = [
    ...(vapid ? [] : ['VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY']),
    ...(baza ? [] : [varijable.javniKljuc
      // ključ je nađen, ali je pogrešne vrste — to je druga poruka od „nema ga"
      ? 'SUPABASE_SECRET_KEY (postavljen je publishable/anon ključ, treba tajni)'
      : 'SUPABASE_URL / SUPABASE_SECRET_KEY']),
    ...(cronTajna ? [] : ['CRON_SECRET']),
  ];

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    vapid,
    baza,
    bazaVarijable: varijable,
    cronTajna,
    pretplata,
    greska,
    spremno: vapid && baza,
    ...(nedostaje.length ? { nedostaje } : {}),
  });
}
