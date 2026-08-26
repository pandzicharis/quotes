/* Zajednička logika: VAPID, izbor poruke dana, slanje. */
import webpush from 'web-push';

const DAN_MS = 86400000;

export function vapidSpreman() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let postavljen = false;
export function postaviVapid() {
  if (postavljen) return;
  if (!vapidSpreman()) throw new Error('VAPID ključevi nisu postavljeni');
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:info@ammarbasic.ba',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  postavljen = true;
}

/** Statični JSON se čita sa istog deploya — uvijek je u sinhronu sa aplikacijom. */
export async function ucitajPoruke(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const r = await fetch(`${proto}://${host}/data/poruke.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`poruke.json HTTP ${r.status}`);
  return r.json();
}

/** Ista formula kao u klijentu: isti dan → ista poruka. */
export function porukaZaDatum(podaci, d = new Date()) {
  const dana = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAN_MS);
  const n = podaci.poruke.length;
  return podaci.poruke[((dana % n) + n) % n];
}

/** Koliko karaktera najviše ide u notifikaciju. */
export const NOTIF_MAKS = 120;

/**
 * Na telefonu se od notifikacije vidi tek red-dva, pa u nju ide samo prva
 * rečenica. Ako je i ona duža od `maks`, siječe se na granici riječi —
 * nikad usred riječi. Kad je bilo šta odsječeno, na kraj ide „…“.
 */
export function kratkaPoruka(tekst, maks = NOTIF_MAKS) {
  const cio = String(tekst || '').replace(/\s+/g, ' ').trim();
  if (!cio) return '';

  const kraj = cio.search(/[.!?][»”"']?(\s|$)/);
  let isjecak = kraj === -1 ? cio : cio.slice(0, kraj + 1);
  let skraceno = isjecak.length < cio.length;

  if (isjecak.length > maks) {
    const grubo = isjecak.slice(0, maks);
    const razmak = grubo.lastIndexOf(' ');
    isjecak = razmak > maks * 0.6 ? grubo.slice(0, razmak) : grubo;
    skraceno = true;
  }

  // cijela poruka je stala — ostavljamo je s njenom interpunkcijom
  if (!skraceno) return isjecak;
  return `${isjecak.replace(/[\s.,;:!?…„“”»«—–-]+$/, '')}…`;
}

export function napraviSadrzaj(podaci, poruka) {
  return {
    title: 'Nova poruka dana',
    body: kratkaPoruka(poruka.tekst),
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-192.png',
    tag: 'poruka-dana',
    url: '/',
  };
}

/** Vraća true ako je pretplata mrtva i treba je obrisati. */
export async function posalji(pretplata, sadrzaj) {
  try {
    await webpush.sendNotification(pretplata, JSON.stringify(sadrzaj), { TTL: 20 * 3600 });
    return { ok: true, mrtva: false };
  } catch (e) {
    const kod = e.statusCode || 0;
    return { ok: false, mrtva: kod === 404 || kod === 410, greska: `${kod} ${e.message}` };
  }
}

export function citajTijelo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  return null;
}

/** Dan po UTC-u (YYYY-MM-DD) — isti ključ koji koristi brava dnevnog slanja. */
export const danUTC = (d = new Date()) => d.toISOString().slice(0, 10);
