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
