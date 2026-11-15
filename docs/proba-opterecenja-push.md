# Proba opterećenja za web push — pattern

Kako provjeriti slanje push obavijesti s brojem korisnika kao u produkciji
(npr. 1300), **bez ijednog pravog telefona**, i dobiti izvještaj „kome je
stiglo, a kome nije“. Napravljeno i provjereno u projektu *Poruka dana*
(Vercel + Supabase + `web-push`), 15. 11. 2026.

---

## Ideja u pet dijelova

| # | Dio | Šta radi |
|---|---|---|
| 1 | **Lažni push servis** (prijemnik) | endpoint na *test* deployu koji glumi FCM/Apple/Mozilla: prima šifrovanu poruku i odgovara kao pravi servis (201, 503, 429, 410, ili ne odgovara) |
| 2 | **Lažni korisnici preko pravog weba** | skripta ih prijavljuje kroz isti API kao aplikacija (`POST /api/subscribe`), s pravim P-256 ključevima; adresa im vodi na prijemnik |
| 3 | **Slanje kao cron** | isti pozivi kao produkcijski cron (npr. 10:00, 10:01, 10:03), uz glumljeno vrijeme i izmišljen dan |
| 4 | **Izvještaj** | iz dnevnika isporuka: po vrsti uređaja koliko je stiglo, ko nije, šta je obrisano, ima li duplikata, koliko je trajalo |
| 5 | **Čišćenje** | lažne pretplate se brišu na kraju |

Lažna pretplata nosi svoje ponašanje u adresi, pa se zna šta se od nje očekuje:

```
https://<test-domen>/api/proba-push?id=17&tip=prolazno&p=<oznaka-probe>
```

## Vrste uređaja (udjeli za 1300)

| tip | udio | prijemnik odgovara | očekivano |
|---|---|---|---|
| `ok` | ostatak (~92 %) | 201 za 50–400 ms | stiglo |
| `sporo` | 3 % | 201 za 2–4 s | stiglo |
| `prolazno` | 2,5 % | 503 ili 201, pola-pola | stiglo (ponovni pokušaj / nadoknada) |
| `gust` | 0,8 % | 429 + `Retry-After: 1`, ili 201 | stiglo |
| `mrtva` | 1,2 % | 410 | **obrisana iz baze** |
| `visi` | 0,4 % | ne odgovara 9,5 s (pošiljalac odustaje na 8 s) | nije stiglo, ostaje za sljedeći put |

## Šta aplikacija mora imati da bi proba imala smisla

- **Dnevnik isporuka** — red po (pretplata, ključ obavijesti), npr. `dan:2026-11-15`;
  primarni ključ na paru, pa duplikat ne može ni nastati. Po njemu nadoknada
  šalje samo onima kojih nema.
- **Ponovni pokušaji** za prolazne greške (0, 429, 5xx), do 3 puta + drugi krug;
  404/410 = pretplata mrtva → brisanje.
- **Timeout po zahtjevu** (ovdje 8 s) — bez njega jedan zaglavljen servis pojede cijelu funkciju.
- **Bazen radnika** (ovdje 100 istovremeno), ne serije.
- **Brava** — dva slanja nikad istovremeno.
- **Glumljeno vrijeme samo na testu** — `&sat=10&dan=2099-02-03`, čita se samo kad je
  `VERCEL_ENV === 'preview'`; produkcija parametre ignoriše.
- **Čitanje u stranicama** (Supabase/PostgREST vraća najviše 1000 redova po upitu).

## Prijemnik (Vercel funkcija, samo test)

```js
// api/proba-push.js
import { ovlascen, odbij } from './_lib/auth.js';
import { svePretplate, isporucene, skiniPretplate } from './_lib/baza.js';

const PROBA = process.env.VERCEL_ENV === 'preview';          // u produkciji 404
const OZNAKA = '/api/proba-push?';
const pauza = ms => new Promise(r => setTimeout(r, ms));
const izmedju = (a, b) => a + Math.random() * (b - a);

export default async function handler(req, res) {
  if (!PROBA) return res.status(404).end();
  const q = new URL(req.url, 'http://x').searchParams;

  // za skriptu (uz tajnu): ?izvjestaj=dan:YYYY-MM-DD  i  POST ?ocisti=1
  if (q.has('izvjestaj') || q.has('ocisti')) {
    if (!ovlascen(req)) return odbij(res);
    const lazne = (await svePretplate()).filter(s => s.endpoint.includes(OZNAKA));
    if (q.has('ocisti')) return res.json({ obrisano: await skiniPretplate(lazne.map(s => s.id)) });
    const dobili = await isporucene(q.get('izvjestaj'));     // Set id-eva iz dnevnika
    const poTipu = {};
    for (const s of lazne) {
      const tip = new URL(s.endpoint).searchParams.get('tip');
      const t = (poTipu[tip] ||= { pretplata: 0, stiglo: 0 });
      t.pretplata++; if (dobili.has(s.id)) t.stiglo++;
    }
    return res.json({ laznih: lazne.length, poTipu });
  }

  // „push servis“: kao pravi, bez VAPID potpisa i aes128gcm ne prima ništa
  if (req.method !== 'POST') return res.status(405).end();
  if (!/^vapid t=/.test(req.headers.authorization || '') ||
      req.headers['content-encoding'] !== 'aes128gcm') return res.status(400).end();
  switch (q.get('tip')) {
    case 'mrtva': return res.status(410).end();
    case 'visi': await pauza(9500); return res.status(201).end();
    case 'sporo': await pauza(izmedju(2000, 4000)); return res.status(201).end();
    case 'prolazno': await pauza(izmedju(50, 300)); return res.status(Math.random() < .5 ? 503 : 201).end();
    case 'gust':
      if (Math.random() < .5) { res.setHeader('Retry-After', '1'); return res.status(429).end(); }
      return res.status(201).end();
    default: await pauza(izmedju(50, 400)); return res.status(201).end();
  }
}
```

