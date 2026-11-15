#!/usr/bin/env node
/* Proba opterećenja na TESTU — poruka dana s brojem korisnika kao u produkciji.
 *
 *   1. ~1300 lažnih korisnika se prijavi preko weba, isto kao aplikacija
 *      (POST /api/subscribe, 25 istovremeno). Adrese ne vode na telefone nego
 *      na /api/proba-push, koji glumi push servis (vidi taj fajl): većina
 *      prima odmah, neki sporo, neki privremeno padaju, neki su „obrisali
 *      aplikaciju“, a neki ne odgovaraju.
 *   2. Cron kao u produkciji: ?nadoknadi=1 u 10:00, 10:01 i 10:03 — glumljeno
 *      vrijeme, za izmišljen dan u 2099, da ne dira prave dane. Tvoji test
 *      telefoni dobiju jednu poruku (prvi poziv), kao svaki dan.
 *   3. Izvještaj po vrsti uređaja: kome je stiglo, kome nije, šta je obrisano.
 *   4. Lažne pretplate se brišu (osim uz --zadrzi).
 *
 *   CRON_SECRET='…' node scripts/proba-1300.mjs [broj] [--zadrzi]
 */
import { createECDH, randomBytes } from 'node:crypto';

const BASE = process.env.BASE || 'https://quotes-git-test-pandzicharis-porfolio.vercel.app';
if (!/-git-test-/.test(BASE)) { console.log('✗ Proba je samo za test adresu, ne za produkciju'); process.exit(1); }
const TAJNA = process.env.CRON_SECRET;
if (!TAJNA) { console.log('✗ Postavi CRON_SECRET (vrijednost iz Vercela)'); process.exit(1); }

const BROJ = Number(process.argv.find(a => /^\d+$/.test(a)) || 1300);
const ZADRZI = process.argv.includes('--zadrzi');
const DAN = `2099-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`;
const PROBA = Date.now().toString(36);            // da se lažne adrese ne sudare s nekom ranijom probom

/* Koliko kojih — ostatak su „ok“. Udjeli otprilike kao u stvarnosti, malo grublje. */
const UDIO = { mrtva: 0.012, visi: 0.004, prolazno: 0.025, gust: 0.008, sporo: 0.03 };
const tipovi = Object.entries(UDIO).flatMap(([t, u]) => Array(Math.max(1, Math.round(BROJ * u))).fill(t));
while (tipovi.length < BROJ) tipovi.push('ok');
for (let i = tipovi.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tipovi[i], tipovi[j]] = [tipovi[j], tipovi[i]]; }
const ocekivano = tipovi.reduce((a, t) => ((a[t] = (a[t] || 0) + 1), a), {});

const b64url = b => Buffer.from(b).toString('base64url');
const sekunde = ms => `${(ms / 1000).toFixed(1)} s`;
const pauza = ms => new Promise(r => setTimeout(r, ms));

/** Pravi ključevi kao u pregledniku (P-256 + 16 B auth) — web-push ih stvarno koristi za šifrovanje. */
function pretplata(i, tip) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  return {
    endpoint: `${BASE}/api/proba-push?id=${i}&tip=${tip}&p=${PROBA}`,
    keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(randomBytes(16)) },
    predavanja: false,             // samo poruka dana — obavijesti o predavanjima ne idu lažnima
  };
}

async function bazen(n, radnika, posao) {
  let sljedeci = 0;
  await Promise.all(Array.from({ length: radnika }, async () => { while (sljedeci < n) await posao(sljedeci++); }));
}

async function cron(sat, opis) {
  for (let pokusaj = 1; pokusaj <= 6; pokusaj++) {
    const t = Date.now();
    const r = await fetch(`${BASE}/api/send?nadoknadi=1&dan=${DAN}&sat=${sat}`, { headers: { 'x-cron-secret': TAJNA } });
    const d = await r.json().catch(() => ({ greska: `HTTP ${r.status}, nije JSON` }));
    if (/Drugo slanje/.test(d.napomena || '')) { console.log(`   … drugo slanje u toku (pravi cron?), čekam 20 s`); await pauza(20000); continue; }
    const s = { HTTP: r.status, pretplata: d.pretplata, vecDobilo: d.vecDobilo, poslano: d.poslano, palo: d.palo,
      obrisanoMrtvih: d.ocisceno, drugiKrug: d.drugiKrug, preskoceno: d.preskoceno, greske: d.greske, greska: d.greska };
    Object.keys(s).forEach(k => s[k] === undefined && delete s[k]);
    console.log(`${opis} — ${sekunde(Date.now() - t)}\n   ${JSON.stringify(s)}`);
    return d;
  }
  throw new Error('Brava zauzeta predugo');
}

