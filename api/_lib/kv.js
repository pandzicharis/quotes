/* Upstash Redis preko REST API-ja — bez dodatnih zavisnosti.
   Vercel integracija (Storage → Redis) postavi KV_REST_API_URL i _TOKEN. */

const URL_ = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

export const kvSpreman = () => Boolean(URL_ && TOKEN);

async function komanda(...cmd) {
  if (!kvSpreman()) throw new Error('KV nije konfigurisan (KV_REST_API_URL / KV_REST_API_TOKEN)');
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
