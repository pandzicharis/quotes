/* Supabase (Postgres) preko PostgREST-a — bez dodatnih zavisnosti, kao što je
   raniji Upstash adapter išao na Redis REST. Jedan `fetch`, nikakav klijent.

   Serverski ključ je OBAVEZAN. Publishable/anon ključ ovdje ne vrijedi ništa:
   tabele su pod RLS-om bez ijedne politike, pa mu Postgres ne da ni red. To
   je namjerno — u `pretplate` stoje kriptografski ključevi tuđih uređaja.

   Varijable (prihvata se bilo koje ime iz para):
     SUPABASE_URL          ili  NEXT_PUBLIC_SUPABASE_URL
     SUPABASE_SECRET_KEY   ili  SUPABASE_SERVICE_ROLE_KEY               */

const IMENA_URL = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
const IMENA_KLJUC = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

const nadji = imena => imena.find(i => process.env[i]);

const URL_ = (process.env[nadji(IMENA_URL)] || '').replace(/\/+$/, '');
const KLJUC = process.env[nadji(IMENA_KLJUC)] || '';

/* Najčešća greška pri postavljanju: na server ode `sb_publishable_…` (ili
   stari anon JWT) umjesto tajnog ključa. Tada svaki upit vrati prazno ili
   401, a uzrok nije očigledan — pa ga prepoznajemo unaprijed. */
function jeJavni(k) {
  if (k.startsWith('sb_publishable_')) return true;
  try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64').toString()).role === 'anon'; }
  catch { return false; }
}

const JAVNI = Boolean(KLJUC) && jeJavni(KLJUC);

export const bazaSpremna = () => Boolean(URL_ && KLJUC && !JAVNI);

/** Šta je nađeno — samo imena i dijagnoza, nikad vrijednosti. */
export const bazaVarijable = () => ({
  url: nadji(IMENA_URL) || null,
  kljuc: nadji(IMENA_KLJUC) || null,
  javniKljuc: JAVNI || undefined,
});

const TAB_PRETPLATE = 'pretplate';
const TAB_INSTALACIJE = 'instalacije';

async function zahtjev(putanja, opcije = {}, dozvoljeni = []) {
  if (!bazaSpremna()) {
    throw new Error(JAVNI
      ? 'Na serveru stoji publishable/anon ključ — treba tajni (SUPABASE_SECRET_KEY)'
      : `Supabase nije konfigurisan (${IMENA_URL.join(' ili ')} + ${IMENA_KLJUC.join(' ili ')})`);
  }

  const r = await fetch(`${URL_}/rest/v1/${putanja}`, {
    ...opcije,
    headers: {
      apikey: KLJUC,
      Authorization: `Bearer ${KLJUC}`,
      'Content-Type': 'application/json',
      ...opcije.headers,
    },
  });

  if (!r.ok && !dozvoljeni.includes(r.status)) {
    throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  return r;
}

/* ---------- pretplate ---------- */

/** Upis je upsert po `endpoint`-u: isti uređaj se ne duplira, a rotirani
    ključevi pregledníka se zapišu preko starih umjesto da naprave drugi red. */
export async function dodajPretplatu(sub) {
  await zahtjev(`${TAB_PRETPLATE}?on_conflict=endpoint`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }),
  });
}

/* Isti upsert, ali za više pretplata odjednom — koristi ga seoba iz Redisa
   (scripts/prebaci.js), da stotine zapisa ne znače stotine zahtjeva. */
export async function dodajPretplate(subovi) {
  if (!subovi.length) return;
  await zahtjev(`${TAB_PRETPLATE}?on_conflict=endpoint`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(subovi.map(s => ({ endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth }))),
  });
}

/** Briše po endpointu. Vraća koliko je redova otišlo (0 ako ga nije bilo). */
export async function skiniPretplatu(endpoint) {
  const r = await zahtjev(`${TAB_PRETPLATE}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  return (await r.json()).length;
}

/* PostgREST vraća najviše `max-rows` po odgovoru, a i da ne vraća, jedan
   ogroman JSON nije ono što želimo u memoriji funkcije. Zato stranice po
   1000 redova — granica koja je kod Redisa bila tvrda (cijeli `SMEMBERS` u
   jednom odgovoru) ovdje više ne postoji. */
const STRANICA = 1000;

/** Sve pretplate u obliku koji `web-push` prima direktno, plus `id` za brisanje. */
export async function svePretplate() {
  const sve = [];
  for (let od = 0; ; od += STRANICA) {
    const r = await zahtjev(
      `${TAB_PRETPLATE}?select=id,endpoint,p256dh,auth&order=id.asc`,
      { headers: { 'Range-Unit': 'items', Range: `${od}-${od + STRANICA - 1}` } },
      [416],   // zadnja stranica je tačno puna → sljedeći raspon je izvan tabele
    );
    if (r.status === 416) return sve;

    const redovi = await r.json();
    for (const red of redovi) {
      sve.push({ id: red.id, endpoint: red.endpoint, keys: { p256dh: red.p256dh, auth: red.auth } });
    }
    if (redovi.length < STRANICA) return sve;
  }
}

const izContentRange = r => {
  const zaglavlje = r.headers.get('content-range') || '';
  const ukupno = Number(zaglavlje.split('/')[1]);
  return Number.isFinite(ukupno) ? ukupno : 0;
};

export async function brojPretplata() {
  const r = await zahtjev(`${TAB_PRETPLATE}?select=id`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
  });
  return izContentRange(r);
}

/* Brisanje ide po brojčanom `id`-u, ne po endpointu: endpoint je ~200 znakova
   i lista bi probila dužinu URL-a već na desetak zapisa. Ovako u jedan
   zahtjev stane cijela grupa. */
const GRUPA_BRISANJA = 200;

/** Briše više pretplata po id-u. Vraća koliko ih je zaista obrisano. */
export async function skiniPretplate(idevi) {
  let obrisano = 0;
  for (let i = 0; i < idevi.length; i += GRUPA_BRISANJA) {
    const grupa = idevi.slice(i, i + GRUPA_BRISANJA);
    const r = await zahtjev(`${TAB_PRETPLATE}?id=in.(${grupa.join(',')})`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    obrisano += (await r.json()).length;
  }
  return obrisano;
}

/* ---------- brojanje instalacija ---------- */
/* Isto što je ranije radio `SADD` u skup: uređaj šalje nasumičnu oznaku koju
   sam napravi i čuva, pa ponovno otvaranje ne diže brojku. Ovdje to nosi
   primarni ključ (platforma, uredjaj) — drugi upis istog para ne prolazi. */

export const PLATFORME = ['ios', 'android', 'ostalo'];

/** Vraća 1 ako je uređaj nov, 0 ako je već brojan. */
export async function zabiljeziInstalaciju(platforma, uredjaj) {
  const r = await zahtjev(`${TAB_INSTALACIJE}?on_conflict=platforma,uredjaj`, {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ platforma, uredjaj }),
  });
  return (await r.json()).length ? 1 : 0;
}

export async function brojInstalacija(platforma) {
  const r = await zahtjev(`${TAB_INSTALACIJE}?select=uredjaj&platforma=eq.${platforma}`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
  });
  return izContentRange(r);
}

/** Sve platforme odjednom → { ios: 12, android: 40, ostalo: 1 }. */
export async function sveInstalacije() {
  const brojevi = await Promise.all(PLATFORME.map(brojInstalacija));
  return Object.fromEntries(PLATFORME.map((p, i) => [p, brojevi[i] || 0]));
}
