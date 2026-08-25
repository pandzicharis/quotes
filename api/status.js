/* Kratka dijagnostika — je li sve spremno za dnevno slanje. */
import { vapidSpreman } from './_lib/push.js';
import { kvSpreman, brojPretplata } from './_lib/kv.js';

export default async function handler(req, res) {
  let pretplata = null, greska = null;
  if (kvSpreman()) {
    try { pretplata = await brojPretplata(); } catch (e) { greska = e.message; }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    vapid: vapidSpreman(),
    baza: kvSpreman(),
    cronTajna: Boolean(process.env.CRON_SECRET),
    pretplata,
    greska,
    spremno: vapidSpreman() && kvSpreman(),
  });
}
