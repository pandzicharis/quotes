# Puštanje 1.7.0 u produkciju — predavanja

Plan prelaska sa `test` na produkciju (`trunk`), korak po korak. Redoslijed je
bitan: **prvo baza, pa varijable, pa kod, pa cron**. Svaki korak je takav da
postojeća aplikacija (1.6.1) radi normalno i ako se stane na pola.

> Domen produkcije u primjerima: `https://porukadana.ammarbasic.ba`.
> Test: `https://quotes-git-test-pandzicharis-porfolio.vercel.app`.

> ✅ **Pušteno 15. 11. 2026. u 11:25** — `trunk` = `323b410`. Koraci 1–5
> urađeni (1523 pretplate, 3 predavanja bez obavijesti, oba cron posla s
> obaviješću o grešci). Prvo slanje po novom: 16. 11. u 10:00 (korak 6).
> Ovaj fajl ostaje kao uputstvo za sljedeće puštanje i za vraćanje.

---

## Šta ide u produkciju

23 commita sa `test` grane (od `3525e93` do `e39e5b7`) + commit izdanja (korak 3.1):

- **Poruka dana bez duplikata** — dnevnik isporuka i nadoknada: poruka u 10 h,
  kasniji pozivi dostave samo onima do kojih nije stigla.
- **Predavanja** — box „Nadolazeća predavanja“, kalendar, plakati, „Planiram
  ići“ s podsjetnikom dan prije u 20 h, obavijest o novom predavanju.
- **Novi izgled** — donja traka (Sačuvane, Kalendar, Postavke), slova, drawer.
- **Admin** — predavanja (s plakatima), poruke, statistika, grafike.
- `/analytics`, `/grafike` (grafike za mreže, zelene i bijele).
- **Naziv ostaje „Poruka dana“** — kao i sad u produkciji, pa se instalirana
  aplikacija nikome ne preimenuje.

---

## 0. Priprema (dan-dva prije)

1. ✅ **Lista predavanja** — prenesena sa testa 15. 11. u
   [`sql/predavanja-prva.sql`](sql/predavanja-prva.sql): Tribina (21. 11.,
   Bugojno), Večer Kur'ana (22. 11., Zenica), Šehidski mevlud (27. 11., Bihać).
   - Ako hafiz do puštanja doda ili obriše predavanje na testu, ponovo pokreni
     upit „SQL za produkciju“ na testu i pošalji mi rezultat — osvježim fajl.
   - Prošla predavanja fajl sam preskače.
2. ✅ **Proba na testu** — sve što ide u produkciju radi na testu (simulacija
   `scripts/simulacija-test.sh` prošla 15. 11. 2026.):
   - poruka dana u 10 h, ne prije, i bez duplikata u 10:01–10:03,
   - novo predavanje iz admina → obavijest odmah,
   - „Planiram ići“ za sutrašnje predavanje → podsjetnik u 20 h,
   - admin: dodavanje, izmjena, sakrivanje, plakat.
3. **Admin šifra za produkciju** — napravi novu, jaku (ne istu kao na testu):
   ```bash
   openssl rand -base64 24
   ```
   Sačuvaj je u password manager. Ona čuva `/admin` i `/analytics`.
4. **Termin:** bilo kad **poslije 10:03** (npr. uveče) — tada je današnja
   poruka dana već poslana, a izmjena crona (korak 5) prvi put radi sutra u
   10:00. Ništa ne ide dvaput.

---

## 1. Baza — produkcijski Supabase (prije deploya)

> ⚠️ Provjeri gore lijevo u Supabase-u da si u **produkcijskom** projektu, ne
> u test projektu.

1. **Rezervna kopija** pretplata: Table Editor → `pretplate` → Export → CSV.
   (Ako plan ima Database → Backups, i tu napravi backup.)
2. SQL Editor → zalijepi cijeli [`sql/shema.sql`](sql/shema.sql) → **Run**.
   - Samo dodaje tabele i kolone (`if not exists`), ništa ne briše. Može se
     pokrenuti i više puta.
   - Stara aplikacija 1.6.1 nastavlja raditi kao prije.
3. Provjera — broj pretplata mora biti isti kao prije koraka 2:
   ```sql
   select count(*) as pretplata from public.pretplate;
   select table_name from information_schema.tables
   where table_schema = 'public' order by 1;
   -- očekivano: dogadjaji, instalacije, isporuke, predavanja, pretplate, slanja
   ```
