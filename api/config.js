/* Javni VAPID ključ za klijenta. Bez njega aplikacija radi lokalno. */
import { vapidSpreman } from './_lib/push.js';
import { kvSpreman } from './_lib/kv.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    vapidPublicKey: vapidSpreman() ? process.env.VAPID_PUBLIC_KEY : null,
    push: vapidSpreman() && kvSpreman(),
  });
}
