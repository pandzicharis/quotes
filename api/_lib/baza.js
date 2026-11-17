/* Supabase (Postgres) preko PostgREST-a — bez dodatnih zavisnosti, kao što je
   raniji Upstash adapter išao na Redis REST. Jedan `fetch`, nikakav klijent.

   Serverski ključ je OBAVEZAN. Publishable/anon ključ ovdje ne vrijedi ništa:
   tabele su pod RLS-om bez ijedne politike, pa mu Postgres ne da ni red. To
   je namjerno — u `pretplate` stoje kriptografski ključevi tuđih uređaja.

   Varijable (prihvata se bilo koje ime iz para):
     SUPABASE_URL          ili  NEXT_PUBLIC_SUPABASE_URL
     SUPABASE_SECRET_KEY   ili  SUPABASE_SERVICE_ROLE_KEY               */

const IMENA_URL = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
const IMENA_KLJUC = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

const nadji = imena => imena.find(i => process.env[i]);

const URL_ = (process.env[nadji(IMENA_URL)] || '').replace(/\/+$/, '');
const KLJUC = process.env[nadji(IMENA_KLJUC)] || '';

/* Najčešća greška pri postavljanju: na server ode `sb_publishable_…` (ili
   stari anon JWT) umjesto tajnog ključa. Tada svaki upit vrati prazno ili
   401, a uzrok nije očigledan — pa ga prepoznajemo unaprijed. */
function jeJavni(k) {
  if (k.startsWith('sb_publishable_')) return true;
  try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64').toString()).role === 'anon'; }
  catch { return false; }
}

const JAVNI = Boolean(KLJUC) && jeJavni(KLJUC);

export const bazaSpremna = () => Boolean(URL_ && KLJUC && !JAVNI);

/** Šta je nađeno — samo imena i dijagnoza, nikad vrijednosti. */
export const bazaVarijable = () => ({
  url: nadji(IMENA_URL) || null,
  kljuc: nadji(IMENA_KLJUC) || null,
  javniKljuc: JAVNI || undefined,
});

const TAB_PRETPLATE = 'pretplate';
const TAB_INSTALACIJE = 'instalacije';

async function zahtjev(putanja, opcije = {}, dozvoljeni = []) {
  if (!bazaSpremna()) {
    throw new Error(JAVNI
      ? 'Na serveru stoji publishable/anon ključ — treba tajni (SUPABASE_SECRET_KEY)'
      : `Supabase nije konfigurisan (${IMENA_URL.join(' ili ')} + ${IMENA_KLJUC.join(' ili ')})`);
  }

  const r = await fetch(`${URL_}/rest/v1/${putanja}`, {
    ...opcije,
    headers: {
      apikey: KLJUC,
      Authorization: `Bearer ${KLJUC}`,
      'Content-Type': 'application/json',
      ...opcije.headers,
    },
  });

  if (!r.ok && !dozvoljeni.includes(r.status)) {
    throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  return r;
}

/* ---------- pretplate ---------- */

/** Upis je upsert po `endpoint`-u: isti uređaj se ne duplira, a rotirani
    ključevi pregledníka se zapišu preko starih umjesto da naprave drugi red. */
export async function dodajPretplatu(sub) {
  const osnova = { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth };
  const red = { ...osnova };
  /* Izbor za obavijesti o predavanjima i praćena predavanja idu samo kad ih
     uređaj pošalje — inače se kolone ne diraju. */
  if (typeof sub.predavanja === 'boolean') red.predavanja = sub.predavanja;
  if (Array.isArray(sub.pracena)) {
    red.pracena = [...new Set(sub.pracena.map(Number))].filter(n => Number.isInteger(n) && n > 0).slice(0, 100);
  }
  const upisi = r => zahtjev(`${TAB_PRETPLATE}?on_conflict=endpoint`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(r),
  });
  try {
    await upisi(red);
  } catch (e) {
    /* Baza na kojoj novije kolone još nisu dodane (sql/shema.sql nije
       pokrenut) odbije cijeli upis. Pretplata je važnija od postavki — ide
       bar ona, da uređaj ne ostane bez poruke dana. */
    if (Object.keys(red).length === Object.keys(osnova).length || !e.message.startsWith('Supabase 400')) throw e;
    await upisi(osnova);
  }
}

