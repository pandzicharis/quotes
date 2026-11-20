-- Poruka dana — šema za Supabase (Postgres).
--
-- Zalijepi cijeli fajl u Supabase → SQL Editor → Run. Sigurno je pokrenuti
-- više puta; ništa ne briše postojeće podatke.

-- ---------- pretplate na notifikacije ----------
-- `endpoint` je jedinstven: isti uređaj ne može ući dvaput, a upis preko
-- postojećeg reda samo osvježi ključeve (preglednik ih ponekad rotira).
create table if not exists public.pretplate (
  id           bigint generated always as identity primary key,
  endpoint     text        not null unique,
  p256dh       text        not null,
  auth         text        not null,
  napravljeno  timestamptz not null default now()
);

-- `predavanja`: želi li uređaj obavijest o novom predavanju (postavka u aplikaciji).
alter table public.pretplate add column if not exists predavanja boolean not null default true;

-- ---------- brojanje instalacija ----------
-- Primarni ključ nosi dedupliciranje: drugi upis istog uređaja ne prolazi,
-- pa je broj redova = broj različitih uređaja.
create table if not exists public.instalacije (
  platforma    text        not null check (platforma in ('ios', 'android', 'ostalo')),
  uredjaj      text        not null check (uredjaj ~ '^[a-f0-9]{8,64}$'),
  napravljeno  timestamptz not null default now(),
  primary key (platforma, uredjaj)
);

-- ---------- zaštita ----------
-- U `pretplate` stoje kriptografski ključevi tuđih uređaja. RLS bez ijedne
-- politike znači: anon i prijavljeni korisnici ne vide ni jedan red. Serverski
-- ključ (service_role / sb_secret_…) zaobilazi RLS i zato /api funkcije rade.
alter table public.pretplate   enable row level security;
alter table public.instalacije enable row level security;

-- Pojas i tregeri: Supabase novim tabelama u `public` po defaultu da prava
-- anon roli. Oduzimamo ih, da ni greška u politici sutra ništa ne otvori.
revoke all on public.pretplate   from anon, authenticated;
revoke all on public.instalacije from anon, authenticated;

-- ---------- predavanja (kalendar hafiza, admin builder) ----------
-- `vrijeme` je lokalno vrijeme mjesta održavanja, a `zona` njegova IANA zona
-- — iz tog para aplikacija računa sarajevsko vrijeme i vrijeme korisnika.
-- `drzava` je ISO kod (BA, AT, DE…); van BiH plakat nosi i zastavu zemlje.
create table if not exists public.predavanja (
  id           bigint generated always as identity primary key,
  naslov       text        not null,
  podnaslov    text,
  organizator  text,
  datum        date        not null,
  vrijeme      text        not null default '19:00' check (vrijeme ~ '^[0-2][0-9]:[0-5][0-9]$'),
  vrijeme_opis text,
  zona         text        not null default 'Europe/Sarajevo',
  mjesto       text,
  adresa       text,
  grad         text,
  drzava       text        not null default 'BA' check (drzava ~ '^[A-Z]{2}$'),
  opis         text,
  link         text,
  stil         text        not null default 'zelena' check (stil in ('zelena', 'krem')),
  objavljeno   boolean     not null default true,
  opcije       jsonb       not null default '{}',
  kljuc        text        not null unique default replace(gen_random_uuid()::text, '-', ''),
  napravljeno  timestamptz not null default now(),
  izmijenjeno  timestamptz not null default now()
);
create index if not exists predavanja_datum on public.predavanja (datum);

-- `opcije`: opcije plakata koje se biraju u adminu (za sada hidžretski datum).
-- `kljuc`: privatni link /plakat/?k=… za dijeljenje plakata bez javne liste.
-- `organizator`: kad predavanje organizuje neko drugi (džemat, udruženje…) — ide na plakat.
alter table public.predavanja add column if not exists organizator text;
-- `vrijeme_opis`: riječima uz tačno vrijeme, npr. „poslije jacije namaza“.
alter table public.predavanja add column if not exists vrijeme_opis text;
alter table public.predavanja add column if not exists opcije jsonb not null default '{}';
alter table public.predavanja add column if not exists kljuc text not null unique default replace(gen_random_uuid()::text, '-', '');

alter table public.predavanja enable row level security;
revoke all on public.predavanja from anon, authenticated;

