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

### Koliko je ljudi instaliralo aplikaciju

```bash
curl "https://<domen>/api/instalacije?secret=<CRON_SECRET>"
```

Vraća obican tekst, spreman za zabilješku u pregledniku:

```
PORUKA DANA — instalacije
osvježeno: 2026-08-30 05:40 UTC

iPhone / iPad          2
Android                1
Računar / ostalo       0
------------------------
Ukupno                 3

Pretplaćeno na notifikacije: 0
```

Aplikacija se javi na `POST /api/instalacije` prvi put kad radi sa početnog
ekrana, i pošalje samo platformu i nasumičnu oznaku koju sama napravi. Oznake
stoje u Redis skupovima `pd:instal:ios`, `pd:instal:android`,
`pd:instal:ostalo`, pa je broj = `SCARD`, a isti uređaj se ne broji dvaput.
Otvaranje u pregledniku se ne broji — instalacija je tek početni ekran.

Brojka je donja granica, ne apsolutna istina: ko obriše podatke preglednika i
instalira ponovo dobija novu oznaku. Za osjećaj rasta je sasvim dovoljna.

Ručno pokretanje slanja:

```bash
curl -H "x-cron-secret: <CRON_SECRET>" https://<domen>/api/send
```

Odgovor kaže i zašto ništa nije izašlo — `pretplata: 0` znači da nijedan
uređaj nije registrovan u bazi. Isti poziv smije se ponavljati koliko treba;
svaki šalje notifikaciju.

Polja odgovora koja vrijedi gledati:

| polje         | znači                                                        |
|---------------|--------------------------------------------------------------|
| `ok`          | `false` ako slanje nije stiglo do kraja (vidi `preskoceno`)   |
| `poslano`     | push servis je primio notifikaciju                           |
| `palo`        | nije primio — razlozi su u `greske`                           |
| `ocisceno`    | mrtvih pretplata obrisano iz baze                            |
| `preskoceno`  | koliko je ostalo neobrađeno jer je istekao rok                |
| `trajanjeMs`  | koliko je krug trajao — rezerva do `maxDuration`             |
| `greske`      | po HTTP kodu: `{ "503": { broj, primjer } }`                  |

`poslano + palo + preskoceno` se uvijek zatvara na `pretplata`.

---

## Kapacitet

Slanje ide u bazenu od 100 paralelnih zahtjeva, ne u serijama — spor uređaj
drži samo svoje mjesto u bazenu umjesto da zaustavi cijelu grupu. Uz
`maxDuration` od 300 s (postavljen u `vercel.json`) i rok od 240 s, mjereno na
realističnoj distribuciji latencija:

| pretplata | krug  | rezerva do roka |
|-----------|-------|-----------------|
| 4.000     | ~15 s | 16×             |
| 7.000     | ~20 s | 12×             |
| 25.000    | ~55 s | 4,5×            |

Vrijeme, dakle, nije prva granica. Prva granica je `SMEMBERS`: cijeli set se
čita u jednom odgovoru, a zapis je ~380 B, pa je na 25.000 pretplata odgovor
~9,5 MB — na samoj ivici Upstashovog limita veličine. Preko toga `svePretplate()`
treba prebaciti na `SSCAN` s paginacijom; sve ostalo ostaje isto.

Tri stvari koje čuvaju dostavu:

- **`timeout` od 8 s** na svakom push zahtjevu (`_lib/push.js`). Bez njega
  Node čeka na visećem socketu neograničeno.
- **Jedan ponovni pokušaj** na prolazne kodove (429, 5xx, mrežni prekid).
  404/410 se ne ponavljaju — pretplata više ne postoji, briše se.
- **Rok od 240 s**: kad se približi granici, funkcija prestaje uzimati nove
  pretplate i vraća izvještaj s `preskoceno` umjesto da je platforma
  presiječe na 504 bez podatka dokle se stiglo.