/* Isti upsert, ali za više pretplata odjednom — koristi ga seoba iz Redisa
   (scripts/prebaci.js), da stotine zapisa ne znače stotine zahtjeva. */
export async function dodajPretplate(subovi) {
  if (!subovi.length) return;
  await zahtjev(`${TAB_PRETPLATE}?on_conflict=endpoint`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(subovi.map(s => ({ endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth }))),
  });
}

/** Briše po endpointu. Vraća koliko je redova otišlo (0 ako ga nije bilo). */
export async function skiniPretplatu(endpoint) {
  const r = await zahtjev(`${TAB_PRETPLATE}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  return (await r.json()).length;
}

/* PostgREST vraća najviše `max-rows` po odgovoru, a i da ne vraća, jedan
   ogroman JSON nije ono što želimo u memoriji funkcije. Zato stranice po
   1000 redova (vidi sveStranice) — granica koja je kod Redisa bila tvrda
   (cijeli `SMEMBERS` u jednom odgovoru) ovdje više ne postoji. */
const STRANICA = 1000;

/** Sve pretplate u obliku koji `web-push` prima direktno, plus `id` za brisanje.
    `zaPredavanja` ostavlja samo uređaje koji nisu isključili obavijesti o
    predavanjima, a `prati` (id predavanja) samo one koji ga prate. */
const filterPretplata = ({ zaPredavanja = false, prati = 0 } = {}) =>
  `${zaPredavanja || prati ? '&predavanja=is.true' : ''}${prati ? `&pracena=cs.%7B${Number(prati)}%7D` : ''}`;
const uPretplatu = red => ({ id: red.id, endpoint: red.endpoint, keys: { p256dh: red.p256dh, auth: red.auth } });

export async function svePretplate(filter = {}) {
  const redovi = await sveStranice(`${TAB_PRETPLATE}?select=id,endpoint,p256dh,auth&order=id.asc${filterPretplata(filter)}`);
  return redovi.map(uPretplatu);
}

/* Nadoknada se zove svaki sat, a obično su svi već dobili. Zato prvo samo
   id-evi (par bajtova po pretplati); cijeli red (endpoint i ključevi, ~400 B)
   čita se samo za one kojima još treba poslati. */
const KOMAD_ID = 200;            // toliko id-eva u jednom `id=in.(…)` — URL ostaje kratak

/**
 * Ko od pretplata (uz isti filter kao `svePretplate`) još nema obavijest
 * `kljuc`. Vraća `{ ukupno, dobilo, ostali }`: koliko pretplata ima, koliko
 * ih je već dobilo i pune pretplate onih koji nisu. Kad fali većina (prvo
 * slanje u danu), cijela lista u jednom prolazu je jeftinija od komada.
 */
export async function kojiNemaju(kljuc, filter = {}) {
  const [idevi, imaju] = await Promise.all([
    sveStranice(`${TAB_PRETPLATE}?select=id&order=id.asc${filterPretplata(filter)}`).then(r => r.map(x => x.id)),
    isporucene(kljuc),
  ]);
  const fale = idevi.filter(id => !imaju.has(id));
  const dobilo = idevi.length - fale.length;
  if (!fale.length) return { ukupno: idevi.length, dobilo, ostali: [] };
  if (fale.length > idevi.length / 2) {
    const ostali = (await svePretplate(filter)).filter(s => !imaju.has(s.id));
    return { ukupno: idevi.length, dobilo, ostali };
  }
  const ostali = [];
  for (let i = 0; i < fale.length; i += KOMAD_ID) {
    const komad = fale.slice(i, i + KOMAD_ID);
    const redovi = await sveStranice(`${TAB_PRETPLATE}?select=id,endpoint,p256dh,auth&id=in.(${komad.join(',')})&order=id.asc`);
    ostali.push(...redovi.map(uPretplatu));
  }
  return { ukupno: idevi.length, dobilo, ostali };
}

const izContentRange = r => {
  const zaglavlje = r.headers.get('content-range') || '';
  const ukupno = Number(zaglavlje.split('/')[1]);
  return Number.isFinite(ukupno) ? ukupno : 0;
};

export async function brojPretplata() {
  const r = await zahtjev(`${TAB_PRETPLATE}?select=id`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
  });
  return izContentRange(r);
}

/* Brisanje ide po brojčanom `id`-u, ne po endpointu: endpoint je ~200 znakova
   i lista bi probila dužinu URL-a već na desetak zapisa. Ovako u jedan
   zahtjev stane cijela grupa. */
const GRUPA_BRISANJA = 200;

/** Briše više pretplata po id-u. Vraća koliko ih je zaista obrisano. */
export async function skiniPretplate(idevi) {
  let obrisano = 0;
  for (let i = 0; i < idevi.length; i += GRUPA_BRISANJA) {
    const grupa = idevi.slice(i, i + GRUPA_BRISANJA);
    const r = await zahtjev(`${TAB_PRETPLATE}?id=in.(${grupa.join(',')})`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    obrisano += (await r.json()).length;
  }
  return obrisano;
}

/* ---------- dnevnik isporuka ----------
   Ko je koju obavijest već dobio (vidi `isporuke` u sql/shema.sql). Na tome
   stoji nadoknada: svaki poziv crona šalje samo onima kojih nema u dnevniku. */
const TAB_ISPORUKE = 'isporuke';

/** Id-evi pretplata koje su obavijest `kljuc` već dobile. */
export async function isporucene(kljuc) {
  const redovi = await sveStranice(`${TAB_ISPORUKE}?select=pretplata&kljuc=eq.${encodeURIComponent(kljuc)}&order=pretplata.asc`);
  return new Set(redovi.map(x => x.pretplata));
}

/* Brava slanja: dva poziva ne smiju slati istovremeno — oba bi pročitala isti
   dnevnik i poslala istu poruku istim ljudima (cron koji ponovi poziv, ručna
   proba usred slanja, admin dok cron radi). Brava je red u `isporuke` s
   pretplatom 0, pa njeno uzimanje usput provjeri da baza prima upis: ako ne
   prima, ne šalje se ništa — inače bi svaki poziv slao svima ispočetka.
   Brava funkcije koja je pala bez puštanja istekne poslije `rokMs`. */
const BRAVA_ROK_MS = 330_000;     // duže od najdužeg slanja (maxDuration 300 s)

/** true — brava je naša; false — drugo slanje je u toku. Baca grešku kad baza ne prima upis. */
export async function uzmiBravu(ime) {
  const red = JSON.stringify([{ pretplata: 0, kljuc: `brava:${ime}` }]);
  for (let pokusaj = 0; pokusaj < 2; pokusaj++) {
    const r = await zahtjev(`${TAB_ISPORUKE}?on_conflict=pretplata,kljuc`, {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: red,
    });
    if ((await r.json()).length) return true;
    // zauzeta: ako je starija od roka, njen poziv je pao bez puštanja — skloni je i probaj još jednom
    const prije = new Date(Date.now() - BRAVA_ROK_MS).toISOString();
    await zahtjev(`${TAB_ISPORUKE}?pretplata=eq.0&kljuc=eq.${encodeURIComponent(`brava:${ime}`)}&napravljeno=lt.${prije}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }
  return false;
}

