/* Kratka dijagnostika — je li sve spremno za dnevno slanje.
   Vraca samo IMENA nadenih varijabli, nikad vrijednosti. */
import { vapidSpreman } from './_lib/push.js';
import { kvSpreman, brojPretplata, kvVarijable } from './_lib/kv.js';

export default async function handler(req, res) {
  let pretplata = null, greska = null;
  if (kvSpreman()) {
    try { pretplata = await brojPretplata(); } catch (e) { greska = e.message; }
  }

  const vapid = vapidSpreman();
  const baza = kvSpreman();
  const cronTajna = Boolean(process.env.CRON_SECRET);

  const nedostaje = [
    ...(vapid ? [] : ['VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY']),
    ...(baza ? [] : ['KV_REST_API_URL / _TOKEN (ili UPSTASH_REDIS_REST_URL / _TOKEN)']),
    ...(cronTajna ? [] : ['CRON_SECRET']),
  ];

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    vapid,
    baza,
    bazaVarijable: kvVarijable(),
    cronTajna,
    pretplata,
    greska,
    spremno: vapid && baza,
    ...(nedostaje.length ? { nedostaje } : {}),
  });
}
