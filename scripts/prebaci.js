/* Seoba pretplata i instalacija iz Upstash Redisa u Supabase.
   Jednokratno. Čita iz Redisa, upisuje u Postgres, ništa ne briše — stari
   podaci ostaju gdje jesu dok se brojevi ne poklope.

     npm run prebaci              ← probni hod, samo broji
     npm run prebaci -- --upisi   ← stvarni upis

   Traži oba seta varijabli: KV_REST_API_* (izvor) i SUPABASE_URL +
   SUPABASE_SECRET_KEY (odredište). Čita ih iz `.env` ako nisu u okruženju. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Node ima `--env-file`, ali tek od 20.6 — ovdje je ručno, da skripta radi i
   na starijem nodeu. Varijabla koja već postoji u okruženju ima prednost.
   kv.js i baza.js čitaju env u trenutku učitavanja, pa moraju doći poslije
   ovoga — zato su dolje dinamički `await import`, a ne obični import. */
function ucitajEnv() {
  const korijen = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  let tekst;
  try { tekst = fs.readFileSync(path.join(korijen, '.env'), 'utf8'); } catch { return; }

  for (const linija of tekst.split('\n')) {
    const m = linija.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    const vrijednost = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (vrijednost && !process.env[m[1]]) process.env[m[1]] = vrijednost;
  }
}
ucitajEnv();

const { svePretplate: redisPretplate, kvSpreman, PLATFORME } = await import('./kv.js');
const { dodajPretplate, zabiljeziInstalaciju, brojPretplata, sveInstalacije, bazaSpremna } =
  await import('../api/_lib/baza.js');

const UPISI = process.argv.includes('--upisi');
const GRUPA = 500;

/* Čita oznake uređaja iz Redis skupa direktno — kv.js izvozi samo SCARD,
   a ovdje trebaju same članove. */
async function redisInstalacije(platforma) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SMEMBERS', `pd:instal:${platforma}`]),
  });
  if (!r.ok) throw new Error(`KV ${r.status}: ${await r.text()}`);
  return (await r.json()).result || [];
}

function provjeriOkruzenje() {
  const fali = [
    ...(kvSpreman() ? [] : ['KV_REST_API_URL / KV_REST_API_TOKEN (izvor)']),
    ...(bazaSpremna() ? [] : ['SUPABASE_URL / SUPABASE_SECRET_KEY (odredište)']),
  ];
  if (fali.length) {
    console.error('Nedostaje u okruženju:\n  ' + fali.join('\n  '));
    console.error('\nPopuni .env u korijenu projekta, pa: npm run prebaci');
    process.exit(1);
  }
}

async function prebaciPretplate() {
  const zapisi = (await redisPretplate()) || [];
  const dobre = [];
  let neispravnih = 0;

  for (const zapis of zapisi) {
    try {
      const sub = JSON.parse(zapis);
      if (sub?.endpoint && sub?.keys?.p256dh && sub?.keys?.auth) dobre.push(sub);
      else neispravnih++;
    } catch { neispravnih++; }
  }

  // isti endpoint je u setu mogao stajati u dva oblika — u tabeli je jedan red
  const jedinstvene = [...new Map(dobre.map(s => [s.endpoint, s])).values()];

  console.log(`Redis:    ${zapisi.length} zapisa → ${jedinstvene.length} jedinstvenih pretplata` +
    (neispravnih ? `, ${neispravnih} neispravnih (preskočeno)` : '') +
    (dobre.length - jedinstvene.length ? `, ${dobre.length - jedinstvene.length} duplikata spojeno` : ''));

  if (!UPISI) return;

  for (let i = 0; i < jedinstvene.length; i += GRUPA) {
    await dodajPretplate(jedinstvene.slice(i, i + GRUPA));
    console.log(`  upisano ${Math.min(i + GRUPA, jedinstvene.length)}/${jedinstvene.length}`);
  }
}

async function prebaciInstalacije() {
  for (const platforma of PLATFORME) {
    const oznake = await redisInstalacije(platforma);
    console.log(`Redis:    ${oznake.length} uređaja (${platforma})`);
    if (!UPISI) continue;

    let novih = 0;
    for (const oznaka of oznake) {
      try { novih += await zabiljeziInstalaciju(platforma, oznaka); }
      catch (e) { console.warn(`  preskočeno ${platforma}/${oznaka}: ${e.message}`); }
    }
    console.log(`  upisano ${novih} novih (${platforma})`);
  }
}

provjeriOkruzenje();
if (!UPISI) console.log('PROBNI HOD — ništa se ne upisuje. Dodaj --upisi za stvarnu seobu.\n');

await prebaciPretplate();
await prebaciInstalacije();

const [pretplata, instalacije] = await Promise.all([brojPretplata(), sveInstalacije()]);
console.log(`\nSupabase: ${pretplata} pretplata, instalacije ${JSON.stringify(instalacije)}`);