export async function pustiBravu(ime) {
  await zahtjev(`${TAB_ISPORUKE}?pretplata=eq.0&kljuc=eq.${encodeURIComponent(`brava:${ime}`)}`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

/** Upisuje isporuku za grupu pretplata; već upisane se preskaču. */
export async function zabiljeziIsporuke(kljuc, idevi) {
  if (!idevi.length) return;
  await zahtjev(`${TAB_ISPORUKE}?on_conflict=pretplata,kljuc`, {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(idevi.map(pretplata => ({ pretplata, kljuc }))),
  });
}

/** Dnevnik ne raste unedogled: isporuke starije od `dana` odlaze. */
export async function ocistiIsporuke(dana = 14) {
  const prije = new Date(Date.now() - dana * 86400000).toISOString();
  await zahtjev(`${TAB_ISPORUKE}?napravljeno=lt.${prije}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

/* ---------- pregled: sažeci slanja i brojači događaja ---------- */
const TAB_SLANJA = 'slanja';
const TAB_DOGADJAJI = 'dogadjaji';
export const KLJUC_OBAVIJESTI = /^(dan:\d{4}-\d{2}-\d{2}|novo:\d{1,16}|podsjetnik:\d{1,16})$/;
const PORUKA = /^poruka:\d{1,6}$/;
const PREDAVANJE = /^predavanje:\d{1,16}$/;

/** Šta uređaj smije javiti za pregled (/analytics) i kakav ključ uz to ide.
    Ništa o uređaju ni o osobi — samo vrsta i šta se desilo. */
export const DOGADJAJI = {
  stiglo: KLJUC_OBAVIJESTI,          // notifikacija prikazana na uređaju
  otvoreno: KLJUC_OBAVIJESTI,        // dodir na notifikaciju
  aplikacija: /^(pwa|web)$/,         // prvo otvaranje aplikacije u danu, po uređaju
  dijeljenje: PORUKA,                // slika poruke poslana dalje
  preuzimanje: PORUKA,               // slika poruke sačuvana na uređaj
  kopiranje: PORUKA,                 // tekst ili slika kopirani
  sacuvano: PORUKA,                  // poruka dodana u „Sačuvano“
  pregled: PREDAVANJE,               // otvoreno predavanje
  plakat: PREDAVANJE,                // sačuvan plakat
  prati: PREDAVANJE,                 // „Planiram ići“
  kalendar: PREDAVANJE,              // dodano u kalendar telefona
};

export async function zabiljeziSlanje(red) {
  await zahtjev(TAB_SLANJA, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(red) });
}

/** Sažeci slanja od `od` (ISO) naovamo, najnoviji prvi. */
export const slanjaOd = od => sveStranice(`${TAB_SLANJA}?select=*&napravljeno=gte.${od}&order=napravljeno.desc,id.desc`);

/** +1 na brojač (dan, vrsta, ključ) — jedan red po danu, ne po događaju,
    pa tabela ostaje sitna i kad ih je hiljade dnevno. */
export async function zabiljeziDogadjaj(vrsta, kljuc = '') {
  await zahtjev('rpc/zabiljezi_dogadjaj', {
    method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ p_vrsta: vrsta, p_kljuc: kljuc }),
  });
}

/** Svi redovi upita, stranicu po stranicu. Sljedeća počinje tamo gdje je
    prethodna stvarno stala, a kraj je tek prazna stranica — i kad server
    vrati manje od traženog (manji `max-rows`), ništa se ne preskoči i ne
    izgubi. Upit mora imati stalan `order`. */
async function sveStranice(upit) {
  const sve = [];
  for (let strana = 0, i = 0; strana < 5000; strana++) {
    const r = await zahtjev(upit, { headers: { 'Range-Unit': 'items', Range: `${i}-${i + STRANICA - 1}` } }, [416]);
    const dio = r.status === 416 ? [] : await r.json();
    if (!dio.length) break;
    sve.push(...dio);
    i += dio.length;
  }
  return sve;
}

/** Brojači od dana `od` ('YYYY-MM-DD') naovamo. */
export const dogadjajiOd = od =>
  sveStranice(`${TAB_DOGADJAJI}?select=dan,vrsta,kljuc,broj&dan=gte.${od}&order=dan.desc,vrsta,kljuc`);

/** Svi brojači za poruke ('poruka:<id>'), za cijelo vrijeme koje se čuva. */
export const dogadjajiPoruka = () =>
  sveStranice(`${TAB_DOGADJAJI}?select=vrsta,kljuc,broj&kljuc=like.poruka:*&order=dan,vrsta,kljuc`);

/** Koja je poruka otišla kao poruka dana — po zapisima slanja ('dan:…' + id). */
export const zapisanePorukeDana = () =>
  sveStranice(`${TAB_SLANJA}?select=kljuc,poruka&poruka=not.is.null&order=id`);

/** Brojači se čuvaju sedmicu (pregled prikazuje 7 dana, plus dan rezerve) —
    tabela ostaje sitna koliko god ljudi koristilo aplikaciju. */
export async function ocistiDogadjaje(dana = 8) {
  const prije = new Date(Date.now() - dana * 86400000).toISOString().slice(0, 10);
  await zahtjev(`${TAB_DOGADJAJI}?dan=lt.${prije}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

/* ---------- poruke dana i raspored ----------
   Poruke uređuje admin, a aplikacija i slanje ih čitaju odavde (poruke.json
   je rezerva dok baza ne odgovara). Vidi `poruke` i `raspored_poruka` u
   sql/shema.sql. */
const TAB_PORUKE = 'poruke';
const TAB_RASPORED = 'raspored_poruka';

/** Sve poruke po redoslijedu, i obrisane — aplikaciji trebaju za sačuvane. */
export const svePoruke = () =>
  sveStranice(`${TAB_PORUKE}?select=id,tekst,knjiga,poglavlje,redoslijed,obrisana&order=redoslijed,id`);

/** Nova poruka ide na kraj kruga, s prvim slobodnim id-em (i obrisane ga drže). */
export async function dodajPoruku(p, sve) {
  const id = Math.max(0, ...sve.map(x => x.id)) + 1;
  const redoslijed = Math.max(0, ...sve.map(x => x.redoslijed)) + 1;
  const r = await zahtjev(TAB_PORUKE, {
    method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...p, id, redoslijed }),
  });
  return (await r.json())[0];
}

export async function izmijeniPoruku(id, p) {
  const r = await zahtjev(`${TAB_PORUKE}?id=eq.${id}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...p, izmijenjeno: new Date().toISOString() }),
  });
  return (await r.json())[0] || null;
}

/** { 'YYYY-MM-DD': idPoruke } — svi zakazani dani. */
export async function rasporedPoruka() {
  const redovi = await sveStranice(`${TAB_RASPORED}?select=dan,poruka&order=dan`);
  return Object.fromEntries(redovi.map(x => [x.dan, x.poruka]));
}

/** Izabrani dani do `dan` uključivo, najnoviji prvi — dovoljno za poruku tog
    dana (vidi porukaZaDatum: dan bez izbora nastavlja krug od zadnjeg
    izabranog). 60 redova pokrije i izbor čija je poruka u međuvremenu obrisana. */
export async function rasporedDo(dan) {
  const r = await zahtjev(`${TAB_RASPORED}?select=dan,poruka&dan=lte.${dan}&order=dan.desc&limit=60`);
  return Object.fromEntries((await r.json()).map(x => [x.dan, x.poruka]));
}

/** Upisuje izbor za više dana jednim pozivom: [{ dan, poruka }]. */
export async function zakaziPoruke(redovi) {
  if (!redovi.length) return;
  await zahtjev(`${TAB_RASPORED}?on_conflict=dan`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(redovi),
  });
}

/** Briše izbor za date dane — oni tada nastavljaju krug. */
export async function otkaziPoruke(dani) {
  if (!dani.length) return;
  await zahtjev(`${TAB_RASPORED}?dan=in.(${dani.join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

/* ---------- brojanje instalacija ---------- */
/* Isto što je ranije radio `SADD` u skup: uređaj šalje nasumičnu oznaku koju
   sam napravi i čuva, pa ponovno otvaranje ne diže brojku. Ovdje to nosi
   primarni ključ (platforma, uredjaj) — drugi upis istog para ne prolazi. */

export const PLATFORME = ['ios', 'android', 'ostalo'];

/** Vraća 1 ako je uređaj nov, 0 ako je već brojan. */
export async function zabiljeziInstalaciju(platforma, uredjaj) {
  const r = await zahtjev(`${TAB_INSTALACIJE}?on_conflict=platforma,uredjaj`, {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ platforma, uredjaj }),
  });
  return (await r.json()).length ? 1 : 0;
}

export async function brojInstalacija(platforma) {
  const r = await zahtjev(`${TAB_INSTALACIJE}?select=uredjaj&platforma=eq.${platforma}`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
  });
  return izContentRange(r);
}

/** Sve platforme odjednom → { ios: 12, android: 40, ostalo: 1 }. */
export async function sveInstalacije() {
  const brojevi = await Promise.all(PLATFORME.map(brojInstalacija));
  return Object.fromEntries(PLATFORME.map((p, i) => [p, brojevi[i] || 0]));
}

/* ---------- predavanja ---------- */

const TAB_PREDAVANJA = 'predavanja';
const JAVNA_POLJA = 'id,naslov,podnaslov,organizator,datum,vrijeme,vrijeme_opis,zona,mjesto,adresa,grad,drzava,opis,link,stil,opcije,napravljeno,izmijenjeno';

/* Javna lista nosi i nedavno održana, da kalendar u aplikaciji ima i
   „održano“ (dok ih cron ne obriše, vidi obrisiProslaPredavanja); admin vidi
   sve, i neobjavljena. */
export async function listaPredavanja(sve = false) {
  // privatni ključ (link za dijeljenje plakata) ne ide u javnu listu
  const polja = sve ? '*' : JAVNA_POLJA;
  let upit = `${TAB_PREDAVANJA}?select=${polja}&order=datum.asc,vrijeme.asc&limit=500`;
  if (!sve) {
    const od = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    upit += `&objavljeno=is.true&datum=gte.${od}`;
  }
  return (await zahtjev(upit)).json();
}

/** Jedno predavanje po privatnom ključu (i neobjavljeno — link je privatan). */
export async function predavanjePoKljucu(k) {
  const r = await zahtjev(`${TAB_PREDAVANJA}?select=*&kljuc=eq.${encodeURIComponent(k)}&limit=1`);
  return (await r.json())[0] || null;
}

/** Objavljena predavanja čija je obavijest „Novo“ krenula u zadnja dva dana —
    nadoknada je dostavlja uređajima koji je još nemaju. */
export async function predavanjaUObavjestavanju() {
  const od = new Date(Date.now() - 2 * 86400000).toISOString();
  return (await zahtjev(`${TAB_PREDAVANJA}?select=${JAVNA_POLJA}&objavljeno=is.true&obavijest_od=gte.${od}`)).json();
}

/** Objavljena predavanja od danas do za dva dana — kandidati za podsjetnik. */
export async function predavanjaUskoro() {
  const dan = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  return (await zahtjev(`${TAB_PREDAVANJA}?select=${JAVNA_POLJA}&objavljeno=is.true&datum=gte.${dan(-1)}&datum=lte.${dan(2)}`)).json();
}

/** Prošla predavanja se ne čuvaju: `dana` dana poslije datuma (po Sarajevu)
    odlaze iz baze. Dva dana su dovoljna i za predavanje na drugom kraju
    svijeta, koje kod nas završava sutradan. */
export async function obrisiProslaPredavanja(dana = 2) {
  // po dijelovima, ne .format(): oblik datuma zavisi od verzije ICU-a ('11/2/2026' umjesto '2026-11-02')
  const x = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Sarajevo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(d => [d.type, d.value]));
  const danas = `${x.year}-${x.month}-${x.day}`;
  const granica = new Date(Date.parse(`${danas}T12:00:00Z`) - dana * 86400000).toISOString().slice(0, 10);
  await zahtjev(`${TAB_PREDAVANJA}?datum=lt.${granica}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

/** Bilježi kad je krenula obavijest „Novo“ — samo prvi put. */
export async function oznaciObavijest(id) {
  await zahtjev(`${TAB_PREDAVANJA}?id=eq.${Number(id)}&obavijest_od=is.null`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ obavijest_od: new Date().toISOString() }),
  });
}

export async function dodajPredavanje(p) {
  const r = await zahtjev(TAB_PREDAVANJA, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(p),
  });
  return (await r.json())[0];
}

export async function izmijeniPredavanje(id, p) {
  const r = await zahtjev(`${TAB_PREDAVANJA}?id=eq.${Number(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...p, izmijenjeno: new Date().toISOString() }),
  });
  return (await r.json())[0] || null;
}

export async function obrisiPredavanje(id) {
  const r = await zahtjev(`${TAB_PREDAVANJA}?id=eq.${Number(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  return (await r.json()).length;
}
