/* Upstash Redis preko REST API-ja — bez dodatnih zavisnosti.
   Vercelova Storage → Redis integracija imenuje varijable na dva nacina,
   zavisno od toga je li dodana kroz Marketplace (UPSTASH_REDIS_REST_*) ili
   kao stari Vercel KV (KV_REST_API_*). Prihvatamo oba. */

const IMENA_URL = ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'];
const IMENA_TOKEN = ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'];

const nadji = imena => imena.find(i => process.env[i]);

const URL_ = process.env[nadji(IMENA_URL)];
const TOKEN = process.env[nadji(IMENA_TOKEN)];

export const kvSpreman = () => Boolean(URL_ && TOKEN);

/** Koja su imena varijabli zaista nadena — za /api/status, bez vrijednosti. */
export const kvVarijable = () => ({ url: nadji(IMENA_URL) || null, token: nadji(IMENA_TOKEN) || null });

async function komanda(...cmd) {
  if (!kvSpreman()) throw new Error(`KV nije konfigurisan (${IMENA_URL.join(' ili ')})`);
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`KV ${r.status}: ${await r.text()}`);
  const { result, error } = await r.json();
  if (error) throw new Error(`KV: ${error}`);
  return result;
}

const KLJUC = 'pd:pretplate';

export const dodajPretplatu  = json => komanda('SADD', KLJUC, json);
export const skiniPretplatu  = json => komanda('SREM', KLJUC, json);
export const svePretplate    = () => komanda('SMEMBERS', KLJUC);
export const brojPretplata   = () => komanda('SCARD', KLJUC);

/* Jedan SREM nosi više članova, pa čišćenje mrtvih pretplata nakon dnevnog
   slanja ne znači jedan mrežni poziv po zapisu. Grupa je namjerno mala da
   zahtjev ostane daleko od Upstashovog limita veličine. */
const GRUPA_BRISANJA = 200;

/** Briše više zapisa u grupama. Vraća koliko ih je zaista obrisano. */
export async function skiniPretplate(zapisi) {
  let obrisano = 0;
  for (let i = 0; i < zapisi.length; i += GRUPA_BRISANJA) {
    const grupa = zapisi.slice(i, i + GRUPA_BRISANJA);
    obrisano += (await komanda('SREM', KLJUC, ...grupa)) || 0;
  }
  return obrisano;
}

/* ---------- brojanje instalacija ---------- */
/* Skup, a ne brojač: uređaj šalje nasumičnu oznaku koju sam napravi i čuva,
   pa ponovno otvaranje aplikacije ne diže brojku više puta. SCARD onda daje
   broj različitih uređaja, što je ono što se zaista želi znati. */

export const PLATFORME = ['ios', 'android', 'ostalo'];

const KLJUC_INSTAL = platforma => `pd:instal:${platforma}`;

/** Vraća 1 ako je uređaj nov, 0 ako je već brojan. */
export const zabiljeziInstalaciju = (platforma, uredjaj) =>
  komanda('SADD', KLJUC_INSTAL(platforma), uredjaj);

export const brojInstalacija = platforma => komanda('SCARD', KLJUC_INSTAL(platforma));

/** Sve platforme odjednom → { ios: 12, android: 40, ostalo: 1 }. */
export async function sveInstalacije() {
  const brojevi = await Promise.all(PLATFORME.map(brojInstalacija));
  return Object.fromEntries(PLATFORME.map((p, i) => [p, brojevi[i] || 0]));
}
