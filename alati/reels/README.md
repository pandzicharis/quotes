# Reels iz videa (testni modul)

Zalijepiš link hafizovog YouTube videa, a alat sam:

1. preuzme video i zvuk (**yt-dlp**),
2. napravi transkript na bosanskom, s vremenom svake riječi (**Whisper large-v3-turbo** preko MLX-a, na GPU-u Maca),
3. s AI-jem izabere 5–6 zaokruženih cjelina, svaku s jednom poentom (primjer, komentar, misao…), i svakoj da početak, kraj, naslov i razlog izbora. Da i temu predavanja (**gemma4 12B** u **Ollami**, lokalno),
4. AI ispravi krivo prepoznate i nepotpune riječi u titlovima, a naslove još jednom lektoriše,
5. AI montira svaki isječak: izbaci digresije, ponavljanja i poštapalice, ali samo kad spoj ostaje prirodan. Duge pauze se same zbiju, a svaki rez se mekano pretopi (slika i zvuk), uz kadar tek malo bliži,
6. nađe hafizovo lice, da vertikalni izrez ne odsiječe glavu (Appleov **Vision**, lokalno),
7. na ekranu ti pusti svaki isječak: pomjeriš početak i kraj (±0,2 s, ±1 s, „= sada“), vidiš i mijenjaš rezove, mijenjaš naslov i temu, po potrebi ispraviš titl,
8. napravi gotove reelse: **MP4 1080 × 1920 (9:16), 30 fps, H.264 + AAC**, u bojama aplikacije (zelena i zlatna). Video je gore, s titlovima riječ po riječ (trenutna riječ zlatna). Pri dnu se mekano pretopi u zelenu, a na njoj su tema, naslov, logo „Ammar Bašić“ i linkovi (Instagram, Facebook, web). Na kraju se video pretopi u zelenu. Glasnoća je izjednačena na −14 LUFS (**ffmpeg** + **Pillow**).

Isprobano na „Rješenje za tugu, brigu i probleme“ (22 min, 720p): preuzimanje 1–4 min (zavisi od mreže), transkript 2 min, AI izbor, ispravke i montaža ~6 min, izrada 6 reelsa ~2 min.

Sve je besplatno i radi na Macu, bez ijednog plaćenog API-ja i bez ključeva.

## Pokretanje

```bash
cd alati/reels
./reels
```

Prvi put sam pokrene `postavi.sh`: Python okruženje, fontovi brenda (EB Garamond, IBM Plex Sans; OFL licenca), AI model (~7 GB). Whisper model (~1,6 GB) se skine kod prvog transkripta. Otvori se `http://localhost:8765`.

Iz terminala, bez ekrana:

```bash
./reels "https://www.youtube.com/watch?v=…" --napravi
```

`--ponovo` traži od AI-ja nov izbor isječaka, i kad već postoje.

Sve za jedan video stoji u `radno/<id videa>/`: `izvor.mp4`, `transkript.json`, `projekat.json` (isječci i tvoje izmjene), a gotovi reelsi su u `reels/`. Folder `radno/` ne ide u git.

Podešavanja (nisu obavezna):

| varijabla | podrazumijevano | čemu služi |
|---|---|---|
| `REELS_WHISPER` | `mlx-community/whisper-large-v3-turbo` | `mlx-community/whisper-large-v3-mlx` je malo tačniji i ~3× sporiji |
| `REELS_LLM_MODEL` | `gemma4:12b-it-qat` | bilo koji model iz Ollame |
| `REELS_LLM_URL` + `REELS_LLM_KEY` | Ollama na Macu | besplatni API kompatibilan s OpenAI-jem (npr. Gemini, Groq); ključ upisuješ sam |
| `REELS_INSTAGRAM` | `basic_ammar` | nalog koji piše na dnu reelsa |
| `REELS_PORT` | `8765` | port ekrana |

## Šta se može deployati, a šta ne

