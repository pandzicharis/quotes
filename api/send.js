/* Dnevno slanje i nadoknada.
   Okida ga cron — vanjska konzola ili Vercel Cron. Tajna se prihvata kao
   x-cron-secret,  Authorization: Bearer  ili  ?secret=

     /api/send?nadoknadi=1   poruka dana samo onima koji današnju još nemaju,
                             pa obavijesti o predavanjima i podsjetnici. Cron
                             ga zove svaki sat preko dana (7–21 h). Poruka dana
                             kreće tek u 10 h po Sarajevu: poziv u 10 h pošalje
                             svima, kasniji dostave ono što je palo ili nije
                             stiglo na red. Pozivi u 7, 8 i 9 h šalju samo
                             obavijesti o predavanjima.
     /api/send               poruka dana onima koji je danas još nisu dobili
                             (stari dnevni cron može ostati uz nadoknadu, bez
                             duplikata). Bez dnevnika isporuka — svima, kao ranije.
     /api/send?svima=1       poruka dana SVIMA, i onima koji su je već dobili —
                             samo za probu.
     /api/send?predavanja=1  SAMO obavijesti o predavanjima (podsjetnik dan
                             prije onima koji planiraju ići, dovršetak „Novo
                             predavanje“) — poruku dana nikad ne dira. Za
                             poseban cron posao, odvojen od poruke dana.

   Dva slanja nikad ne idu istovremeno (brava, vidi uzmiBravu u baza.js).

   curl -H "x-cron-secret: <CRON_SECRET>" "https://<domen>/api/send?nadoknadi=1"  */
import {
  svePretplate, kojiNemaju, skiniPretplate, bazaSpremna, zabiljeziIsporuke, ocistiIsporuke, ocistiDogadjaje,
  obrisiProslaPredavanja, uzmiBravu, pustiBravu,
} from './_lib/baza.js';
import { ovlascen, odbij } from './_lib/auth.js';
import {
  postaviVapid, vapidSpreman, ucitajPoruke, porukaZaDatum, napraviSadrzaj, razasalji, danUTC, pauza,
} from './_lib/push.js';
import { nadoknadiPredavanja, zapisiSlanje } from './_lib/obavijesti.js';

/* Kad se približimo granici trajanja funkcije, prestajemo uzimati nove
   pretplate i vraćamo iskren izvještaj — inače nas platforma presiječe na
   504 bez ijednog podatka o tome dokle se stiglo. Ostatak dostavi sljedeći
   poziv nadoknade.

   Vezano za `functions["api/send.js"].maxDuration` u vercel.json: ovo mora
   ostati ispod te vrijednosti, s rezervom od ~30 s za slanja koja su već u
   toku. Mijenjaš jedno — provjeri drugo. */
const ROK_MS = 200_000;
/* Poruka dana ide prva i dobija najveći dio vremena; predavanja dijele ostatak. */
const ROK_PORUKE_MS = 170_000;

/* Poruka dana stiže u 10 h po Sarajevu, svaki dan. Nadoknada se zove i
   ranije (7 h — zbog podsjetnika u zonama gdje je tada veče, npr.
   Australija), ali poruku dana prije 10 h ne šalje. „Novo predavanje“ ide
   odmah iz admina. Ručni /api/send i ?svima=1 šalju kad se pozovu.

   Test radi isto kao produkcija (prag 10 h), da proba na testu pokaže pravo
   ponašanje; drugo vrijeme se na testu glumi simulacijom (&sat=, &dan=,
   vidi ispod). Varijabla SAT_PORUKE u Vercelu može prag promijeniti u bilo
   kojem okruženju (0 = bez praga). */
const SAT_PORUKE = process.env.SAT_PORUKE ? Number(process.env.SAT_PORUKE) : 10;
const satUSarajevu = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Sarajevo', hour: '2-digit', hourCycle: 'h23',
}).format(d));

/* SIMULACIJA — samo na testu (Vercel Preview). `&sat=7` i `&dan=YYYY-MM-DD`
   glume vrijeme poziva, da se cijeli dan (7 h, 10 h, 19 h…) provjeri za par
   minuta, s pravim obavijestima na test uređajima. U produkciji
   (VERCEL_ENV=production) se ovi parametri ne čitaju uopšte. */
