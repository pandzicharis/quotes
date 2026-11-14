-- ============================================================
-- PRVA PREDAVANJA — jednom, pri puštanju predavanja u produkciju
-- ------------------------------------------------------------
-- Pokreće se u Supabase SQL editoru produkcijske baze, POSLIJE shema.sql.
--
-- Zašto ovako, a ne kroz admin: predavanja ubačena ovdje NE šalju obavijest
-- (obavijest_od ostaje prazno, pa ih ni cron ne dostavlja). Korisnici ih ne
-- dobiju kao niz notifikacija — kad otvore novu verziju aplikacije, iskoče
-- im sva odjednom na ekranu „Nova predavanja“ (sva nadolazeća koja uređaj
-- još nije vidio). Svako predavanje dodano poslije kroz admin, uz uključeno
-- „Pošalji obavijest“, šalje notifikaciju kao i do sada.
--
-- Može se pokrenuti i dvaput: predavanje s istim naslovom i datumom se ne
-- ubacuje ponovo.
--
-- Polja:
--   datum         'YYYY-MM-DD'
--   vrijeme       'HH:MM', lokalno vrijeme mjesta održavanja
--   vrijeme_opis  npr. 'poslije jacije namaza' (ili null)
--   zona          IANA zona: 'Europe/Sarajevo', 'Europe/Vienna', 'Europe/Berlin'…
--   drzava        ISO kod: 'BA', 'AT', 'DE', 'SI', 'HR', 'RS', 'ME', 'CH', 'SE'…
--   stil          plakat: 'zelena' ili 'krem'
--   opcije        '{"hidzri": true}' — hidžretski datum na plakatu, ili '{}'
-- ============================================================

insert into public.predavanja
  (naslov, podnaslov, organizator, datum, vrijeme, vrijeme_opis, zona,
   mjesto, adresa, grad, drzava, opis, link, stil, opcije, objavljeno)
select v.naslov, v.podnaslov, v.organizator, v.datum::date, v.vrijeme, v.vrijeme_opis, v.zona,
       v.mjesto, v.adresa, v.grad, v.drzava, v.opis, v.link, v.stil, v.opcije::jsonb, true
from (values
  -- naslov, podnaslov, organizator, datum, vrijeme, vrijeme_opis, zona,
  -- mjesto, adresa, grad, drzava, opis, link, stil, opcije
  ('NASLOV', null, null, '2026-12-01', '19:00', 'poslije jacije namaza', 'Europe/Sarajevo',
   'Mjesto (džemat, dvorana…)', null, 'Grad', 'BA', null, null, 'zelena', '{}')
  -- , ('…drugo predavanje…', …)
) as v(naslov, podnaslov, organizator, datum, vrijeme, vrijeme_opis, zona,
       mjesto, adresa, grad, drzava, opis, link, stil, opcije)
where v.naslov <> 'NASLOV'                        -- primjer iznad se nikad ne ubacuje
  and not exists (
    select 1 from public.predavanja p where p.naslov = v.naslov and p.datum = v.datum::date
  );

-- provjera: šta je u bazi i da nijedno nema započetu obavijest
select id, datum, vrijeme, naslov, grad, obavijest_od from public.predavanja order by datum, vrijeme;