| dio | Vercel (Hobby, ova aplikacija) | zašto |
|---|---|---|
| preuzimanje s YouTubea | ne | YouTube sa serverskih IP adresa (Vercel je na AWS-u) traži prijavu („Sign in to confirm you're not a bot“); radilo bi samo s kolačićima naloga, krhko i protiv pravila YouTubea |
| transkript (Whisper) | ne | nema GPU-a; na CPU-u 40 min govora traje duže od limita od 300 s; model (1,6 GB) je veći od dozvoljenih 250 MB po funkciji |
| AI izbor isječaka | samo uz plaćeni ili besplatni API | lokalni model ne može na Vercel; besplatni API (Gemini) bi išao, ali treba ključ i transkript |
| izrada videa (ffmpeg) | ne | 6 reelsa po minut u 1080 × 1920 je nekoliko minuta CPU-a po reelsu; limit 300 s i 2 GB memorije |
| nova funkcija | jedva | od 12 funkcija zauzeto je 11, a ovo traži više njih |

Opcije koje sam razmotrio:

- **Besplatni hosting za obradu** (Hugging Face Spaces, Google Colab, GitHub Actions, Oracle Free): svi su na serverskim IP adresama pa YouTube blokira preuzimanje; bez GPU-a (osim Colaba, koji se pokreće ručno i gasi) Whisper je spor; dodaje se još jedan sistem za održavanje.
- **Dio u adminu**: admin je na HTTPS-u na Vercelu, a teški dio mora raditi na Macu. Admin bi mogao samo zvati lokalni alat, a preglednik to ionako sve više ograničava (Local Network Access). Ne vrijedi zakomplikovati za testni modul.
- **Lokalni alat na Macu s ekranom u pregledniku**: ✅ izabrano. Kućna IP adresa (YouTube ne blokira), GPU M4 Pro (transkript 22 min videa za ~1–2 min), lokalni AI bez ključeva i troškova, ffmpeg bez vremenskog limita. Nije potreban deploy niti nova Vercel funkcija; produkcija, baza i postojeće funkcije ostaju netaknute.

Mana: radi samo dok je Mac upaljen i samo na Macu s Apple čipom (MLX). Ako se kasnije želi da gotovi reelsi idu u admin, to je mali dodatak: upload gotovih fajlova u Supabase Storage. To bi bila izmjena baze, pa traži odobrenje.

## Napomene

- Titlove AI sam ispravi, ali lokalni model nije savršen: ponekad promaši vokativ ili nerazumljivu riječ. Brzi pregled u „Ispravi titlove“ prije objave je dobra navika. Kad pomjeriš početak, kraj ili rez, titlovi se slože i isprave iznova.
- Isječak počinje i završava na granici rečenice. Alat doda djelić sekunde zraka, ali nikad ne uđe u susjednu riječ.
- Kadar **video gore, brend dole** je podrazumijevan (video 1080 × 1500 koji se pri dnu pretopi u zelenu). Kadar **izrez** puni cijeli ekran (klizač „pozicija“ pomjera izrez lijevo-desno; zlatni okvir na videu pokazuje šta ulazi). Kadar **cijeli kadar + zamućena pozadina** je bolji kad su u kadru dvije osobe ili kad je snimak širok.
- YouTube povremeno promijeni nešto pa preuzimanje padne. `./reels` zato jednom sedmično sam osvježi yt-dlp.

## Radnik u Dockeru + tab „Reels“ u adminu

Hafiz u adminu (tab **Reels**) zalijepi YouTube link, a sve ostalo je automatski. Obradu radi radnik u Dockeru na laptopu (`radnik.py`, s istom logikom kao lokalni alat), jer YouTube serverske adrese (Vercel, GitHub) blokira i uz kolačiće. Tri probe na GitHubovom serveru su to potvrdile 22. 11. 2026. Admin pokazuje je li laptop uključen; posao čeka dok se laptop ne otvori. Gotovi reelsi ostaju u adminu i kad je laptop zatvoren.

Tok: zvuk (yt-dlp) → transkript (Groq Whisper, besplatno; rezerva faster-whisper na procesoru) → izbor, tema, ispravke titlova i rezovi (Gemini, besplatno; rezerva Groq) → lice za izrez (OpenCV) → izrada (ffmpeg + Pillow, kao lokalno) → Supabase Storage (bucket `reels`). Video se skida u pozadini dok traju transkript i AI. Kad hafiz izmijeni isječak, prave se samo izmijenjeni reelsi.

Jednom:

1. Supabase (test: `poruka-dana-test`) → SQL Editor → zalijepi `sql/reels.sql` → Run.
2. `cp .env.example .env` pa upiši Supabase URL i tajni ključ, Groq ključ i Gemini ključ (sve besplatno).
3. Docker Desktop → Settings → General → uključi „Start Docker Desktop when you sign in“.
4. `docker compose up -d --build`

Poslije toga je dovoljno otvoriti laptop: Docker se pali s prijavom, a radnik s njim (`restart: unless-stopped`). Logovi: `docker compose logs -f`. Nova verzija koda: `docker compose up -d --build`.

Laptop dok radi ne smije zaspati; Docker to ne može spriječiti. Na struji: System Settings → Battery → Options → „Prevent automatic sleeping when the display is off“.

Šta se gdje čuva:

| šta | gdje | koliko dugo |
|---|---|---|
| isječci, izmjene, ispravke | tabela `reels_poslovi` | dok se posao ne obriše u adminu |
| transkript, rečenice | Storage `reels/<posao>/` | isto |
| gotovi reelsi (MP4, ~12 MB po minuti) | Storage `reels/<posao>/` | 14 dana bez izmjena, pa se obrišu („Napravi izmijenjene“ ih vraća) |
| izvorni video | Docker volume na laptopu | 7 dana |

Besplatni Supabase ima 1 GB Storagea i najviše 50 MB po fajlu; radnik kodira ispod toga (`-crf 21`, najviše 3 Mbit/s).