const SIMULACIJA = process.env.VERCEL_ENV === 'preview';
function simulacija(q) {
  if (!SIMULACIJA || (!q.has('sat') && !q.has('dan'))) return null;
  const danas = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sarajevo' }).format(new Date());
  const dan = q.get('dan') || danas;
  const sat = q.has('sat') ? Number(q.get('sat')) : satUSarajevu();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dan) || !Number.isInteger(sat) || sat < 0 || sat > 23) return { greska: true };
  // trenutak kad je u Sarajevu `dan` u `sat`:00 (ispravka za ljetno vrijeme)
  let t = Date.parse(`${dan}T${String(sat).padStart(2, '0')}:00:00Z`) - 3600_000;
  for (let k = 0; k < 2; k++) {
    const r = (sat - satUSarajevu(new Date(t)) + 24) % 24;
    t += (r > 12 ? r - 24 : r) * 3600_000;
  }
  return { dan, sat, sada: new Date(t) };
}

/* Jedan kratak zastoj baze ili CDN-a ne smije oboriti cijeli dan: bez
   poruka i pretplata ne ide niko, pa svaki ulazni korak ima drugi pokušaj. */
const jos = async fn => {
  try { return await fn(); }
  catch { await pauza(1500); return fn(); }
};

export default async function handler(req, res) {
  if (!ovlascen(req)) return odbij(res);
  if (!vapidSpreman()) return res.status(503).json({ greska: 'VAPID ključevi nisu postavljeni' });
  if (!bazaSpremna()) return res.status(503).json({ greska: 'Baza pretplata nije konfigurisana' });

  res.setHeader('Cache-Control', 'no-store');
  const pocetak = Date.now();
  const q = new URL(req.url, 'http://x').searchParams;
  const samoPredavanja = q.get('predavanja') === '1';   // bez poruke dana, ma šta drugo stajalo u adresi
  const nadoknadi = !samoPredavanja && q.get('nadoknadi') === '1';
  const svima = !nadoknadi && !samoPredavanja && q.get('svima') === '1';
  const nacin = samoPredavanja ? 'predavanja' : nadoknadi ? 'nadoknada' : svima ? 'svima' : 'dnevno';
  const sim = simulacija(q);
  if (sim?.greska) return res.status(400).json({ greska: 'Simulacija: sat 0–23, dan YYYY-MM-DD' });
  const dan = sim ? sim.dan : danUTC();

  /* Brava prije svega. Njeno uzimanje je upis, pa usput kaže prima li baza
     upis: ako ne prima, nadoknada ne šalje ništa — inače bi svaki poziv
     slao svima ispočetka. Obično slanje bez dnevnika (tabela `isporuke` još
     nije napravljena) radi kao ranije: svima, bez brave. */
  let brava = null;                                   // null — bez brave i bez dnevnika
  try { brava = await jos(() => uzmiBravu('slanje')); }
  catch (e) {
    if (nadoknadi || samoPredavanja) return res.status(503).json({ greska: `Dnevnik isporuka ne prima upis — ništa nije poslano: ${e.message}` });
  }
  if (brava === false) {
    return res.status(200).json({ ok: true, dan, nacin, napomena: 'Drugo slanje je upravo u toku — ovaj poziv ne šalje ništa' });
  }

  // brava se pušta prije odgovora: poslije odgovora platforma smije zamrznuti funkciju
  let odgovor;
  try { odgovor = await posao({ nadoknadi, samoPredavanja, svima, nacin, dan, pocetak, dnevnik: brava === true, req, sim }); }
  catch (e) { odgovor = [500, { greska: e.message, trajanjeMs: Date.now() - pocetak }]; }
  finally { if (brava) await pustiBravu('slanje').catch(() => { /* istekne sama, vidi uzmiBravu */ }); }
  res.status(odgovor[0]).json(odgovor[1]);
}

