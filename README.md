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
{ "id": 36, "tekst": "…", "knjiga": "na-putu-ka-milosti", "poglavlje": "Sudbina" }
```

- `id` — jedinstven broj, nikad se ne mijenja (sačuvane poruke se vežu za njega)
- `knjiga` — `id` iz liste `knjige`
- `poglavlje` — poglavlje knjige, ispisuje se ispod naslova

Poruka dana se bira **determinisano po datumu**: `broj_dana % broj_poruka`.
Isti dan uvijek daje istu poruku, i klijent i server koriste istu formulu.
Poruke se smiju ponavljati — kad ih ima manje od 365, ciklus se vrti.

**Redoslijed liste jeste redoslijed dana**, pa su knjige izmiješane: nikad
više od **dvije poruke iste knjige jedna za drugom**, računajući i prelaz s
kraja liste na početak. Nove poruke uklopi u to miješanje i daj im novi id —
ne moraju ići na kraj liste, jer sačuvane poruke prate id, ne poziciju.
Poredak se lako provjeri razvojnom trakom (vidi „Razvojne alatke“).

Knjige imaju svoj `url` (`/knjiga/...`), pa klik na izvor vodi direktno na
tu knjigu. `autor.knjige_url` je fallback (`/shop`).

---

## Deploy na Vercel

### 1. Poveži repo
Vercel sam prepozna `public/` kao statični root i `api/` kao funkcije.
Nema build koraka.

### 2. Baza pretplata
Vercel → **Storage** → **Redis** (Upstash) → poveži s projektom.

Integracija sama postavi varijable, ali **pod dva različita imena** zavisno od
toga kako je dodana: `KV_REST_API_URL` / `_TOKEN` (stari Vercel KV) ili
`UPSTASH_REDIS_REST_URL` / `_TOKEN` (Marketplace). Kod prihvata oba, a
`/api/status` u polju `bazaVarijable` kaže koje je zaista našao.

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
`"spremno": true` znači da dnevno slanje radi; ako nije, polje `nedostaje`
imenuje varijable koje treba dodati.

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

## Nadogradnja i brisanje sa uređaja

Instalirana aplikacija ne uzima novi kod sama od sebe: novi service worker
ostaje u stanju `waiting`, a korisnik dobije traku **„Nova verzija je
spremna“** na dnu ekrana (i red u postavkama, ako traku odgodi). Dodir na
**Instaliraj** pošalje workeru `PRESKOCI_CEKANJE`, on preuzme kontrolu i
stranica se osvježi. Provjera se traži pri svakom vraćanju u aplikaciju i
svakih 30 minuta, jer instalirana aplikacija zna ostati otvorena danima.

**Pri objavi nove verzije podigni dvije stvari:** `VERZIJA` u `public/sw.js`
(mijenja ime keša i pokreće nadogradnju) i `VERZIJA` u `public/js/app.js`
(ispisuje se u postavkama). Aktivna verzija keša piše pored nje, npr.
`Verzija 1.3.0 · keš v6` — po tome se vidi šta uređaj stvarno ima.

**Postavke → Obriši verziju sa ovog uređaja** skida service worker, sve
keševe i sve `pd.*` zapise, pa se aplikacija pri sljedećem otvaranju
preuzima ispočetka i uvod ide od početka. Traži dva dodira (potvrda sama
istekne). Dugme je u aplikaciji, a ne samo `?reset` u URL-u, jer instalirana
aplikacija na iPhoneu ima svoj prostor odvojen od Safarija — brisanje iz
preglednika njene podatke ne dodiruje.

---

## Instalacija aplikacije

Jedan ulaz: **Postavke → Instaliraj aplikaciju**. Šta se iza njega desi
određuje platforma, a red se **sakrije** kad je aplikacija instalirana ili
kad preglednik instalaciju ne podržava (`display-mode: standalone`,
`navigator.standalone`, `appinstalled`, nema `serviceWorker`).

| Platforma | Ponašanje |
| --- | --- |
| Android / desktop Chrome | `beforeinstallprompt` → **preglednikov vlastiti dijalog**. Nikad se ne traži da korisnik sam otvara meni kad dijalog postoji. |
| iPhone / iPad (Safari) | iOS ne dopušta programsko dodavanje na ekran — otvara se **vodič u tri koraka** sa maketom telefona: Podijeli → Dodaj na početni ekran → Dodaj. |
| iPhone, ali Chrome/Firefox | Isti WebKit, ali „Dodaj na početni ekran“ ima samo Safari — prvi korak vodi u Safari (uz dugme za kopiranje adrese), pa ista tri koraka. |
| Android bez dijaloga | Vodič: ⋮ → Instaliraj aplikaciju → potvrda. |
| macOS Safari | Vodič: File → Add to Dock… |
| Preglednik u Instagramu/FB-u | Jedan korak: otvori u pravom pregledniku (instalacije odatle nema). |
| Ostali računari | Vodič: ikonica u adresnoj traci, pa meni preglednika. |

Vodič je HTML + CSS + postojeće SVG ikone — **bez ijedne nove biblioteke**.
Maketa je `aria-hidden`, pa svaki korak nosi naslov i opis: čitač ekrana i
`prefers-reduced-motion` dobiju cijelu uputu bez animacije. Zato statičko
stanje makete već pokazuje ono što treba dodirnuti, a animacija je samo
pokret. Kroz korake se ide dugmadima **Nazad / Dalje** ili strelicama.

Uvod (onboarding) ima svoj korak instalacije sa istim uputama u tekstu i
nije mijenjan — vodič sa maketom živi za dugmetom u postavkama.

---

## Razvojne alatke

Vide se **samo na `localhost`**; na objavljenoj verziji ih nema:

- **Traka za dane** na dnu ekrana: `‹` / `›` pomjeraju dan (i u budućnost,
  da se poruke pregledaju unaprijed), `Danas` vraća na današnji. Ispisuje
  datum, pomak, koja je poruka po redu, njen `id` i knjigu — tako se odmah
  vidi da se knjige ne ponavljaju. Isto rade strelice na tastaturi i swipe
  po kartici, samo sa animacijom.
- **PWA** u istoj traci otvara spisak stanja instalacije i glumi platformu,
  pa se cijeli vodič (i iPhone i iPad i Android) provjeri sa računara, bez
  telefona. Isto radi i `?instal=<stanje>`:

  `android`, `android-bez`, `ios-1`, `ios-2`, `ios-3`, `ipad`, `ios-chrome`,
  `uapp`, `desktop`, `desktop-bez`, `mac`, `instalirano`, `nepodrzano`

  Simulacija **ne dira pravi API preglednika** — `beforeinstallprompt` se ne
  glumi; za stanja sa dijalogom se samo kaže da bi ga preglednik otvorio.
  Van `localhost`-a je prekidač mrtav.
- **Pošalji test notifikaciju** i **Ponovi uvod** u postavkama.

Prekidači u URL-u rade i na objavljenoj adresi, pa se tok može provjeriti na
pravom telefonu: `?uvod=web`, `?uvod=pwa`, `?pwa=1`, `?reset`.

---

## Napomene

- **Hidžretski datum** računa `Intl` (`islamic-umalqura`); ako kalendar nije
  podržan, red se sakrije.
- **Dijeljenje slike** koristi `navigator.share` s fajlom; gdje toga nema,
  slika se preuzme. Formati: 9:16, 4:5, 1:1. Stilovi: Zelena i Krem.
- **Teme**: noćna i dnevna, uz prekidač za automatsko praćenje sistema.