4. SQL Editor → zalijepi cijeli [`sql/predavanja-prva.sql`](sql/predavanja-prva.sql)
   → **Run**. Ubacuje 3 predavanja (21., 22. i 27. 11.).
   - Ubacuje predavanja **bez obavijesti** — niko ne dobija notifikaciju.
   - Zadnji upit u fajlu ispiše predavanja: kolona `obavijest_od` mora biti
     prazna kod svih.

---

## 2. Vercel varijable — Production

Vercel → projekt → Settings → **Environment Variables**. Varijable djeluju tek
na **sljedeći deploy**, zato idu prije koraka 3.

| Varijabla | Production | Napomena |
|---|---|---|
| `SUPABASE_URL` | ✅ već postoji | produkcijska baza — ne mijenjati |
| `SUPABASE_SECRET_KEY` | ✅ već postoji | produkcijska baza — ne mijenjati |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | ✅ već postoje | zajedničke s testom — ne mijenjati |
| `CRON_SECRET` | ✅ već postoji | zajednička s testom — ne mijenjati |
| **`ADMIN_SECRET`** | ➕ **dodati** | šifra iz koraka 0.3, samo za *Production* |
| **`PREDAVANJA_PUSH`** | ➕ **dodati** `1` | bez nje nema obavijesti o predavanjima ni podsjetnika |
| `SAT_PORUKE` | ❌ ne postavljati | produkcija ostaje na 10 h |

---

## 3. Kod — izdanje 1.7.0

1. **Uključiti predavanja za sve** — u `public/js/app.js`
   `const PREDAVANJA = false` → `true`. Reci mi „pripremi izdanje“: promijenim,
   pushnem na test i provjerim test.
2. **Spajanje u produkciju** (fast-forward — `trunk` je predak `test`):
   ```bash
   git checkout trunk
   ```
   ```bash
   git merge --ff-only test
   ```
   ```bash
   git push origin trunk
   ```
   ```bash
   git checkout test
   ```
   Ili reci „pushaj produkciju“ i uradim ja.
3. Vercel → Deployments → produkcijski deploy mora biti **Ready**.

---

## 4. Provjera odmah poslije deploya

- [ ] Domen u pregledniku: Postavke → verzija **1.7.0**, gore **nema** oznake TEST.
- [ ] Box „Nadolazeća predavanja“ s brojem, kalendar, detalji, plakat se crta.
- [ ] `https://porukadana.ammarbasic.ba/api/predavanja` → JSON s listom.
- [ ] `/admin` → prijava novom šifrom → vide se predavanja iz koraka 1.4.
- [ ] `/api/send` bez tajne → **401** (zaštićeno).
- [ ] Instalirana aplikacija na telefonu: traka „Nova verzija“ → Instaliraj →
      iskoči „Nova predavanja“ s plakatima.

---

## 5. Cron — cron-job.org (poslije deploya, poslije 10:03)

**Do deploya 1.7.0 ništa ne dirati** — postojeći posao (`?force=1` u 10:00)
radi kao i sad. Ako se izmjena crona i zaboravi, 1.7.0 i sa starim poslom
šalje poruku dana u 10:00 svima koji je nemaju (`force` se ne čita) — samo
bez nadoknade i bez podsjetnika. ⚠️ Stara verzija 1.6.1 šalje svima na **svaki** poziv:
dodatne minute (10:01–10:03) prije deploya = korisnici dobiju poruku 4 puta.

Kad je deploy „Ready“ (i shema iz koraka 1 pokrenuta), bilo kad poslije
10:03 — recimo isto veče:

### 5.1 Posao 1 — Poruka dana (postojeći posao, samo izmijeniti)

| Polje | Bilo | Postaje |
|---|---|---|
| URL | `…/api/send?force=1` | `https://porukadana.ammarbasic.ba/api/send?nadoknadi=1` |
| Raspored | 10:00 | sat **10**, minute **0–3** (`0-3 10 * * *`) |
| Zona | Europe/Sarajevo | Europe/Sarajevo |
| Header | `x-cron-secret` | isti, ne mijenjati |
| Notify on failure | — | uključiti |

- **10:00** poruka dana svima; **10:01–10:03** samo onima kod kojih nije prošlo
  (dnevnik isporuka) — niko je ne dobije dvaput.
- Jedan poziv već pokuša svaki uređaj do 3 puta i ima drugi krug za prolazne
  greške; 1200 korisnika = nekoliko sekundi.
- `?nadoknadi=1` a ne `?force=1`: ako dnevnik isporuka iz bilo kog razloga ne
  radi, `?nadoknadi=1` ne pošalje **ništa** (vrati grešku), a `?force=1` bi
  poslao svima na svaki od 4 poziva.
