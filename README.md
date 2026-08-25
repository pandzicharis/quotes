# Poruka dana · Ammar Bašić

Statična PWA: jedna poruka po danu iz knjiga hafiza Ammara Bašića.
Bez build koraka — HTML, CSS i JavaScript. Dnevne notifikacije idu preko
Web Pusha koji okida cron (`/api/send`).

---

## Lokalno pokretanje

```bash
python3 -m http.server 8123 --directory public
```

Otvori <http://localhost:8123>. Izmjena fajla + refresh = odmah vidljivo
(service worker koristi *mreža-prvo* strategiju, pa keš ne zadržava izmjene).

U Claude Code radi i `.claude/launch.json` konfiguracija `poruka-dana`.

---

## Struktura

```
public/                     ← statični root (Vercel outputDirectory)
  index.html                markup + SVG sprite
  css/app.css               dizajn sistem (tokeni, komponente, teme)
  js/app.js                 sva logika, bez zavisnosti
  data/poruke.json          SADRŽAJ — poruke, knjige, autor
  manifest.webmanifest      PWA manifest
  sw.js                     service worker: offline + push
  assets/books|brand|icons

api/                        Vercel serverless funkcije
  config.js                 javni VAPID ključ za klijenta
  subscribe.js              upis push pretplate
  unsubscribe.js            brisanje pretplate
  send.js                   DNEVNO SLANJE (poziva cron)
  test.js                   test notifikacija na jedan uređaj
  status.js                 dijagnostika konfiguracije
  _lib/auth.js              provjera CRON_SECRET tajne
  _lib/kv.js                Upstash Redis preko REST-a
  _lib/push.js              VAPID, izbor poruke, slanje

scripts/vapid.js            generiše VAPID ključeve
vercel.json                 cache zaglavlja
```

---

## Dodavanje poruka

Uredi `public/data/poruke.json`:

```json
{ "id": 13, "tekst": "…", "knjiga": "na-putu-ka-milosti", "tema": "Milost" }
```

- `id` — jedinstven broj (veže sačuvane poruke)
- `knjiga` — `id` iz liste `knjige`
- `tema` — kratka oznaka ispod naslova knjige

Poruka dana se bira **determinisano po datumu**: `broj_dana % broj_poruka`.
Isti dan uvijek daje istu poruku, i klijent i server koriste istu formulu.
Poruke se smiju ponavljati — kad ih ima manje od 365, ciklus se vrti.

Knjige imaju svoj `url` (`/knjiga/...`), pa klik na izvor vodi direktno na
tu knjigu. `autor.knjige_url` je fallback (`/shop`).

> Trenutni sadržaj je **placeholder** za testiranje izgleda — nisu citati iz
> knjiga. Zamijeniti prije objave.

---

## Deploy na Vercel

### 1. Poveži repo
Vercel sam prepozna `public/` kao statični root i `api/` kao funkcije.
Nema build koraka.

### 2. Baza pretplata
Vercel → **Storage** → **Redis** (Upstash) → poveži s projektom.
Integracija sama postavi `KV_REST_API_URL` i `KV_REST_API_TOKEN`.

### 3. VAPID ključevi

```bash
npm install
npm run vapid
```

Ispisane vrijednosti unesi u Vercel → Settings → Environment Variables:

| Varijabla           | Vrijednost                     |
| ------------------- | ------------------------------ |
| `VAPID_PUBLIC_KEY`  | iz `npm run vapid`             |
| `VAPID_PRIVATE_KEY` | iz `npm run vapid`             |
| `VAPID_SUBJECT`     | `mailto:info@ammarbasic.ba`    |
| `CRON_SECRET`       | isti niz koji cron servis šalje kao `x-cron-secret` |

Bez `CRON_SECRET` endpointi `/api/send` i `/api/test` rade **samo lokalno** —
na deployu vraćaju 401, da ih neovlašćeno niko ne može okinuti.

### 4. Cron

Dnevno slanje okida vanjski cron servis (cron-job.org i sl.):

```
GET  https://<domen>/api/send
zaglavlje:  x-cron-secret: <CRON_SECRET>
```