console.log(`Proba na ${BASE}\n${BROJ} lažnih korisnika, izmišljen dan ${DAN}\nvrste: ${JSON.stringify(ocekivano)}\n`);

/* ---------- 1. prijave preko weba ---------- */
let prijavljeno = 0, palePrijave = 0;
const tPrijava = Date.now();
await bazen(BROJ, 25, async i => {
  for (let pokusaj = 1; pokusaj <= 3; pokusaj++) {
    const r = await fetch(`${BASE}/api/subscribe`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pretplata(i + 1, tipovi[i])),
    }).catch(() => null);
    if (r?.ok) { prijavljeno++; return; }
    await pauza(500 * pokusaj);
  }
  palePrijave++;
});
console.log(`1. Prijave preko weba: ${prijavljeno} od ${BROJ} za ${sekunde(Date.now() - tPrijava)}${palePrijave ? ` — palo ${palePrijave}` : ''}\n`);

/* ---------- 2. cron kao u produkciji ---------- */
console.log('2. Slanje poruke dana');
const prvi = await cron(10, '   10:00');
await pauza(3000);
const drugi = await cron(10, '   10:01');
await pauza(3000);
const treci = await cron(10, '   10:03');

/* ---------- 3. izvještaj ---------- */
const r = await fetch(`${BASE}/api/proba-push?izvjestaj=dan:${DAN}`, { headers: { 'x-cron-secret': TAJNA } });
const izv = await r.json();
console.log(`\n3. Kome je stiglo (lažni korisnici, ${izv.laznih} ih je još u bazi)`);
let greske = 0;
const red = (tip, ok, tekst) => { if (!ok) greske++; console.log(`   ${ok ? '✓' : '✗'} ${tip.padEnd(9)} ${tekst}`); };
for (const tip of ['ok', 'sporo', 'prolazno', 'gust', 'visi', 'mrtva']) {
  const n = ocekivano[tip] || 0, t = izv.poTipu?.[tip] || { pretplata: 0, stiglo: 0, nije: [] };
  if (tip === 'mrtva') red(tip, t.pretplata === 0, `${n} „obrisanih aplikacija“ → u bazi ostalo ${t.pretplata} (treba 0)`);
  else if (tip === 'visi') red(tip, t.stiglo === 0 && t.pretplata === n, `${n} uređaja ne odgovara → stiglo ${t.stiglo}, ostaju u bazi za sutra`);
  else red(tip, t.stiglo === t.pretplata && t.pretplata === n, `stiglo ${t.stiglo} od ${n}${t.nije.length ? ` — nije: id ${t.nije.join(', ')}` : ''}`);
}
const dvaput = (drugi.poslano || 0) + (treci.poslano || 0);
red('duplikati', !treci.poslano && dvaput <= (ocekivano.prolazno || 0) + (ocekivano.gust || 0) + (ocekivano.visi || 0) + 2,
  `10:01 i 10:03 poslali još ${dvaput} — samo onima kojima prvi put nije prošlo`);
red('trajanje', (prvi.trajanjeMs || 0) < 170000, `prvi poziv ${sekunde(prvi.trajanjeMs || 0)} (rok 170 s)`);

/* ---------- 4. čišćenje ---------- */
if (ZADRZI) console.log('\n4. Lažne pretplate ostaju (--zadrzi) — obriši ih kasnije: POST /api/proba-push?ocisti=1');
else {
  const o = await (await fetch(`${BASE}/api/proba-push?ocisti=1`, { method: 'POST', headers: { 'x-cron-secret': TAJNA } })).json();
  console.log(`\n4. Lažne pretplate obrisane: ${o.obrisano ?? JSON.stringify(o)}`);
}
console.log(greske ? `\n✗ Palo provjera: ${greske}` : '\n✓ Sve prošlo');
process.exit(greske ? 1 : 0);
