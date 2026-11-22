-- Reels iz hafizovih predavanja — red poslova i gotovi reelsi.
--
-- Zalijepi cijeli fajl u Supabase → SQL Editor → Run. Sigurno je pokrenuti
-- više puta; ništa ne briše postojeće podatke.
--
-- Tok: admin upiše YouTube link (red s `zahtjev = 'obradi'`), radnik u Dockeru
-- na laptopu (alati/reels/radnik.py) ga preuzme, napravi isječke i reelse,
-- reelse spremi u Storage bucket `reels`, a ovdje upiše isječke i spisak
-- gotovih fajlova. Hafiz u adminu podesi isječke → `zahtjev = 'napravi'`.

-- ---------- poslovi ----------
-- `zahtjev`: šta radnik treba uraditi (obradi | predlozi | napravi); null = ništa.
-- `stanje`:  ceka | radi | gotovo | greska — za prikaz u adminu.
-- `verzija`: raste kad AI napravi novi izbor; admin s drugom verzijom ne smije
--            prepisati isječke (stari ekran preko novog izbora).
-- `isjecci`: isti oblik kao projekat.json lokalnog alata (od, do, dijelovi,
--            naslov, titlovi, kadar, pozicija…).
-- `ispravke`: AI ispravke rečenica (ključ „i0-i1“ → tekst), da ih radnik ne
--            traži ponovo kad mu se obriše lokalna kopija.
-- `gotovi`:  [{ br, put, ime, otisak, velicina, trajanje }] — fajlovi u Storageu.
create table if not exists public.reels_poslovi (
  id          uuid        primary key default gen_random_uuid(),
  url         text        not null,
  yt_id       text        not null check (yt_id ~ '^[A-Za-z0-9_-]{11}$'),
  naslov      text,
  kanal       text,
  trajanje    real,
  sirina      int,
  visina      int,
  tema        text,
  tema_rucno  boolean     not null default false,
  stanje      text        not null default 'ceka' check (stanje in ('ceka', 'radi', 'gotovo', 'greska')),
  zahtjev     text        default 'obradi' check (zahtjev in ('obradi', 'predlozi', 'napravi')),
  faza        text,
  procenat    real,
  greska      text,
  isjecci     jsonb       not null default '[]',
  ispravke    jsonb       not null default '{}',
  gotovi      jsonb       not null default '[]',
  verzija     bigint      not null default 0,
  napravljeno timestamptz not null default now(),
  izmijenjeno timestamptz not null default now()
);
create index if not exists reels_poslovi_izmijenjeno on public.reels_poslovi (izmijenjeno desc);
create index if not exists reels_poslovi_zahtjev on public.reels_poslovi (izmijenjeno) where zahtjev is not null;

-- ---------- radnik ----------
-- Jedan red: kad se radnik zadnji put javio (admin pokaže „laptop je uključen“).
create table if not exists public.reels_radnik (
  id      int         primary key default 1 check (id = 1),
  vidjen  timestamptz,
  posao   uuid,
  verzija text
);

-- ---------- zaštita ----------
-- Kao ostale tabele: RLS bez politika, a anon/authenticated bez prava. Čita i
-- piše samo server (/api, tajni ključ) i radnik (tajni ključ iz lokalnog .env).
alter table public.reels_poslovi enable row level security;
alter table public.reels_radnik  enable row level security;
revoke all on public.reels_poslovi from anon, authenticated;
revoke all on public.reels_radnik  from anon, authenticated;

-- ---------- Storage ----------
-- Privatni bucket; admin dobija potpisane linkove (važe sat vremena).
-- 50 MB po fajlu je granica besplatnog Supabasea; radnik kodira ispod nje.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reels', 'reels', false, 52428800, array['video/mp4', 'application/json'])
on conflict (id) do nothing;