-- `obavijest_od`: kad je krenula obavijest „Novo predavanje“. Dva dana od tada
-- cron (/api/send?nadoknadi=1) dostavlja je uređajima koji je još nisu dobili.
alter table public.predavanja add column if not exists obavijest_od timestamptz;

-- `pracena`: predavanja koja uređaj prati (zvjezdica u aplikaciji) — za njih
-- stiže podsjetnik dan prije.
alter table public.pretplate add column if not exists pracena bigint[] not null default '{}';
create index if not exists pretplate_pracena on public.pretplate using gin (pracena);

-- ---------- dnevnik isporuka ----------
-- Jedan red = jedna obavijest koja je stigla do push servisa za jedan uređaj.
-- `kljuc` kaže koja: 'dan:2026-10-29' (poruka dana), 'novo:12' (novo
-- predavanje), 'podsjetnik:12' (dan prije praćenog). Po njemu nadoknada šalje
-- samo onima koji je još nemaju — svaki poziv crona dovršava ono što je
-- prethodni propustio, a niko je ne dobije dvaput. Stari redovi se brišu sami
-- (vidi api/send.js).
--
-- Namjerno bez strane veze na `pretplate`: pretplata obrisana usred slanja
-- (korisnik baš tada isključi obavijesti) inače obori upis cijele grupe od
-- 200, pa bi ostali iz te grupe dobili poruku još jednom. Redovi obrisanih
-- pretplata ne smetaju — id se ne ponavlja, a odlaze s ostalima.
-- Red s pretplatom 0 je brava: dok traje jedno slanje, drugo ne kreće.
create table if not exists public.isporuke (
  pretplata    bigint      not null,
  kljuc        text        not null,
  napravljeno  timestamptz not null default now(),
  primary key (pretplata, kljuc)
);
alter table public.isporuke drop constraint if exists isporuke_pretplata_fkey;
create index if not exists isporuke_kljuc on public.isporuke (kljuc);
create index if not exists isporuke_napravljeno on public.isporuke (napravljeno);

alter table public.isporuke enable row level security;
revoke all on public.isporuke from anon, authenticated;
grant select, insert, update, delete on public.isporuke to service_role;

-- ---------- pregled (/analytics) ----------
-- `slanja`: sažetak svakog poziva slanja — koliko je pretplata bilo, koliko je
-- obavijest do tada ukupno stiglo (`dostavljeno`), šta je palo i zašto.
create table if not exists public.slanja (
  id            bigint      generated always as identity primary key,
  kljuc         text        not null,            -- 'dan:2026-10-29', 'novo:12', 'podsjetnik:12'
  nacin         text        not null,            -- 'slanje' (prvi poziv) ili 'nadoknada'
  pretplata     integer     not null default 0,  -- kome je obavijest namijenjena
  dostavljeno   integer     not null default 0,  -- ukupno stiglo do push servisa, sa ranijim pozivima
  poslano       integer     not null default 0,  -- u ovom pozivu
  palo          integer     not null default 0,
  preskoceno    integer     not null default 0,
  greske        jsonb       not null default '{}',
  trajanje_ms   integer     not null default 0,
  napravljeno   timestamptz not null default now()
);
create index if not exists slanja_napravljeno on public.slanja (napravljeno);
-- naslov predavanja u času slanja: pregled ga pokazuje i kad se prošlo obriše
alter table public.slanja add column if not exists naslov text;
-- id poruke dana koja je otišla — admin po tome broji koliko je puta poruka
-- bila poruka dana, i kad se lista poruka promijeni
alter table public.slanja add column if not exists poruka integer;

-- `dogadjaji`: brojači za pregled — jedan red po danu, vrsti i ključu, s
-- brojem. Vrste: 'stiglo' i 'otvoreno' (notifikacija prikazana / dodirnuta,
-- ključ obavijesti), 'aplikacija' (prvo otvaranje u danu, po uređaju; ključ
-- 'pwa' ili 'web'), 'dijeljenje', 'preuzimanje', 'kopiranje', 'sacuvano'
-- (ključ 'poruka:<id>'), 'pregled', 'plakat', 'prati', 'kalendar' (ključ
-- 'predavanje:<id>'). Ništa o uređaju ni o osobi. Dan je po Sarajevu.
create table if not exists public.dogadjaji (
  dan    date    not null default (now() at time zone 'Europe/Sarajevo')::date,
  vrsta  text    not null check (vrsta ~ '^[a-z]{2,20}$'),
  kljuc  text    not null default '' check (kljuc ~ '^[a-z0-9:._-]{0,40}$'),
  broj   integer not null default 0,
  primary key (dan, vrsta, kljuc)
);