`/api/send` prihvata tajnu u tri oblika — `x-cron-secret`,
`Authorization: Bearer <tajna>` i `?secret=<tajna>` — pa radi s bilo kojim
servisom, uključujući Vercel Cron.

**Endpoint šalje na svaki poziv** — ne provjerava je li danas već slao. Koliko
puta korisnik dobije poruku određuje raspored crona, pa raspored treba biti
jednom dnevno. Poziv u minuti = notifikacija u minuti, što je korisno za
testiranje. Poruka je ista cijeli dan (bira se po datumu), a nosi isti
`tag`, pa u traci notifikacija ne gomila — nova zamijeni prethodnu.

Ako radije hoćeš Vercelov cron, dodaj blok u `vercel.json` (Hobby plan dopušta
jedan dnevno, u približno zadano vrijeme) — Vercel sam šalje `CRON_SECRET`:

```json
{ "crons": [{ "path": "/api/send", "schedule": "0 6 * * *" }] }
```

### 5. Provjera

```bash
curl https://<domen>/api/status
```

Vraća je li VAPID postavljen, je li baza povezana i koliko je pretplata.
`"spremno": true` znači da dnevno slanje radi.

Ručno pokretanje slanja:

```bash
curl -H "x-cron-secret: <CRON_SECRET>" https://<domen>/api/send
```

Odgovor kaže i zašto ništa nije izašlo — `pretplata: 0` znači da nijedan
uređaj nije registrovan u bazi, `greske` nosi prve odbijenice push servisa.
Isti poziv smije se ponavljati koliko treba; svaki šalje notifikaciju.

---

## Uvod (onboarding)

Prikaže se pri prvom otvaranju i ponovo kad se promijeni `VERZIJA` u
`public/js/app.js`. Četiri koraka:

1. **Dobrodošlica**
2. **Izbor teme** — Sistem / Dnevna / Noćna, primjenjuje se odmah
3. **Notifikacije** — dozvola je obavezna; dugme ne pušta dalje dok se ne
   riješi. Ako je preglednik trajno odbio (`denied`) ili ne podržava
   notifikacije, korak se otključa uz objašnjenje — inače bi aplikacija
   ostala zaglavljena bez izlaza.
4. **Instalacija** — koraci za dodavanje na početni ekran, prilagođeni
   platformi (iOS Safari / Android Chrome / desktop). Ako preglednik nudi
   `beforeinstallprompt`, tu je i dugme koje odmah otvara njegov dijalog.

## Notifikacije

- Prekidač u **Postavke → Podsjetnik** traži dozvolu i registruje push pretplatu.
- **Pošalji test notifikaciju** je razvojna alatka i vidi se **samo na
  `localhost`**. Na objavljenoj verziji dugmeta nema, a `/api/test` vraća 404
  bez `CRON_SECRET` — inače bi svako ko zna endpoint pretplate mogao gurati
  notifikacije korisnicima.
- Notifikacija nosi ikonicu aplikacije, naslov „Nova poruka dana“, tekst poruke
  i naslov knjige. Klik fokusira otvorenu aplikaciju ili je otvara.
- Mrtve pretplate (HTTP 404/410) se automatski brišu pri slanju.

**iOS:** Web Push radi od iOS 16.4, ali **samo ako je aplikacija dodana na
početni ekran**. U Safari tabu prekidač neće raditi — zato je u postavkama
„Instaliraj aplikaciju“ sa uputom za Podijeli → Dodaj na početni ekran.

---

## Sačuvane poruke

Čuvaju se u `localStorage`, po uređaju. Nema računa ni servera — svaki
korisnik ima svoju zbirku i ona ne izlazi s uređaja.

---

## Napomene

- **Hidžretski datum** računa `Intl` (`islamic-umalqura`); ako kalendar nije
  podržan, red se sakrije.
- **Dijeljenje slike** koristi `navigator.share` s fajlom; gdje toga nema,
  slika se preuzme. Formati: 9:16, 4:5, 1:1. Stilovi: Zelena i Krem.
- **Teme**: noćna i dnevna, uz prekidač za automatsko praćenje sistema.