Krug od minutu je duži od onoga koliko vanjski cron servisi čekaju odgovor
(obično 30–60 s), pa će konzola prijaviti timeout iako je slanje prošlo.
**Isključi „retry on failure"** na cron servisu — drugi poziv ponovo zvoni
svima. Vercelov cron nema taj problem jer ne čeka odgovor.

---

## Uvod (onboarding)

Uvod ima dva odvojena toka, svaki sa svojom verzijom u `localStorage` pa
nadogradnja jednog ne tjera korisnika ponovo kroz drugi. Podjela je po
namjeni: u pregledniku je jedini cilj da aplikacija dođe na početni ekran,
sve ostalo (izgled, dozvola za notifikacije) čeka dok se prvi put ne otvori
odatle.

**Tok `web`** — prikaže se pri prvom otvaranju u pregledniku i ponovo kad se
podigne `UVOD_VERZIJA` u `public/js/app.js` (`VERZIJA` je odvojena i ne dira
uvod). Samo dva ekrana:

1. **Dobrodošlica**
2. **Na telefonu:** *Dodaj na početni ekran* — maketa telefona sa označenim
   mjestom i tri kratka koraka. Gdje preglednik nudi `beforeinstallprompt`
   (Android Chrome) dugme odmah otvara njegov dijalog; gdje ga nema, korisnik
   potvrdi sa „Dodao sam“.
   **Na računaru:** *Sve je spremno* — instalacije nema (vidi ispod), pa nema
   ni koraka za nju; podsjetnik ostaje dostupan u postavkama.

**Tok `pwa`** — prikaže se kad se aplikacija prvi put otvori sa početnog
ekrana. Dozvola za notifikacije se u pregledniku **ne traži** — na iPhoneu
push iz Safari taba i ne radi, a na Androidu je uredniji jedan zahtjev, u
aplikaciji:

1. **Dozvoli podsjetnik** — prvi dodir samo traži dozvolu, ne pušta dalje.
   Kad je preglednik trajno odbije (`denied`) ili notifikacije nisu podržane,
   korak se otključa uz objašnjenje umjesto da ostane zaglavljen bez izlaza.
2. **Odaberi izgled** — Sistem / Dnevna / Noćna, primjenjuje se odmah; isti
   izbor kao u Postavkama, gdje se uvijek može promijeniti kasnije.
3. **Sve je spremno**

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

Instalacija je **samo telefonska** — iPhone i Android. Na računaru se red
**Postavke → Instaliraj aplikaciju** sakrije i uvod nema korak instalacije:
podsjetnik ionako pripada telefonu, a dugme koje ništa ne može uraditi je
gore od nikakvog. Red se sakrije i kad je aplikacija instalirana ili kad
preglednik instalaciju ne podržava (`display-mode: standalone`,
`navigator.standalone`, `appinstalled`, nema `serviceWorker`).

| Platforma | Ponašanje |
| --- | --- |
| Android Chrome | `beforeinstallprompt` → **preglednikov vlastiti dijalog**. Nikad se ne traži da korisnik sam otvara meni kad dijalog postoji. |
| Android bez dijaloga | Vodič: ⋮ → Instaliraj aplikaciju → potvrda. |
| Android, Samsung Internet | Dijalog postoji, ali Play Protect odbija ono što taj preglednik instalira — prvi korak vodi u Chrome (uz dugme za kopiranje adrese), pa ista tri koraka. Vidi ispod. |
| iPhone / iPad (Safari) | iOS ne dopušta programsko dodavanje na ekran — **vodič u tri koraka** sa maketom: Podijeli → Dodaj na početni ekran → Dodaj. |
| iPhone, ali Chrome/Firefox | Isti WebKit, ali „Dodaj na početni ekran“ ima samo Safari — prvi korak vodi u Safari (uz dugme za kopiranje adrese), pa ista tri koraka. |
| Preglednik u Instagramu/FB-u | Jedan korak: otvori u pravom pregledniku (instalacije odatle nema). |
| Računar | Nema instalacije — ni reda u postavkama ni koraka u uvodu. |

Vodič je HTML + CSS + postojeće SVG ikone — **bez ijedne nove biblioteke**.