-- +1 u jednom koraku: hiljadu istovremenih javljanja ne gubi nijedno
create or replace function public.zabiljezi_dogadjaj(p_vrsta text, p_kljuc text default '')
returns void language sql as $$
  insert into public.dogadjaji (vrsta, kljuc, broj) values (p_vrsta, coalesce(p_kljuc, ''), 1)
  on conflict (dan, vrsta, kljuc) do update set broj = public.dogadjaji.broj + 1;
$$;

alter table public.slanja    enable row level security;
alter table public.dogadjaji enable row level security;
revoke all on public.slanja    from anon, authenticated;
grant select, insert, update, delete on public.slanja to service_role;
revoke all on public.dogadjaji from anon, authenticated;
revoke all on function public.zabiljezi_dogadjaj(text, text) from public, anon, authenticated;
-- Supabase ovo daje i sam; ovdje stoji da ne zavisi od podrazumijevanih prava
grant select, insert, update, delete on public.dogadjaji to service_role;
grant execute on function public.zabiljezi_dogadjaj(text, text) to service_role;

-- ---------- poruke dana i raspored (admin ih uređuje) ----------
-- Poruka dana = aktivne poruke po `redoslijed`, broj dana % broj aktivnih —
-- ista formula u aplikaciji i u slanju. `obrisana` je meko brisanje: sačuvane
-- poruke u aplikaciji se vežu za id, pa obrisana ostaje, samo ne ide u krug.
-- Početni sadržaj: sql/poruke-pocetne.sql (35 poruka iz data/poruke.json).
-- Dok je tabela prazna ili je nema, aplikacija i slanje rade iz poruke.json.
create table if not exists public.poruke (
  id           integer     primary key,
  tekst        text        not null check (length(tekst) between 1 and 2000),
  knjiga       text        not null default '',
  poglavlje    text,
  redoslijed   integer     not null,
  obrisana     boolean     not null default false,
  napravljeno  timestamptz not null default now(),
  izmijenjeno  timestamptz not null default now()
);

-- Poruka zakazana za određeni dan; dan bez reda ide po redoslijedu.
create table if not exists public.raspored_poruka (
  dan          date        primary key,
  poruka       integer     not null,
  napravljeno  timestamptz not null default now()
);

alter table public.poruke          enable row level security;
alter table public.raspored_poruka enable row level security;
revoke all on public.poruke          from anon, authenticated;
revoke all on public.raspored_poruka from anon, authenticated;
grant select, insert, update, delete on public.poruke          to service_role;
grant select, insert, update, delete on public.raspored_poruka to service_role;

-- ---------- poruke van knjiga (dizajner u adminu) ----------
-- Hafizove poruke koje nisu iz knjiga: admin ih piše u dizajneru i od njih
-- pravi slike za objavu i story. Nisu poruke dana — ne idu u krug i
-- aplikacija ih ne čita. `stil` je boja slike.
create table if not exists public.vlastite_poruke (
  id           bigint      generated always as identity primary key,
  tekst        text        not null,
  stil         text        not null default 'zelena' check (stil in ('zelena', 'krem')),
  napravljeno  timestamptz not null default now(),
  izmijenjeno  timestamptz not null default now()
);
-- Dužina se ne ograničava (slika smanji slova da poruka stane); 10 000 znakova
-- je samo zaštita, ista kao u /api/poruke. Ovako i tabela napravljena ranije,
-- s granicom od 2000, dobije novu.
alter table public.vlastite_poruke drop constraint if exists vlastite_poruke_tekst_check;
alter table public.vlastite_poruke add constraint vlastite_poruke_tekst_check
  check (length(tekst) between 1 and 10000);

-- izgled teksta iz dizajnera (font, debljina, kurziv, razmaci, poravnanje);
-- null = zadani izgled. Tekst nosi oznake **debelo**, *kurziv*, ==zlatno==.
alter table public.vlastite_poruke add column if not exists izgled jsonb;

alter table public.vlastite_poruke enable row level security;
revoke all on public.vlastite_poruke from anon, authenticated;
grant select, insert, update, delete on public.vlastite_poruke to service_role;