- U produkciji `?nadoknadi=1` **nikad** ne šalje poruku dana prije 10 h (prag u
  kodu). Zato u Vercelu **ne** postavljati `SAT_PORUKE`.

### 5.2 Posao 2 — Predavanja (novi)

| Polje | Vrijednost |
|---|---|
| URL | `https://porukadana.ammarbasic.ba/api/send?predavanja=1` |
| Raspored | svaki dan, sati **7–9 i 11–21**, minuta **0** (`0 7-9,11-21 * * *`) |
| Zona | Europe/Sarajevo |
| Header | `x-cron-secret` (isti) |
| Notify on failure | uključiti |

- Šalje **samo** obavijesti o predavanjima: podsjetnik dan prije onima koji su
  označili „Planiram ići“ (u 20 h po vremenu mjesta predavanja) i dovršetak
  „Novo predavanje“. Poruku dana ne šalje nikad, ni u jedan sat.
- U puni sat, ali **bez 10 h**: dva slanja nikad ne idu istovremeno (brava),
  pa bi se u 10:00 posao za predavanja sudario s porukom dana. Poziv poruke
  dana (`?nadoknadi=1`) u 10 h ionako odradi i predavanja — ništa se ne gubi.
  Podsjetnik tako stiže tačno u 20:00.
- Svaki sat je namjerno: London je sat iza Sarajeva, Australija deset sati
  ispred — podsjetnik izlazi u njihovih 20 h, i to samo jednom.
- Usput čisti dnevnik isporuka (stariji od 14 dana) i prošla predavanja.
- „Novo predavanje“ ne čeka cron — ide odmah iz admina.

### 5.3 Provjera

- Posao 2 → **Test run** → HTTP 200, napomena „Samo obavijesti o predavanjima…“,
  `"poslano": 0` — poruka dana nije dirana. (Test run klikni ti — cron-job.org
  ga automatizovanom pregledniku odbija.)
- Lista poslova: posao 1 „Next execution“ sutra **10:00**, posao 2 sljedeći
  puni sat (ne 10:00).
- Posao 1 → **ne** klikati Test run poslije 10 h na dan izmjene (dnevnik je
  tek počeo; prvi pravi poziv je sutra u 10:00).

---

## 6. Sutradan

- **7–9 h:** ništa za BiH i Evropu (posao 2 radi, ali podsjetnici su u 20 h).
- **10:00:** poruka dana svima. Admin → Statistika (ili `/analytics`):
  `dostavljeno` ≈ broj pretplata, bez duplikata. 10:01–10:03 pošalju 0 ili
  par uređaja.
- **20 h:** podsjetnik onima koji su označili „Planiram ići“ za sutrašnje.
- Nova predavanja od sada: **admin → Pošalji obavijest** → stiže odmah.

---

## Ako nešto pođe po zlu

| Problem | Šta uraditi |
|---|---|
| Aplikacija ne radi kako treba | Vercel → Deployments → prethodni produkcijski deploy (1.6.1) → **Instant Rollback**. Baza ne smeta staroj verziji — ne treba ništa vraćati. |
| Poslije rollbacka | Posao 1 vrati na staro: `…/api/send?force=1`, samo u 10:00 (bez 10:01–10:03!). Posao 2 isključi. |
| Obavijesti o predavanjima prave problem | Vercel → `PREDAVANJA_PUSH` obriši → Redeploy. Poruka dana radi i dalje. |
| Admin šifra procurila | Vercel → nova `ADMIN_SECRET` → Redeploy. |
| Cron vraća 401 | `x-cron-secret` ne odgovara `CRON_SECRET` u Vercelu. |
| Cron vraća 503 „Dnevnik isporuka…“ | Korak 1.2 (shema) nije prošao — pokreni `shema.sql` ponovo. Ništa nije poslano dvaput. |

---

## Kratko — redoslijed

1. ✅ Lista predavanja u `predavanja-prva.sql` (3 predavanja)
2. Supabase (produkcija): backup → `shema.sql` → provjera → `predavanja-prva.sql`
3. Vercel (Production): `ADMIN_SECRET`, `PREDAVANJA_PUSH=1` (ne `SAT_PORUKE`)
4. Ja: `PREDAVANJA = true` → test → merge u `trunk` → deploy Ready
5. Provjera domena, admina, API-ja, telefona
6. Poslije 10:03 (npr. uveče): posao 1 → `?nadoknadi=1`, `0-3 10 * * *`;
   novi posao 2 → `?predavanja=1`, `0 7-9,11-21 * * *` → Test run posla 2
7. Sutra u 10:00: provjera statistike
