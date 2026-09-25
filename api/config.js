/* Javni VAPID ključ za klijenta. Bez njega aplikacija radi lokalno. */
import { vapidSpreman } from './_lib/push.js';
import { bazaSpremna } from './_lib/baza.js';

export default function handler(req, res) {
  /* Odgovor je javan i mijenja se samo s deployom (promjena varijable okoline
     na Vercelu traži novi deploy, a deploy prazni CDN keš). Zato ga drži CDN
     umjesto da svako otvaranje aplikacije budi funkciju. */
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json({
    vapidPublicKey: vapidSpreman() ? process.env.VAPID_PUBLIC_KEY : null,
    push: vapidSpreman() && bazaSpremna(),
  });
}
