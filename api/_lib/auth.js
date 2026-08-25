/* Provjera tajne za servisne endpointe (/api/send, /api/test).
   Cron servisi šalju tajnu na razne načine, pa prihvatamo sva tri:
     x-cron-secret: <tajna>          ← vanjski cron (cron-job.org i sl.)
     Authorization: Bearer <tajna>   ← Vercel Cron (šalje sam)
     ?secret=<tajna>                 ← ručno, iz curl-a ili preglednika  */

export const jeLokalno = req =>
  /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(req.headers.host || '');

export function ovlascen(req) {
  const tajna = process.env.CRON_SECRET;
  if (!tajna) return jeLokalno(req);   // bez postavljene tajne endpoint radi samo lokalno

  const h = req.headers;
  if (h['x-cron-secret'] === tajna) return true;
  if ((h.authorization || '') === `Bearer ${tajna}`) return true;
  try { return new URL(req.url, 'http://x').searchParams.get('secret') === tajna; }
  catch { return false; }
}

/** Zajednički 401 sa objašnjenjem — da cron konzola pokaže zašto je pala. */
export function odbij(res) {
  return res.status(401).json({
    greska: process.env.CRON_SECRET
      ? 'Nije ovlašćeno — tajna ne odgovara (x-cron-secret / Authorization: Bearer / ?secret=)'
      : 'CRON_SECRET nije postavljen na serveru',
  });
}
