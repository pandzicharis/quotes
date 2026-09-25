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