Maketa oponaša pravi sistem, jer se ekran po tim detaljima i prepoznaje: iOS
lista dijeljenja ima ručku, zaglavlje stranice, red aplikacija i glif **desno**
od natpisa; Chromeov meni visi ispod ⋮, poravnat desno, sa ikonicom **lijevo**.

**Pokazivač** je dvodijelan i namjerno različit po vrsti cilja:

- **Sitan cilj** (ikonica Podijeli, ⋮, dugme potvrde) — puna zlatna kontura
  plus **oblačić sa strelicom** („Dodirni ovdje“). Oblačić je dijete cilja u
  DOM-u, pa mu je pozicija tačna gdje god cilj bio.
- **Red u listi** — samo kontura, bez oblačića. Red je širok koliko i sheet,
  pa ga kontura i podebljan tekst već izdvajaju, a oblačić bi — gdje god
  stao — pokrio susjedni red.

Maketa je `aria-hidden`, pa svaki korak nosi naslov i opis: čitač ekrana i
`prefers-reduced-motion` dobiju cijelu uputu bez animacije. Zato kontura i
oblačić stoje i bez pokreta — animacija nikad nije jedini nosilac
informacije. Kroz korake se ide dugmadima **Nazad / Dalje** ili strelicama.

Korak instalacije u uvodu koristi **iste makete**, ali sve na jednom ekranu i
bez koračanja: korisnik odlazi iz preglednika da to izvede, a čim otvori
listu dijeljenja stranica je pokrivena i „Dalje“ nema ko stisnuti. Vodič
korak-po-korak ostaje za dugmetom u postavkama.

### Samsung Internet i Play Protect

Instalirana aplikacija na Androidu nije prečica: preglednik naruči pravi APK
(WebAPK) sa svog servera i njega instalira. `targetSdkVersion` tog omota bira
**preglednik, ne stranica** — a Play Protect odbija sve što je više od dvije
verzije ispod uređaja:

> **Unsafe app blocked** · This app was built for an older version of Android
> and doesn't include the latest privacy protections.

Googleov server omot drži svježim, pa instalacija iz Chromea prođe bez ijedne
riječi. Samsungov zaostaje — prijava je otvorena od aprila 2026. i još stoji
(<https://github.com/SamsungInternet/support/issues/123>) — pa ista naša
adresa iz Samsung Interneta stane na tom dijalogu. Manifest, ikone i service
worker tu ništa ne mijenjaju; omot pravi preglednik.

Zato `okolina().samsung` skreće instalaciju u Chrome: dijalog tog preglednika
se ne zove (`instaliraj()`), vodič dobija prvi korak sa kopiranjem adrese, a
korak uvoda kaže isto. Koraci za instalaciju ostaju ispod tog prvog — ko nema
Chrome, ili mu uređaj još ne javlja ništa (dijalog zavisi od toga koliko je
omot zaostao za verzijom Androida), neka proba odavde. Isti izlaz nosi i uvod:
**Ovdje mogu dodati na ekran** vrati korak na obične upute.

Ako Samsung jednog dana podigne `targetSdkVersion`, briše se jedan `if` u
`vodicKoraci()`, jedan u `crtajKorakInstal()` i jedan u `instaliraj()`.

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

  `android`, `android-bez`, `samsung`, `ios-1`, `ios-2`, `ios-3`, `ipad`,
  `ios-chrome`, `uapp`, `racunar`, `instalirano`

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
- **Stariji Android.** Sav JavaScript staje u ono što zna Chrome 100 i noviji,
  pa se lomi samo CSS: `dvh` traži Chrome 108, `color-mix` 111, a Android 5 i 6
  stoje na Chromeu 106. Zato svako `dvh` ima `vh` ispred sebe (bez toga se
  odbaci cijela deklaracija i modal naraste preko ekrana), a `.hdr` ima punu
  podlogu pod `@supports not (color-mix)` — ostale color-mix podloge su tonovi
  nad već punom pozadinom, pa se tamo izgubi samo nijansa.