## Lažni korisnik — ključevi moraju biti pravi

`web-push` stvarno šifruje sadržaj ključem pretplate; izmišljen string pada
prije slanja. Zato ključevi kao u pregledniku:

```js
import { createECDH, randomBytes } from 'node:crypto';
const b64url = b => Buffer.from(b).toString('base64url');

function pretplata(i, tip) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  return {
    endpoint: `${BASE}/api/proba-push?id=${i}&tip=${tip}&p=${OZNAKA_PROBE}`,
    keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(randomBytes(16)) },
    // isključi sve što nije predmet probe (npr. obavijesti o predavanjima)
  };
}
```

Prijave idu kroz pravi API (`POST /api/subscribe`), 25 istovremeno, s 3
pokušaja — tako se usput proba i prijava pod navalom.

## Tok skripte

1. Provjeri da je adresa **test** (npr. sadrži `-git-test-`), inače prekini.
2. Tajna za cron iz okruženja — u terminalu je upisuje čovjek, skriveno:
   ```bash
   read -rs 'CRON_SECRET?CRON_SECRET: ' && export CRON_SECRET && node scripts/proba-1300.mjs 1300; unset CRON_SECRET
   ```
3. Izmješaj tipove (udjeli iz tabele), prijavi N korisnika, ispiši koliko je prošlo i za koliko.
4. Pozovi slanje kao cron, za **izmišljen dan** (`2099-MM-DD`) da ne dira prave dane:
   `?nadoknadi=1&dan=…&sat=10` tri puta (10:00, 10:01, 10:03). Ako odgovor kaže
   da je drugo slanje u toku (pravi cron), sačekaj 20 s i ponovi.
5. Izvještaj iz prijemnika + provjere:
   - `ok`, `sporo`, `prolazno`, `gust` → stiglo = broj;
   - `mrtva` → u bazi ostalo 0;
   - `visi` → stiglo 0, i dalje u bazi;
   - duplikati: 2. i 3. poziv poslali najviše koliko je prvi put palo, 3. poziv 0;
   - trajanje prvog poziva ispod roka funkcije.
6. Obriši lažne pretplate (`POST ?ocisti=1`), osim uz `--zadrzi`.

## Rezultat u Poruci dana (1300 lažnih + 2 prava telefona)

| poziv | rezultat |
|---|---|
| prijave | 1300/1300 za 27 s |
| 10:00 | 1302 pretplate → **1280 poslano**, 16 mrtvih obrisano, 5 ne odgovara, 1 pao (503 tri puta + drugi krug) — 64 s |
| 10:01 | već dobilo 1280 → poslano **1** (onaj koji je pao) |
| 10:03 | već dobilo 1281 → poslano **0** |

Svi `ok/sporo/prolazno/gust` dobili, mrtve obrisane, bez duplikata. Trajanje
je skoro cijelo od 5 „zaglavljenih“ (8 s × pokušaji); pravi produkcijski
poziv s ~1200 korisnika traje ~7 s.

## Zamke

- **`web-push` šalje samo na `https`** — prijemnik mora biti na deployu, lokalno
  se provjerava direktnim pozivom handlera s `webpush.generateRequestDetails(…)`.
- **Vercel Hobby: najviše 12 funkcija po deployu** — prebroj `api/*.js` prije dodavanja.
- **Supabase vraća najviše 1000 redova** — čitanje pretplata i dnevnika mora ići u stranicama.
- **Cron servisi čekaju ograničeno** (cron-job.org ~30 s); funkcija radi dalje i
  kad cron odustane, ali u konzoli izgleda kao greška. Zaglavljeni uređaji
  produžavaju poziv — timeout po zahtjevu i rok funkcije su obavezni.
- **Brava + pravi cron** — proba ne smije u isto vrijeme kad i pravi posao; skripta čeka i ponavlja.
- **Lažnima isključi sve ostale obavijesti** (ovdje `predavanja: false`), inače
  prime i dovršetak drugih obavijesti i proba mjeri pogrešnu stvar.
- **Ako skripta padne na pola** — lažne pretplate ostanu i sutrašnji pravi cron
  ih „šalje“ prijemniku (bezopasno); pokreni čišćenje ručno.
- **Prijemnik samo na testu** (`VERCEL_ENV === 'preview'`) — provjeri da produkcija
  na tu adresu vraća 404.
- **Tajne nikad u kod ni u polja** — samo `read -s` u terminalu, `unset` na kraju.
- cron-job.org „Test run“ ne radi iz automatizovanog preglednika (bot-provjera)
  — zato skripta zove API direktno.
- zsh: linija `echo ==========` je greška (`=` na početku riječi) — ne koristiti kao razdjelnik.

## Prenos u drugi projekat — spisak

- [ ] Dnevnik isporuka s PK (pretplata, ključ) i nadoknada po njemu
- [ ] Ponovni pokušaji, timeout, bazen radnika, brava
- [ ] Glumljeno vrijeme (`&sat`, `&dan`) samo na testu
- [ ] `api/proba-push.js` (prilagodi uvoz baze i provjeru tajne)
- [ ] `scripts/proba-1300.mjs` (prilagodi BASE, API prijave, polja pretplate, ključ obavijesti)
- [ ] Prebroj funkcije (Hobby limit), provjeri 404 u produkciji
- [ ] Pokreni, pročitaj izvještaj, provjeri da su lažne pretplate obrisane

Originali: `api/proba-push.js` i `scripts/proba-1300.mjs` u repou *quotes*.