async function posao({ nadoknadi, samoPredavanja, svima, nacin, dan, pocetak, dnevnik, req, sim }) {
  const sada = sim?.sada || new Date();
  const kljuc = `dan:${dan}`;
  postaviVapid();                       // treba i obavijestima o predavanjima ispod

  /* Kome slati. Uz dnevnik samo onima kojih u njemu nema — a kad su svi već
     dobili, poziv ne čita ni pune pretplate ni poruke, samo id-eve (vidi
     kojiNemaju u baza.js), pa je prazan poziv nadoknade skoro besplatan.
     Nadoknada bez dnevnika ne zna kome je već poslano — tada ne šalje nikome,
     da niko ne dobije istu poruku na svaki poziv; obično slanje tada ide
     svima, kao ranije. */
  // prije 10 h nadoknada ne dira poruku dana — ni ne čita ko ju je dobio;
  // ?predavanja=1 je ne dira nikad
  const porukaDanas = !samoPredavanja && (!nadoknadi || satUSarajevu(sada) >= SAT_PORUKE);
  let ukupno = 0, dobilo = 0, pretplate = [];
  if (porukaDanas) {
    pretplate = null;
    if (dnevnik && !svima) {
      try { ({ ukupno, dobilo, ostali: pretplate } = await jos(() => kojiNemaju(kljuc))); }
      catch (e) {
        if (nadoknadi) return [503, { greska: `Nadoknada ne može pročitati dnevnik isporuka: ${e.message}` }];
      }
    }
    if (!pretplate) {
      pretplate = (await jos(() => svePretplate())) || [];
      ukupno = pretplate.length;
    }
  }

  // poruke se učitavaju tek kad ima kome slati
  let poruka = null;
  let r = { poslano: 0, palo: 0, preskoceno: 0, drugiKrug: 0, mrtve: [], greske: {}, upisPao: false };
  if (pretplate.length) {
    const podaci = await jos(() => ucitajPoruke(req));
    poruka = porukaZaDatum(podaci, sada);
    // isti payload za sve — serijalizuje se jednom, ne po uređaju
    const sadrzaj = JSON.stringify({ ...napraviSadrzaj(podaci, poruka), kljuc });
    r = await razasalji(pretplate, sadrzaj, {
      pocetak, rokMs: ROK_PORUKE_MS,
      // bilježi se u svakom načinu: sljedeći poziv zna ko je dobio
      zabiljezi: dnevnik ? idevi => zabiljeziIsporuke(kljuc, idevi) : null,
    });
  }

  // mrtve pretplate odlaze u grupama, ne poziv po zapisu
  let ocisceno = 0;
  if (r.mrtve.length) {
    try { ocisceno = await skiniPretplate(r.mrtve); } catch { /* tiho — slanje je prošlo */ }
  }
  const dostavljeno = dobilo + r.poslano;
  // sažetak za pregled kad se nešto desilo — ne isti red na svaki poziv zbog
  // pretplate koja uporno pada
  if (pretplate.length && (r.poslano || r.mrtve.length || r.upisPao || !dobilo)) {
    await zapisiSlanje(kljuc, dobilo ? 'nadoknada' : 'slanje',
      { pretplata: ukupno - r.mrtve.length, dostavljeno, r, pocetak, poruka: poruka.id });
  }

  /* Predavanja tek kad je poruka dana obavljena, samo uz PREDAVANJA_PUSH=1 i
     samo dok dnevnik prima upis. Svaki dio ima svoj try — greška ovdje ne
     mijenja ishod poruke dana. */
  let predavanja;
  if ((nadoknadi || samoPredavanja) && !r.upisPao && process.env.PREDAVANJA_PUSH === '1') {
    try { predavanja = await nadoknadiPredavanja({ pocetak, rokMs: ROK_MS, sada }); }
    catch (e) { predavanja = { greska: e.message }; }
  }
  if (nadoknadi || samoPredavanja) {
    // dnevnici ne rastu unedogled, a prošla predavanja odlaze — jeftino i tiho,
    // svako za sebe, da jedna greška ne preskoči ostala
    for (const ocisti of [ocistiIsporuke, ocistiDogadjaje, obrisiProslaPredavanja]) {
      try { await ocisti(); } catch { /* sljedeći put */ }
    }
  }

  return [r.upisPao ? 503 : 200, {
    ok: r.preskoceno === 0 && !r.upisPao,
    dan,
    nacin,
    ...(poruka ? { porukaId: poruka.id } : {}),
    pretplata: ukupno,
    ...(dobilo ? { vecDobilo: dobilo } : {}),
    poslano: r.poslano, palo: r.palo, ocisceno,
    ...(r.drugiKrug ? { drugiKrug: r.drugiKrug } : {}),
    trajanjeMs: Date.now() - pocetak,
    ...(r.preskoceno && !r.upisPao
      ? { preskoceno: r.preskoceno, napomena: `Rok dostignut — ${r.preskoceno} pretplata ide u sljedeću nadoknadu` }
      : {}),
    ...(r.upisPao
      ? { preskoceno: r.preskoceno, napomena: 'Dnevnik isporuka je prestao primati upis — slanje je stalo da se ne bi ponavljalo; ostatak ide kad baza opet radi' }
      : {}),
    ...(Object.keys(r.greske).length ? { greske: r.greske } : {}),
    ...(predavanja ? { predavanja } : {}),
    ...(sim ? { simulacija: { dan: sim.dan, sat: sim.sat } } : {}),
    ...(samoPredavanja ? { napomena: process.env.PREDAVANJA_PUSH === '1' ? 'Samo obavijesti o predavanjima — poruka dana ide svojim poslom' : 'PREDAVANJA_PUSH nije 1 — obavijesti o predavanjima su isključene' }
      : !porukaDanas ? { napomena: `Poruka dana kreće u ${SAT_PORUKE} h — ovaj poziv šalje samo obavijesti o predavanjima` }
      : ukupno ? {} : { napomena: 'Nema ni jedne pretplate u bazi — uređaji nisu registrovani' }),
  }];
}
