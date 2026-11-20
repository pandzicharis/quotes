/* ============================================================
   PLAKAT PREDAVANJA — canvas, ista ruka kao slika za dijeljenje
   ------------------------------------------------------------
   Podloga, tekstura, dvostruki okvir, uglovi i znak su isti kao na slici
   poruke. Mreža je urednička, uz jednu lijevu liniju: gore PREDAVANJE
   i logo, u pozadini desno utopljeni hafiz, a dolje ime, krupan naslov
   i tri podatka — ikonica i oznaka u jednom redu, vrijednost ispod —
   a uz donji rub sajt i mreže, kao na kartici u aplikaciji.
   Van BiH iz gornjeg lijevog ugla izlazi zastava.
   Svi razmaci su udio širine, pa story, objava i A3 drže isti ritam.
   Istom rukom se crtaju i raspored predavanja i poruka iz dizajnera u
   adminu (na dnu fajla).
   ============================================================ */
import {
  SERIF, DISPLAY, SANS, STILOVI,
  ucitajSliku, lomiTekst, saAlfom, prozirno, uzorakNaPlatno, podloga, okvir,
} from './platno.js';
import {
  danUSedmici, imeZemlje, MJESECI, MJESECI_KRATKO, hidzriDatum, opcijePlakata,
} from './predavanja-jezgro.js';

/* A3 je 297 × 420 mm u 10 px/mm (~254 dpi) — dovoljno za print, a ispod
   granice od ~16,7 MP koju iOS Safari dozvoljava jednom platnu. */
export const PLAKAT_FORMATI = [
  { id: 'prica',  naziv: 'Story',  opis: '9:16', w: 1080, h: 1920 },
  { id: 'objava', naziv: 'Objava', opis: '4:5',  w: 1080, h: 1350 },
  { id: 'a3',     naziv: 'A3',     opis: 'print', w: 3400, h: 4808 },   // ~290 dpi; veće ne da iOS (platno do 16,7 MP)
];

/* Slika za preuzimanje i dijeljenje crta se u duploj veličini (A3 je već za
   print) — oštrija je i poslije kompresije koju Instagram i WhatsApp dodaju. */
const IZVOZ_MJERILO = f => (f === 'a3' ? 1 : 2);

/** Mjerilo za plakat na ekranu: tačno onoliko piksela koliko ga ekran
    prikazuje (CSS širina × gustoća ekrana) — bez smanjivanja i razvlačenja
    koji bi omekšali slova i logo. */
export function mjeriloEkrana(format, sirinaCss) {
  const f = PLAKAT_FORMATI.find(x => x.id === format) || PLAKAT_FORMATI[1];
  return Math.ceil(sirinaCss * (globalThis.devicePixelRatio || 1)) / f.w;
}

/* Jačina fotografije i zastave po stilu — tamni crtež na papiru iskače jače
   nego svijetli na zelenoj. Zastava zadržava svoje boje, pa je slabija. */
const FOTO = { zelena: .46, krem: .5 };

/* Krem plakat traži jača slova nego kartica s citatom: preko motiva i
   fotografije sivkast tekst djeluje blijedo. Naslov i podaci idu dubljom
   zelenom, zlato je tamnije, a sporedni tekst gušći (`jace` se dodaje na
   prozirnost). Kartica u aplikaciji (STILOVI) ostaje kakva jeste. */
const BOJE_PLAKATA = { krem: { ink: '#0C1D15', gold: '#77551A', jace: .16 } };
const stilPlakata = id => {
  const s = STILOVI.find(x => x.id === id) || STILOVI[0];
  return { ...s, ...BOJE_PLAKATA[s.id] };
};
/** Sporedni tekst u boji slova — na krem papiru gušći. */
const blijedo = (s, a) => saAlfom(s.ink, Math.min(1, a + (s.jace || 0)));
const ZASTAVA = { zelena: .38, krem: .32 };

const FONTOVI = [
  `700 40px ${DISPLAY}`, `400 40px ${SERIF}`, `500 40px ${SERIF}`,
  `italic 400 40px ${SERIF}`, `400 40px ${SANS}`, `500 40px ${SANS}`, `700 40px ${SANS}`,
];

/* Podaci (datum, sat, mjesto) pišu se istim fontom kao oznake iznad njih,
   velikim slovima i malo razmaknuto — kao u detaljima u aplikaciji. Razmak
   važi i za mjerenje, pa lomljenje redova ostaje tačno. */
const verzal = t => (t || '').toLocaleUpperCase('bs');
function saRazmakom(c, razmak, fn) {
  c.save();
  c.letterSpacing = `${razmak}px`;
  try { return fn(); } finally { c.restore(); }
}

/**
 * Fotografija u pozadini, desno: odsječena desnim rubom, utopljena eliptičnom
 * maskom koja cijela stane u sliku (nigdje ravne ivice) i položena kao
 * `luminosity` — uzme boju podloge, ostane crtež i svjetlo. Slog stoji lijevo,
 * gdje je maska već ugasila sliku.
 */
/** Gdje i koliko velika stoji fotografija — treba je i maska teksture. */
function fotoMjere(W, H, img) {
  const ph = Math.min(H * 0.8, W * 1.3);
  const pw = ph * img.naturalWidth / img.naturalHeight;
  return { pw, ph, x: W - pw * .86, y: H * .02 };
}

function fotoNaPlatno(c, W, H, img, jacina) {
  const { pw, ph, x, y } = fotoMjere(W, H, img);
  const kp = document.createElement('canvas');
  kp.width = Math.round(pw); kp.height = Math.round(ph);
  const kc = kp.getContext('2d');
  kc.imageSmoothingQuality = 'high';          // slika se uvećava — bez ovoga je mrljava
  kc.drawImage(img, 0, 0, pw, ph);

  const rx = pw * .5, ry = ph * .45;
  kc.globalCompositeOperation = 'destination-in';
  kc.translate(pw * .5, ph * .45);
  kc.scale(1, ry / rx);
  const g = kc.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(.4, 'rgba(0,0,0,.9)');
  g.addColorStop(.7, 'rgba(0,0,0,.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  kc.fillStyle = g;
  kc.fillRect(-pw * 2, -ph * 2 * rx / ry, pw * 4, ph * 4 * rx / ry);

  c.save();
  c.globalAlpha = jacina;
  c.globalCompositeOperation = 'luminosity';
  c.drawImage(kp, x, y);
  c.restore();
}

/**
 * Zastava izlazi iz gornjeg lijevog ugla, kao odraz fotografije: odsječena
 * gornjim i lijevim rubom, nagnuta i zatalasana (trake po sinusu, nabori svjetlom i sjenom), utopljena
 * maskom koja cijela stane u okvir zastave — nigdje ravne ivice.
 */
function zastavaNaPlatno(c, W, H, img, jacina) {
  const zw = W * 0.64, nw = img.naturalWidth, nh = img.naturalHeight;
  const zh = zw * nh / nw, A = zh * .05;
  const kp = document.createElement('canvas');
  kp.width = Math.round(zw); kp.height = Math.round(zh + A * 2);
  const kc = kp.getContext('2d');
  const traka = Math.max(2, Math.round(zw / 160));
  const faza = x => (x / zw) * Math.PI * 2.2;
  kc.filter = `blur(${W / 900}px)`;
  for (let x = 0; x < zw; x += traka) {
    const dy = Math.sin(faza(x)) * A * (.3 + .7 * x / zw);
    kc.drawImage(img, x / zw * nw, 0, traka / zw * nw + 1, nh, x, A + dy, traka + .6, zh);
  }
  kc.filter = 'none';
  kc.globalCompositeOperation = 'source-atop';
  for (let x = 0; x < zw; x += traka) {
    const n = Math.cos(faza(x));
    kc.fillStyle = n > 0 ? `rgba(255,255,255,${n * .14})` : `rgba(0,0,0,${-n * .2})`;
    kc.fillRect(x, 0, traka + .6, kp.height);
  }
  // sredina maske je lijevo od sredine zastave: desni kraj se ugasi prije
  // nego što stigne do natpisa u sredini plakata (lijevi je ionako izvan)
  const rx = kp.width / 2, ry = kp.height / 2;
  kc.globalCompositeOperation = 'destination-in';
  kc.translate(kp.width * .42, ry);
  kc.scale(1, ry / rx);
  const g = kc.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(.3, 'rgba(0,0,0,.9)');
  g.addColorStop(.6, 'rgba(0,0,0,.45)');
  g.addColorStop(.85, 'rgba(0,0,0,.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  kc.fillStyle = g;
  kc.fillRect(-kp.width, -rx * 2, kp.width * 2, rx * 4);

  c.save();
  c.globalAlpha = jacina;
  c.translate(zw * .38, kp.height * .46);
  c.rotate(-9 * Math.PI / 180);
  c.drawImage(kp, -zw / 2, -kp.height / 2);
  c.restore();
}

/**
 * Lomi tekst u isti broj redova kao obično lomljenje, ali na najužu širinu
 * koja to dozvoljava — redovi ispadnu ujednačeni, bez jedne riječi same u
 * zadnjem redu („Na putu ka / milosti“ postaje „Na putu / ka milosti“).
 */
function lomiRavno(c, tekst, maxW) {
  const n = lomiTekst(c, tekst, maxW).length;
  if (n < 2) return lomiTekst(c, tekst, maxW);
  let uze = maxW * .4, sire = maxW;
  for (let i = 0; i < 14; i++) {
    const w = (uze + sire) / 2;
    if (lomiTekst(c, tekst, w).length === n) sire = w; else uze = w;
  }
  return lomiTekst(c, tekst, sire);
}

/**
 * Opis reda u redove: lomi se između dijelova (dan, sat, mjesto), a sam dio
 * sječe na riječi tek kad ne stane cio — tačka razdjelnika nikad ne počinje red.
 */
function lomiDijelove(c, dijelovi, maxW) {
  const redovi = [];
  let red = '';
  for (const d of dijelovi) {
    const test = red ? `${red} · ${d}` : d;
    if (c.measureText(test).width <= maxW) { red = test; continue; }
    if (red) redovi.push(red);
    const r = lomiTekst(c, d, maxW);
    red = r.pop() || '';
    redovi.push(...r);
  }
  if (red) redovi.push(red);
  return redovi;
}

/* Ikonice za platno, iz istog crteža kao u aplikaciji (viewBox 24). `s` se
   iscrtava linijom, `f` se puni. */
const IKONE = {
  kalendar: { s: 'M6 5h12a2.5 2.5 0 0 1 2.5 2.5V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V7.5A2.5 2.5 0 0 1 6 5zM3.5 10h17M8 3v4M16 3v4' },
  sat: { s: 'M12 3.2a8.8 8.8 0 1 0 0 17.6a8.8 8.8 0 1 0 0-17.6zM12 7.4V12l3.2 2' },
  mjesto: { s: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z' },
  web: { s: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3.3 9.4h17.4M3.3 14.6h17.4M12 3c2.45 2.5 3.7 5.55 3.7 9S14.45 18.5 12 21c-2.45-2.5-3.7-5.55-3.7-9S9.55 5.5 12 3z' },
  facebook: { f: 'M13.4 21.5v-8.2h2.74l.41-3.18H13.4V8.07c0-.92.26-1.55 1.58-1.55h1.69V3.68c-.29-.04-1.3-.13-2.47-.13-2.44 0-4.12 1.49-4.12 4.23v2.36H7.33v3.18h2.75v8.18z' },
  ljudi: { s: 'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7zM2.5 20c.6-3.2 3.2-5 6.5-5s5.9 1.8 6.5 5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 15.4c2 .6 3.2 2.2 3.5 4.6' },
  instagram: { s: 'M8.4 3.2h7.2a5.2 5.2 0 0 1 5.2 5.2v7.2a5.2 5.2 0 0 1-5.2 5.2H8.4a5.2 5.2 0 0 1-5.2-5.2V8.4a5.2 5.2 0 0 1 5.2-5.2zM12 7.95a4.05 4.05 0 1 0 0 8.1a4.05 4.05 0 1 0 0-8.1z',
               f: 'M17.15 5.7a1.15 1.15 0 1 0 0 2.3a1.15 1.15 0 1 0 0-2.3z' },
};

/** Ikonica veličine `vel`, sa sredinom u (x, y). */
function ikonaNaPlatno(c, ime, x, y, vel, boja) {
  const ik = IKONE[ime];
  if (!ik) return;
  c.save();
  c.translate(x - vel / 2, y - vel / 2);
  c.scale(vel / 24, vel / 24);
  c.strokeStyle = c.fillStyle = boja;
  c.lineWidth = 1.7;
  c.lineCap = c.lineJoin = 'round';
  if (ik.s) c.stroke(new Path2D(ik.s));
  if (ik.f) c.fill(new Path2D(ik.f));
  c.restore();
}

/* Sajt i mreže čitaju se iz istog izvora kao u aplikaciji — jednom po stranici. */
let mrezeObecanje = null;
const ucitajMreze = () => (mrezeObecanje ??= fetch('/data/poruke.json')
  .then(r => r.json())
  .then(d => (d.autor?.mreze || []).filter(m => IKONE[m.vrsta]))
  .catch(() => []));

/** Tekst s razmakom slova — `letterSpacing` se vraća čim je red ispisan. */
function razmaknuto(c, tekst, x, y, razmak) {
  c.save();
  c.letterSpacing = `${razmak}px`;
  c.fillText(tekst, x, y);
  c.restore();
}

/* --- dijelovi zajednički plakatu i rasporedu --- */

/** Zaglavlje — natpis, ispod logo — i gdje mu je dno; blok ispod smije do njega.
    Bez natpisa (poruka) logo se penje na njegovo mjesto. */
function zaglavlje(W, m2, U, F, tip, natpis = true) {
  const yP = m2 + U * 3 + F.nad / 2;
  const visLoga = W * 0.08 * tip;              // logo je potpis plakata — mora se vidjeti i u malom pregledu
  const yLogo = natpis ? yP + F.nad / 2 + U * 1.6 : m2 + U * 3;
  return { yP, yLogo, visLoga, dno: yLogo + visLoga };
}

/* Koliko je prozirnog ruba lijevo u slici (udio širine) — logo se poravnava
   po crtežu, ne po rubu PNG-a. */
const lijeviRub = new WeakMap();
function praznoLijevo(img) {
  if (!lijeviRub.has(img)) {
    const w = 400, h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth));
    const k = document.createElement('canvas');
    k.width = w; k.height = h;
    const kc = k.getContext('2d');
    kc.drawImage(img, 0, 0, w, h);
    const d = kc.getImageData(0, 0, w, h).data;
    let x = 0;
    trazi: for (; x < w; x++) for (let y = 0; y < h; y++) if (d[(y * w + x) * 4 + 3] > 24) break trazi;
    lijeviRub.set(img, x < w ? x / w : 0);
  }
  return lijeviRub.get(img);
}

/** Natpis (PREDAVANJE / PREDAVANJA), ispod logo Ammar Bašić, oboje po istoj lijevoj liniji. */
function crtajZaglavlje(c, z, x0, W, F, s, znak, natpis) {
  c.fillStyle = s.gold;
  c.font = `700 ${F.nad}px ${SANS}`;
  if (natpis) razmaknuto(c, natpis, x0, z.yP, W * 0.016);
  if (!znak) return;
  // lijevi rub crteža slova P — slovo ima svoj mali odmak od x0
  const xP = natpis ? x0 - c.measureText(natpis[0]).actualBoundingBoxLeft : x0;
  const lw = z.visLoga * znak.naturalWidth / znak.naturalHeight;
  c.drawImage(znak, xP - lw * praznoLijevo(znak), z.yLogo, lw, z.visLoga);
}

/**
 * Maska teksture za plakat. Motiv je najjači gore lijevo i dijagonalno blijedi
 * prema dnu desno; dolje lijevo, iza sloga, vraća se blag drugi talas. Gdje je
 * crtež — lice na fotografiji i zastava — maska se postepeno gasi, pa motiv
 * oko njih utihne umjesto da preko njih leži kao mreža.
 */
function maskaPlakata(W, H, { foto, zastava } = {}) {
  const mk = document.createElement('canvas');
  mk.width = W; mk.height = H;
  const mc = mk.getContext('2d');

  const lin = mc.createLinearGradient(0, 0, W, H * .9);
  lin.addColorStop(0,   'rgba(255,255,255,.8)');
  lin.addColorStop(.2,  'rgba(255,255,255,.68)');
  lin.addColorStop(.4,  'rgba(255,255,255,.5)');
  lin.addColorStop(.6,  'rgba(255,255,255,.31)');
  lin.addColorStop(.8,  'rgba(255,255,255,.13)');
  lin.addColorStop(1,   'rgba(255,255,255,0)');
  mc.fillStyle = lin;
  mc.fillRect(0, 0, W, H);

  mc.globalCompositeOperation = 'lighter';
  const dno = mc.createRadialGradient(0, H, 0, 0, H, W * .95);
  dno.addColorStop(0,  'rgba(255,255,255,.5)');
  dno.addColorStop(.6, 'rgba(255,255,255,.2)');
  dno.addColorStop(1,  'rgba(255,255,255,0)');
  mc.fillStyle = dno;
  mc.fillRect(0, 0, W, H);

  // meka rupa u obliku elipse: u sredini motiva skoro nema, prema rubu se vraća
  mc.globalCompositeOperation = 'destination-out';
  const rupa = (cx, cy, rx, ry) => {
    mc.save();
    mc.translate(cx, cy);
    mc.scale(1, ry / rx);
    const g = mc.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0,   'rgba(0,0,0,.95)');
    g.addColorStop(.55, 'rgba(0,0,0,.7)');
    g.addColorStop(1,   'rgba(0,0,0,0)');
    mc.fillStyle = g;
    mc.fillRect(-rx, -rx, rx * 2, rx * 2);
    mc.restore();
  };
  if (foto) {
    const f = fotoMjere(W, H, foto);
    rupa(f.x + f.pw * .5, f.y + f.ph * .42, f.pw * .7, f.ph * .6);
  }
  if (zastava) {
    const zw = W * .64, zh = zw * zastava.naturalHeight / zastava.naturalWidth;
    rupa(zw * .38, zh * .5, zw * .6, zh * 1.1);
  }
  return mk;
}

/**
 * Ispod sloga: zastor vraća podlogu, da tekst ne leži na slici. Preko njega
 * ide tekstura s linijama motiva, kao na kartici poruke dana — tek iznad
 * zastora, pa se vidi i iza sloga, ne samo uz sliku — i na kraju okvir.
 */
async function ispodSloga(c, W, H, s, vrhBloka, slike = {}) {
  const zastor = c.createLinearGradient(0, vrhBloka - W * .22, 0, vrhBloka + W * .14);
  zastor.addColorStop(0, prozirno(s.bg[1]));
  zastor.addColorStop(1, saAlfom(s.bg[1], .6));
  c.save();
  c.fillStyle = zastor;
  c.fillRect(0, vrhBloka - W * .22, W, H);
  c.restore();
  /* Na krem papiru zlato se zatamni, inače linije nestanu u papiru. Jačina je
     za najjače mjesto maske — svuda drugdje motiv je slabiji ili ga nema. */
  const krem = s.id === 'krem';
  // sitnija pločica nego na kartici: gušći motiv, pa se na plakatu čita kao šara
  await uzorakNaPlatno(c, W, H, s.uzorak * (krem ? 1.25 : 2), { tamnije: krem ? .4 : 0, maska: maskaPlakata(W, H, slike), sirina: 1.4 });
  okvir(c, W, H, s, { dvostruki: false, uglovi: .45 });
}

/** Koliko mjesta treba redu sa sajtom i mrežama i koliko se mora sabiti da stane. */
function mjereLinkova(c, mreze, fl, U, sirina) {
  c.font = `600 ${fl}px ${SANS}`;
  const sir = mreze.reduce((z, m) => z + fl * 1.85 + c.measureText(m.naziv).width, 0) + U * 2.6 * (mreze.length - 1);
  return { vis: mreze.length ? U * 2 + fl * 1.4 : 0, mj: sir > sirina ? sirina / sir : 1 };
}

/** Sajt i mreže uz donji rub, iznad njih tanka zlatna linija. */
function crtajLinkove(c, mreze, lk, { x0, sirina, dno, fl, U, W, s }) {
  if (!mreze.length) return;
  const yL = dno - fl * .7;
  c.strokeStyle = saAlfom(s.gold, .35);
  c.lineWidth = Math.max(1, W * 0.0014);
  c.beginPath(); c.moveTo(x0, yL - fl * .7 - U * 1.6); c.lineTo(x0 + sirina, yL - fl * .7 - U * 1.6); c.stroke();
  const f2 = fl * lk.mj, ik2 = fl * 1.3 * lk.mj;
  let x = x0;
  c.font = `600 ${f2}px ${SANS}`;
  for (const m of mreze) {
    ikonaNaPlatno(c, m.vrsta, x + ik2 / 2, yL, ik2, s.gold);
    x += ik2 + f2 * .55;
    c.fillStyle = blijedo(s, .82);
    c.fillText(m.naziv, x, yL);
    x += c.measureText(m.naziv).width + U * 2.6 * lk.mj;
  }
}

/** Tekst skraćen trotačkom da stane u `maxW` — za redove rasporeda. */
function skrati(c, t, maxW) {
  if (c.measureText(t).width <= maxW) return t;
  while (t.length > 1 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/**
 * Crta plakat u zadano platno.
 *
 * Mreža je urednička, poravnata uz jednu lijevu liniju (x0):
 *   gore      PREDAVANJE, ispod logo Ammar Bašić
 *   pozadina  hafiz desno, utopljen
 *   dolje     ime · naslov · podnaslov
 *             ▢ DATUM
 *             15. novembar 2026.
 *             ▢ DAN I VRIJEME
 *             nedjelja · 18:30 h
 *             ▢ LOKACIJA
 *             mjesto · adresa, grad · (van BiH) [zastava] DRŽAVA
 *             ▢ ORGANIZATOR (ako nije sam hafiz)
 *             ─────────────────────────────
 *             sajt · Facebook · Instagram
 * Slog se gradi odozdo, pa gornji dio plakata uvijek ostaje slici; na višim
 * formatima razmaci rastu s visinom, a slog nešto sporije.
 *
 * @param {HTMLCanvasElement} cv
 * @param {object} p  predavanje (naslov, podnaslov, datum, vrijeme, zona, mjesto, adresa, grad, drzava, organizator, opcije)
 * @param {{format?: string, stil?: string, autor?: string, mjerilo?: number}} o
 *        `mjerilo` < 1 crta umanjen plakat (sličice)
 */
export async function nacrtajPlakat(cv, p, { format = 'objava', stil, autor = 'Hafiz Ammar Bašić', mjerilo = 1 } = {}) {
  const f = PLAKAT_FORMATI.find(x => x.id === format) || PLAKAT_FORMATI[1];
  const s = stilPlakata(stil || p.stil);
  const op = opcijePlakata(p);
  const vani = p.drzava && p.drzava !== 'BA';

  await Promise.all(FONTOVI.map(x => document.fonts?.load(x).catch(() => {})));
  const [znak, foto, zastava, malaZastava] = await Promise.all([
    ucitajSliku(`/assets/brand/ammar_basic_logo_${s.logo}_1.png`).catch(() => null),
    ucitajSliku('/assets/brand/author.jpg').catch(() => null),
    vani ? ucitajSliku(`/assets/zastave/${p.drzava.toLowerCase()}.png`).catch(() => null) : null,
    p.drzava ? ucitajSliku(`/assets/zastave/${p.drzava.toLowerCase()}.png`).catch(() => null) : null,
  ]);

  const W = Math.round(f.w * mjerilo), H = Math.round(f.h * mjerilo), odnos = H / W;
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');

  const rast = odnos / 1.25;                  // objava 1 · A3 1,13 · story 1,42
  const tip = 1 + (rast - 1) * .35;
  /* Niži formati (objava, A3) nemaju visine za story-razmake: podaci i
     razmaci se tu zbiju za petinu, a naslov ostaje iste veličine. */
  const gust = odnos < 1.5 ? .8 : 1;
  const U = W * 0.012 * rast * gust;
  const F = Object.fromEntries(Object.entries({
    nad: 0.023, ime: 0.022, naslov: 0.088, podnaslov: 0.04,
    iNad: 0.0185, iDatum: 0.044, iVr: 0.037, iPod: 0.027, link: 0.0215,
  }).map(([k, v]) => [k, W * v * tip * (k.startsWith('i') ? gust : 1)]));

  podloga(c, W, H, s);
  if (foto) fotoNaPlatno(c, W, H, foto, FOTO[s.id] ?? FOTO.zelena);
  if (zastava) zastavaNaPlatno(c, W, H, zastava, ZASTAVA[s.id] ?? ZASTAVA.zelena);
  const m2 = W * 0.078;                       // unutrašnji rub okvira (vidi okvir())

  const x0 = m2 + W * 0.025;                  // lijeva linija cijelog sloga — bliže okviru
  const sirina = W - x0 - (m2 + W * 0.045);   // desni rub ostaje gdje je bio
  c.textAlign = 'left';
  c.textBaseline = 'middle';

  /* --- podaci: tri stavke, svaka sa svojom ikonicom u zlatnom krugu --- */
  const [g, mj, d] = (p.datum || '2000-01-01').split('-').map(Number);
  const hDat = op.hidzri ? hidzriDatum(p.datum) : '';
  const lokacija = [p.adresa, p.mjesto ? p.grad : ''].filter(Boolean).join(', ');
  // vrijednosti velikim slovima, samo „h“ iza sata ostaje malo
  const stavke = [
    { ik: 'kalendar', nad: 'DATUM', vr: verzal(`${d}. ${MJESECI[mj - 1]} ${g}.`), font: `700 ${F.iDatum}px ${SANS}`, boja: s.gold,
      pod: hDat ? [hDat] : [] },
    { ik: 'sat', nad: 'DAN I VRIJEME', vr: `${verzal(danUSedmici(p.datum))}${p.vrijeme ? ` · ${p.vrijeme} h` : ''}`, font: `700 ${F.iVr}px ${SANS}`, boja: s.ink,
      pod: p.vrijeme_opis ? [p.vrijeme_opis] : [] },   // vrijeme je lokalno, bez preračunavanja
    { ik: 'mjesto', nad: 'LOKACIJA', vr: verzal(p.mjesto || p.grad || '—'), font: `700 ${F.iVr}px ${SANS}`, boja: s.ink,
      pod: lokacija ? [lokacija] : [], drzava: vani },
    ...(p.organizator ? [{ ik: 'ljudi', nad: 'ORGANIZATOR', vr: verzal(p.organizator), font: `700 ${F.iVr * .9}px ${SANS}`, boja: s.ink, pod: [] }] : []),
  ];
  const ikV = F.iNad * 1.7;                   // ikonica u redu s oznakom
  const xT = x0, wT = sirina;
  const vlh = F.iVr * 1.25, podLh = F.iPod * 1.4;
  const razV = W * 0.0018;                    // razmak slova u vrijednostima
  for (const k of stavke) {
    c.font = k.font;
    // vrijednost u najviše dva reda — dugo se ne krnji, nego se slog smanji
    k.vrRedovi = saRazmakom(c, razV, () => lomiRavno(c, k.vr, wT));
    while (k.vrRedovi.length > 2 && parseFloat(k.font.match(/[\d.]+px/)[0]) > F.iVr * .7) {
      k.font = k.font.replace(/[\d.]+px/, m => `${parseFloat(m) * .94}px`);
      c.font = k.font;
      k.vrRedovi = saRazmakom(c, razV, () => lomiRavno(c, k.vr, wT));
    }
    c.font = `400 ${F.iPod}px ${SANS}`;
    k.podRedovi = k.pod.flatMap(t => lomiRavno(c, t, wT)).slice(0, 2);
    const visT = F.iNad + U * 1.3 + k.vrRedovi.length * vlh
      + (k.podRedovi.length ? U * .6 + k.podRedovi.length * podLh : 0)
      + (k.drzava ? U * .9 + F.iNad * 1.4 : 0);
    k.vis = visT + (ikV - F.iNad) / 2;
  }
  const razmakStavki = U * 4.2;                // između stavki više zraka nego unutar njih
  const visStavki = stavke.reduce((z, k) => z + k.vis, 0) + razmakStavki * (stavke.length - 1);

  /* --- linkovi na dnu: sajt, Facebook, Instagram, kao na kartici u aplikaciji --- */
  const mreze = await ucitajMreze();
  const fl = F.link;
  const lk = mjereLinkova(c, mreze, fl, U, sirina);
  const visLinkova = lk.vis;

  // zaglavlje: PREDAVANJE, ispod logo — blok ispod smije zauzeti sve do njega
  const z = zaglavlje(W, m2, U, F, tip);
  const dnoZaglavlja = z.dno;

  /* --- naslov: krupno, ujednačeni redovi; smanjuje se dok cijeli donji blok
     ne stane u donjih ~58% plakata — gornji dio pripada slici --- */
  const dno = H - m2 - U * 3;
  let fs = F.naslov, redovi, lh, pod, plh, visBloka;
  for (;;) {
    c.font = `700 ${fs}px ${DISPLAY}`;
    redovi = lomiRavno(c, p.naslov || 'Naslov predavanja', sirina * .92);
    lh = fs * 1.08;
    const fp = Math.min(F.podnaslov, fs * .45);
    c.font = `italic 400 ${fp}px ${SERIF}`;
    pod = p.podnaslov ? lomiRavno(c, p.podnaslov, sirina * .8) : [];
    plh = fp * 1.3;
    visBloka = F.ime + U * 1.4 + redovi.length * lh + (pod.length ? U * 1.2 + pod.length * plh : 0)
      + U * 5.5 + visStavki + visLinkova + U * 2.5;
    if ((visBloka <= dno - dnoZaglavlja - U * 4 && redovi.length <= 3) || fs < W * 0.05) break;
    fs *= .95;
  }
  const fp = Math.min(F.podnaslov, fs * .45);

  /* --- crtanje, odozgo nadolje od vrha bloka --- */
  const vrhBloka = dno - visBloka;
  await ispodSloga(c, W, H, s, vrhBloka, { foto, zastava });
  crtajZaglavlje(c, z, x0, W, F, s, znak, 'PREDAVANJE');

  let y = vrhBloka;
  c.fillStyle = s.gold;
  c.font = `700 ${F.ime}px ${SANS}`;
  razmaknuto(c, autor.toUpperCase(), x0, y + F.ime / 2, W * 0.01);
  y += F.ime + U * 1.4;

  c.fillStyle = s.ink;
  c.font = `700 ${fs}px ${DISPLAY}`;
  redovi.forEach((r, i) => c.fillText(r, x0 - fs * .03, y + lh * (i + .5)));
  y += redovi.length * lh;
  if (pod.length) {
    y += U * 1.2;
    c.fillStyle = saAlfom(s.gold, .92);
    c.font = `italic 400 ${fp}px ${SERIF}`;
    pod.forEach((r, i) => c.fillText(r, x0, y + plh * (i + .5)));
    y += pod.length * plh;
  }

  // podaci: ikonica i oznaka u jednom redu, vrijednost i pojašnjenje ispod
  y += U * 5.5;                               // grupa od grupe: naslov → podaci
  for (const k of stavke) {
    let yy = y + (ikV - F.iNad) / 2;
    ikonaNaPlatno(c, k.ik, x0 + ikV / 2, yy + F.iNad / 2, ikV, s.gold);
    c.fillStyle = saAlfom(s.gold, .9);
    c.font = `700 ${F.iNad}px ${SANS}`;
    razmaknuto(c, k.nad, x0 + ikV + U * .8, yy + F.iNad / 2, W * 0.008);
    yy += F.iNad + U * 1.3;
    c.fillStyle = k.boja;
    c.font = k.font;
    k.vrRedovi.forEach((r, j) => razmaknuto(c, r, xT, yy + vlh * (j + .5), razV));
    yy += k.vrRedovi.length * vlh;
    if (k.podRedovi.length) {
      yy += U * .6;
      c.fillStyle = blijedo(s, .66);
      c.font = `400 ${F.iPod}px ${SANS}`;
      k.podRedovi.forEach((r, j) => c.fillText(r, xT, yy + podLh * (j + .5)));
      yy += k.podRedovi.length * podLh;
    }
    // van BiH država: mala zastava pa ime velikim slovima
    if (k.drzava) {
      yy += U * .9;
      const zh = F.iNad * 1.4, zw = zh * 1.5;
      if (malaZastava) {
        c.save();
        c.beginPath();
        c.roundRect ? c.roundRect(xT, yy, zw, zh, zh * .18) : c.rect(xT, yy, zw, zh);
        c.clip();
        c.drawImage(malaZastava, xT, yy, zw, zh);
        c.restore();
      }
      c.fillStyle = blijedo(s, .78);
      c.font = `700 ${F.iNad}px ${SANS}`;
      razmaknuto(c, imeZemlje(p.drzava).toUpperCase(), xT + (malaZastava ? zw + U * .9 : 0), yy + zh / 2, W * 0.008);
    }
    y += k.vis + razmakStavki;
  }
  y -= razmakStavki;

  crtajLinkove(c, mreze, lk, { x0, sirina, dno, fl, U, W, s });
}

/**
 * Raspored: jedna slika sa svim predavanjima u mjesecu ili periodu, istim
 * rukopisom kao plakat. Gore PREDAVANJA i logo, hafiz desno u pozadini, a
 * dolje naslov perioda i red po predavanju:
 *   15 │ Beč  [zastava] AUSTRIJA
 *  NOV │ Nedjelja · 18:30 h · Bošnjački kulturni centar
 * Kad redovi ne stanu ni smanjeni, slažu se u dvije kolone.
 *
 * @param {object[]} lista  predavanja, već poredana
 * @param {{format?: string, stil?: string, naslov?: string, podnaslov?: string, autor?: string, mjerilo?: number}} o
 */
export async function nacrtajRaspored(cv, lista, {
  format = 'objava', stil = 'zelena', naslov = 'Predavanja', podnaslov = '', autor = 'Hafiz Ammar Bašić', mjerilo = 1,
} = {}) {
  const f = PLAKAT_FORMATI.find(x => x.id === format) || PLAKAT_FORMATI[1];
  const s = stilPlakata(stil);
  // zastava samo van BiH — domaća predavanja su većina, njima ne treba
  const drzave = [...new Set(lista.map(p => p.drzava).filter(d => d && d !== 'BA'))];

  await Promise.all(FONTOVI.map(x => document.fonts?.load(x).catch(() => {})));
  const [znak, foto, mreze, ...slike] = await Promise.all([
    ucitajSliku(`/assets/brand/ammar_basic_logo_${s.logo}_1.png`).catch(() => null),
    ucitajSliku('/assets/brand/author.jpg').catch(() => null),
    ucitajMreze(),
    ...drzave.map(iso => ucitajSliku(`/assets/zastave/${iso.toLowerCase()}.png`).catch(() => null)),
  ]);
  const zastave = Object.fromEntries(drzave.map((iso, i) => [iso, slike[i]]));

  const W = Math.round(f.w * mjerilo), H = Math.round(f.h * mjerilo), odnos = H / W;
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const rast = odnos / 1.25, tip = 1 + (rast - 1) * .35;
  const U = W * 0.012 * rast * (odnos < 1.5 ? .8 : 1);
  const F = Object.fromEntries(Object.entries({
    nad: 0.023, ime: 0.022, naslov: 0.078, podnaslov: 0.036, link: 0.0215,
    dan: 0.066, mj: 0.0165, grad: 0.036, mjesto: 0.025,
  }).map(([k, v]) => [k, W * v * tip]));

  podloga(c, W, H, s);
  if (foto) fotoNaPlatno(c, W, H, foto, FOTO[s.id] ?? FOTO.zelena);

  const m2 = W * 0.078, x0 = m2 + W * 0.025, sirina = W - x0 - (m2 + W * 0.045);
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  const z = zaglavlje(W, m2, U, F, tip);
  const dno = H - m2 - U * 3;
  const lk = mjereLinkova(c, mreze, F.link, U, sirina);

  // naslov perioda — najviše dva reda
  let fs = F.naslov, redN;
  for (;;) {
    c.font = `700 ${fs}px ${DISPLAY}`;
    redN = lomiRavno(c, naslov, sirina);
    if (redN.length <= 2 || fs < W * 0.045) break;
    fs *= .95;
  }
  const lh = fs * 1.08, fp = F.podnaslov, plh = fp * 1.3;
  c.font = `italic 400 ${fp}px ${SERIF}`;
  const podR = podnaslov ? lomiRavno(c, podnaslov, sirina) : [];
  const visGlave = F.ime + U * 1.4 + redN.length * lh + (podR.length ? U * 1.1 + podR.length * plh : 0) + U * 4.5;

  /* --- redovi: mjera k ih poveća ili smanji koliko treba da sva stanu. Opis
     reda (dan, sat, mjesto) lomi se u najviše tri reda, da se ništa ne krije;
     u dvije kolone ide tek kad bi jedna bila presitna za čitanje. --- */
  const n = lista.length;
  const prostor = dno - z.dno - U * 4 - visGlave - lk.vis - U * 1.5;
  // dan i mjesto velikim slovima, kao na plakatu; opis vremena ostaje malim
  const dijeloviReda = p => [verzal(danUSedmici(p.datum)), p.vrijeme ? `${p.vrijeme} h` : '', p.vrijeme_opis, p.grad ? verzal(p.mjesto) : '']
    .filter(Boolean);
  const slozi = (k, kol) => {
    const kolW = kol === 1 ? sirina : (sirina - U * 4) / 2;
    const fd = F.dan * k, fmj = F.mjesto * k, dw = fd * 1.3;   // dw: kolona datuma
    c.font = `500 ${fmj}px ${SANS}`;
    const wt = kolW - dw - U * 2.8 * k;
    const opisi = lista.map(p => {
      const r = lomiDijelove(c, dijeloviReda(p), wt);
      return r.length > 3 ? [r[0], r[1], skrati(c, r.slice(2).join(' '), wt)] : r;
    });
    const bh = F.mj * k * 2.1, hL = bh + fd * 1.05;           // list kalendara: traka s mjesecom + dan
    /* Grad i opis su zbijen blok (od vrha slova grada do osnovne linije
       zadnjeg reda), centriran po visini lista. Kad opis ima više redova
       nego što list primi, list se produži — blok nikad ne viri. */
    // mjere se od osnovne linije — ostatak sloga radi sa 'middle'
    c.textBaseline = 'alphabetic';
    const vrhSlova = font => { c.font = font; return c.measureText('H').actualBoundingBoxAscent; };
    const capG = vrhSlova(`700 ${F.grad * k}px ${SANS}`), capM = vrhSlova(`500 ${fmj}px ${SANS}`);
    c.textBaseline = 'middle';
    const razmakG = U * 1.25 * k;                                // od grada do opisa (i kvačica na Č, Š)
    const visTeksta = o => capG + razmakG + capM + fmj * 1.3 * (o.length - 1);
    const hB = Math.max(hL, ...opisi.map(o => visTeksta(o) + U * 1.2 * k));
    const rh = hB + U * 3.2 * k, uKoloni = Math.ceil(n / kol);
    return { k, kol, kolW, dw, hB, bh, capG, visTeksta, rh, opisi, uKoloni, stane: uKoloni * rh <= prostor };
  };
  const najvece = kol => { let k = 1.25, r; do { r = slozi(k, kol); k *= .96; } while (!r.stane && k > .3); return r; };
  let L = najvece(1);
  if (L.k < .6 && n > 5) { const L2 = najvece(2); if (L2.k > L.k) L = L2; }
  const { kol, k, kolW, dw, hB, bh, capG, visTeksta, rh, opisi, uKoloni } = L;
  const fd = F.dan * k, fm = F.mj * k, fg = F.grad * k, fmj = F.mjesto * k;

  const visBloka = visGlave + uKoloni * rh + U * 1.5 + lk.vis;
  const vrhBloka = dno - visBloka;
  await ispodSloga(c, W, H, s, vrhBloka, { foto });
  crtajZaglavlje(c, z, x0, W, F, s, znak, 'PREDAVANJA');

  let y = vrhBloka;
  c.fillStyle = s.gold;
  c.font = `700 ${F.ime}px ${SANS}`;
  razmaknuto(c, autor.toUpperCase(), x0, y + F.ime / 2, W * 0.01);
  y += F.ime + U * 1.4;
  c.fillStyle = s.ink;
  c.font = `700 ${fs}px ${DISPLAY}`;
  redN.forEach((r, i) => c.fillText(r, x0 - fs * .03, y + lh * (i + .5)));
  y += redN.length * lh;
  if (podR.length) {
    y += U * 1.1;
    c.fillStyle = saAlfom(s.gold, .92);
    c.font = `italic 400 ${fp}px ${SERIF}`;
    podR.forEach((r, i) => c.fillText(r, x0, y + plh * (i + .5)));
    y += podR.length * plh;
  }
  y += U * 4.5;

  const linija = (xa, ya, xb, yb, a) => {
    c.strokeStyle = saAlfom(s.gold, a);
    c.lineWidth = Math.max(1, W * 0.0012);
    c.beginPath(); c.moveTo(xa, ya); c.lineTo(xb, yb); c.stroke();
  };
  for (let kk = 0; kk < kol; kk++) {
    const x = x0 + kk * (kolW + U * 4);
    const red = lista.slice(kk * uKoloni, (kk + 1) * uKoloni);
    red.forEach((p, i) => {
      const yTop = y + i * rh, yc = yTop + rh / 2, o = opisi[kk * uKoloni + i];
      linija(x, yTop, x + kolW, yTop, .22);
      const [, mj, d] = (p.datum || '2000-01-01').split('-').map(Number);

      // datum kao list kalendara, isti kao u aplikaciji: gore zlatna traka s
      // mjesecom, ispod krupan dan; broj se centrira po stvarnom crtežu cifara
      const topL = yc - hB / 2, xd = x + dw / 2;
      const lw = dw * .92, lx = x + (dw - lw) / 2, rr = lw * .18;
      const okvirLista = () => { c.beginPath(); c.roundRect ? c.roundRect(lx, topL, lw, hB, rr) : c.rect(lx, topL, lw, hB); };
      c.save();
      okvirLista(); c.clip();
      c.fillStyle = saAlfom(s.gold, s.id === 'krem' ? .07 : .1);
      c.fillRect(lx, topL, lw, hB);
      const traka = c.createLinearGradient(lx, topL, lx + lw, topL + bh);
      traka.addColorStop(0, s.navod);
      traka.addColorStop(1, s.gold);
      c.fillStyle = traka;
      c.fillRect(lx, topL, lw, bh);
      c.restore();
      okvirLista();
      c.strokeStyle = saAlfom(s.gold, .5);
      c.lineWidth = Math.max(1, W * 0.0012);
      c.stroke();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = s.id === 'krem' ? '#FFF9EC' : '#11221A';
      c.font = `700 ${fm}px ${SANS}`;
      razmaknuto(c, MJESECI_KRATKO[mj - 1].toUpperCase(), xd + W * 0.003 * k, topL + bh / 2, W * 0.006 * k);
      c.textBaseline = 'alphabetic';
      c.fillStyle = s.ink;
      c.font = `700 ${fd * .86}px ${DISPLAY}`;
      const mb = c.measureText(String(d));
      c.fillText(String(d), xd, topL + bh + (hB - bh) / 2 + (mb.actualBoundingBoxAscent - mb.actualBoundingBoxDescent) / 2);
      c.textAlign = 'left';

      // grad, pa van BiH zastava (i država, ako stane) u istom redu, ispod dan,
      // sat i mjesto — zbijeno, u sredini visine lista
      const xt = x + dw + U * 2.8 * k, wt = x + kolW - xt;
      const vrhB = yc - visTeksta(o) / 2;
      const bazaG = vrhB + capG, y1 = vrhB + capG / 2;
      const zImg = zastave[p.drzava];
      const zh = fm * 1.3, zwd = zh * 1.5, zRaz = U * 1.3 * k;
      const wg = wt - (zImg ? zRaz + zwd : 0);     // zastavi se uvijek ostavi mjesta
      let fgg = fg;
      c.font = `700 ${fgg}px ${SANS}`;
      const grad = verzal(p.grad || p.mjesto || '—');
      while (c.measureText(grad).width > wg && fgg > fg * .75) { fgg *= .95; c.font = `700 ${fgg}px ${SANS}`; }
      const tg = skrati(c, grad, wg);
      c.fillStyle = s.ink;
      c.fillText(tg, xt, bazaG);
      if (zImg) {
        let xz = xt + c.measureText(tg).width + zRaz;
        c.font = `700 ${fm}px ${SANS}`;
        const ime = imeZemlje(p.drzava).toUpperCase();   // zastava je samo van BiH
        c.save();
        c.beginPath();
        c.roundRect ? c.roundRect(xz, y1 - zh / 2, zwd, zh, zh * .18) : c.rect(xz, y1 - zh / 2, zwd, zh);
        c.clip();
        c.drawImage(zImg, xz, y1 - zh / 2, zwd, zh);
        c.restore();
        xz += zwd + U * .8 * k;
        if (ime && xz + c.measureText(ime).width + ime.length * W * 0.005 * k <= x + kolW) {
          c.fillStyle = blijedo(s, .78);
          razmaknuto(c, ime, xz, y1 + c.measureText('H').actualBoundingBoxAscent / 2, W * 0.005 * k);
        }
      }
      c.fillStyle = blijedo(s, .72);
      c.font = `500 ${fmj}px ${SANS}`;
      const bazaDno = vrhB + visTeksta(o);
      o.forEach((r, j) => c.fillText(r, xt, bazaDno - fmj * 1.3 * (o.length - 1 - j)));
    });
    if (red.length) linija(x, y + red.length * rh, x + kolW, y + red.length * rh, .22);
  }

  crtajLinkove(c, mreze, lk, { x0, sirina, dno, fl: F.link, U, W, s });
}

/** Raspored kao slika, isto kao plakatBlob. */
export async function rasporedBlob(lista, o = {}) {
  const cv = document.createElement('canvas');
  await nacrtajRaspored(cv, lista, { mjerilo: IZVOZ_MJERILO(o.format), ...o });
  return new Promise(res => cv.toBlob(res, o.tip || 'image/png', o.kvalitet));
}

/** Plakat kao slika — PNG, a A3 kao JPEG visokog kvaliteta (PNG te veličine bio bi desetine MB). */
export async function plakatBlob(p, o = {}) {
  const cv = document.createElement('canvas');
  await nacrtajPlakat(cv, p, { mjerilo: IZVOZ_MJERILO(o.format), ...o });
  return new Promise(res => cv.toBlob(res, o.tip || (o.format === 'a3' ? 'image/jpeg' : 'image/png'), o.kvalitet ?? .95));
}

export const imePlakata = (p, format = 'objava') =>
  `predavanje-${p.datum || 'novo'}-${(p.grad || 'plakat').toLowerCase().replace(/[^a-z0-9šđčćž]+/g, '-')}-${format}.${format.startsWith('a3') ? 'jpg' : 'png'}`;

/* ============================================================
   PORUKA — hafizova poruka van knjiga, za objavu i story
   ------------------------------------------------------------
   Ista ruka i ista mreža kao plakat: gore logo, u pozadini desno
   utopljeni hafiz, a dolje, gdje plakat ima naslov, poruka u navodnicima,
   u izgledu iz dizajnera, pa sajt i mreže uz donji rub.
   ============================================================ */

/* --- izgled teksta: font, debljina, veličina, prored, razmak slova,
   poravnanje. Bira se u dizajneru i čuva uz poruku (`izgled`); poruka bez
   njega ima zadani izgled. Italic, bold, podvučeno i zlatno su oznake na
   riječima, ne izgled cijelog teksta. --- */

/** Fontovi koje dizajner nudi — svi imaju naša slova (čćšđž) i italic. */
export const FONTOVI_PORUKE = [
  { id: 'cormorant',  naziv: 'Cormorant',  porodica: '"Cormorant Garamond"', tezine: [300, 400, 500, 600, 700] },
  { id: 'garamond',   naziv: 'Garamond',   porodica: '"EB Garamond"',        tezine: [400, 500, 600, 700, 800] },
  { id: 'playfair',   naziv: 'Playfair',   porodica: '"Playfair Display"',   tezine: [400, 500, 600, 700, 800, 900] },
  { id: 'lora',       naziv: 'Lora',       porodica: '"Lora"',               tezine: [400, 500, 600, 700] },
  { id: 'montserrat', naziv: 'Montserrat', porodica: '"Montserrat"',         tezine: [100, 200, 300, 400, 500, 600, 700] },
  { id: 'plex',       naziv: 'Plex Sans',  porodica: '"IBM Plex Sans"',      tezine: [100, 200, 300, 400, 500, 600, 700] },
];

/** Zadani izgled. `slova` je veličina slova kao udio najveće pri kojoj cijela
    poruka stane (1 = „Max“); null je „Auto“ — uobičajena veličina, a duža
    poruka manja koliko treba. `prored` je visina reda u slovima, `razmak`
    razmak među slovima u slovima. */
export const IZGLED_TEKSTA = Object.freeze({
  font: 'cormorant', tezina: 300, slova: null, prored: 1.3, razmak: 0, poravnanje: 'lijevo',
});

const uGranicama = (x, a, b, d) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : d);
const najbliza = (lista, w) => lista.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));

/** Izgled s poznatim ključevima i vrijednostima u granicama; ono što ne valja je zadano. */
export function urediIzgled(t) {
  const d = IZGLED_TEKSTA, f = FONTOVI_PORUKE.find(x => x.id === t?.font) || FONTOVI_PORUKE[0];
  return {
    font: f.id,
    tezina: najbliza(f.tezine, uGranicama(t?.tezina, 100, 900, d.tezina)),
    slova: uGranicama(t?.slova, .2, 1, d.slova),
    prored: uGranicama(t?.prored, 1, 2, d.prored),
    razmak: uGranicama(t?.razmak, -.05, .2, d.razmak),
    poravnanje: ['centar', 'obostrano'].includes(t?.poravnanje) ? t.poravnanje : 'lijevo',
  };
}

/* --- oznake u tekstu: **bold**, *italic*, __podvučeno__, ==zlatno==, a
   \* \_ \= \\ su sami znakovi. Uređivač u adminu ih piše sam; korisnik ih
   ne kuca. --- */

/** Tekst bez oznaka — za listu, ime fajla i sl. */
export const bezOznaka = t => (t || '').replace(/\\(.)|\*\*|__|==|\*/g, (m, e) => e ?? '');

const istaOznaka = (a, b) => a.b === b.b && a.i === b.i && a.u === b.u && a.z === b.z;

/** Redovi teksta: svaki je niz riječi, riječ je niz komada iste oznake
    ({ t, b, i, u, z }); prazan red je null. Oznake se ne prenose u sljedeći red. */
export function rastaviOznake(tekst) {
  return (tekst || '').split('\n').map(red => {
    const rijeci = [], o = { b: false, i: false, u: false, z: false };
    let rijec = null;
    const dodaj = ch => {
      if (/\s/.test(ch)) { rijec = null; return; }
      if (!rijec) rijeci.push(rijec = []);
      const k = rijec.at(-1);
      if (k && istaOznaka(k, o)) k.t += ch;
      else rijec.push({ t: ch, ...o });
    };
    for (let j = 0; j < red.length; j++) {
      if (red[j] === '\\' && j + 1 < red.length) { dodaj(red[++j]); continue; }
      if (red.startsWith('**', j)) { o.b = !o.b; j++; continue; }
      if (red.startsWith('__', j)) { o.u = !o.u; j++; continue; }
      if (red.startsWith('==', j)) { o.z = !o.z; j++; continue; }
      if (red[j] === '*') { o.i = !o.i; continue; }
      dodaj(red[j]);
    }
    return rijeci.length ? rijeci : null;
  });
}

// Safari do skoro nije znao razmak slova na platnu — tad se slova slažu ručno
const RAZMAK_NA_PLATNU = typeof CanvasRenderingContext2D !== 'undefined'
  && 'letterSpacing' in CanvasRenderingContext2D.prototype;

/** Pismo za veličinu fs: postavlja font komada (`b` bold, `i` italic),
    mjeri ga i piše, s razmakom slova iz izgleda. Podvučeno crta crtaPodvuceno. */
function pismo(c, iz, fs) {
  const f = FONTOVI_PORUKE.find(x => x.id === iz.font);
  const debelo = najbliza(f.tezine, Math.min(f.tezine.at(-1), iz.tezina + 300));
  const ls = iz.razmak * fs;
  const postavi = k => {
    c.font = `${k.i ? 'italic ' : ''}${k.b ? debelo : iz.tezina} ${fs}px ${f.porodica}, ${SERIF}`;
    if (RAZMAK_NA_PLATNU) c.letterSpacing = `${ls}px`;
  };
  const sirina = (t, k) => { postavi(k); return c.measureText(t).width + (RAZMAK_NA_PLATNU ? 0 : ls * [...t].length); };
  const pisi = (t, x, y, k) => {
    postavi(k);
    if (RAZMAK_NA_PLATNU || !ls) { c.fillText(t, x, y); return; }
    let prije = '';
    [...t].forEach((ch, j) => { c.fillText(ch, x + c.measureText(prije).width + j * ls, y); prije += ch; });
  };
  return { sirina, pisi, sp: sirina(' ', {}) };
}

/**
 * Pasusi složeni u redove. Pasus se lomi tako da redovi budu što
 * ujednačenije dužine (cijena raste s kvadratom praznog dijela reda, kao
 * udio širine — isto i za krupna slova), a jedna riječ sama u redu se
 * izbjegava kad može; zadnji red smije biti kraći. Prazan red iz teksta je prazan red i na slici (`null`), koliko
 * ih god ima — osim na početku i kraju; `siroko` znači da je neka riječ
 * šira od reda. Između pasusa nema dodatnog razmaka.
 * @returns {{redovi: Array<{rijeci: Array<{komadi: object[], w: number}>, w: number}|null>, siroko: boolean}}
 */
function slogPoruke(pasusi, maxW, p, obostrano = false) {
  const sp = p.sp, redovi = [];
  let siroko = false;
  for (const komadi of pasusi) {
    if (!komadi) {
      if (redovi.length) redovi.push(null);
      continue;
    }
    const rijeci = komadi.map(k => ({ komadi: k, w: k.reduce((a, x) => a + p.sirina(x.t, x), 0) }));
    const n = rijeci.length, sir = rijeci.map(r => r.w);
    if (sir.some(x => x > maxW)) siroko = true;
    // cijena[i]: najjeftiniji slog prvih i riječi; od[i]: riječ kojom počinje njegov zadnji red
    const cijena = [0], od = [0];
    for (let i = 1; i <= n; i++) {
      cijena[i] = Infinity;
      for (let j = i - 1, w = -sp; j >= 0; j--) {
        w += sir[j] + sp;
        if (w > maxW && j < i - 1) break;
        const g = i - 1 - j, prazno = Math.max(0, maxW - w) / maxW;
        const sama = g || n === 1 ? 0 : 40;                    // jedna riječ sama u redu je ružna
        /* obostrano: red se rasteže, pa se mjeri koliko bi razmaci narasli
           (kao u TeX-u), a jedna riječ u raširenom redu se ne može rastegnuti */
        const k = i === n ? (obostrano ? sama : 30 * prazno ** 2 + sama)   // zadnji red smije biti kraći
          : obostrano ? 1 + 100 * (Math.max(0, maxW - w) / (Math.max(g, 1) * sp)) ** 3 + sama
          : 1 + 100 * prazno ** 2 + sama;
        if (cijena[j] + k < cijena[i]) { cijena[i] = cijena[j] + k; od[i] = j; }
      }
    }
    const pasus = [];
    for (let i = n; i > 0; i = od[i]) {
      const dio = rijeci.slice(od[i], i);
      pasus.unshift({ rijeci: dio, w: dio.reduce((a, r) => a + r.w, 0) + sp * (dio.length - 1) });
    }
    pasus.at(-1).kraj = true;                    // zadnji red pasusa se ne rasteže (obostrano)
    redovi.push(...pasus);
  }
  while (redovi.at(-1) === null) redovi.pop();
  return { redovi, siroko };
}

/**
 * Crta poruku u zadano platno.
 *   gore      logo, na mjestu natpisa s plakata
 *   pozadina  hafiz desno, utopljen
 *   dolje     “poruka”, u izgledu iz dizajnera (`p.izgled`)
 *             ─────────────────────────────
 *             sajt · Facebook · Instagram
 * Poruka je krupna koliko izgled kaže; duža se smanjuje dok blok ne stane ispod zaglavlja.
 *
 * @param {HTMLCanvasElement} cv
 * @param {{tekst: string, izgled?: object}} p  tekst s oznakama (**, *, ==)
 * @param {{format?: string, stil?: string, mjerilo?: number, zamjena?: string}} o
 *        `zamjena` se crta blijedo dok poruke nema
 * @returns {Promise<{stalo: boolean, udio: number}>} `stalo` je `false` kad poruka ne stane ni
 *          najsitnija; `udio` je veličina slova kao udio najveće koja stane (za klizač kod „Auto“)
 */
export async function nacrtajPoruku(cv, p, {
  format = 'objava', stil = 'zelena', mjerilo = 1, zamjena = '',
} = {}) {
  const f = PLAKAT_FORMATI.find(x => x.id === format) || PLAKAT_FORMATI[1];
  const s = stilPlakata(stil);
  const iz = urediIzgled(p.izgled);

  const W = Math.round(f.w * mjerilo), H = Math.round(f.h * mjerilo), odnos = H / W;
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');

  /* font poruke u sva četiri lika (obično, debelo, kurziv, oboje) mora biti
     tu prije mjerenja — sa slovima iz poruke, jer Google font dijeli slova
     u dijelove (naša slova su u „latin-ext“, koji se inače ne učita) */
  const probno = pismo(c, iz, 40);
  const likovi = [{}, { b: true }, { i: true }, { b: true, i: true }].map(k => { probno.sirina('a', k); return c.font; });
  const slova = `${[...new Set(bezOznaka(`${p.tekst || ''}${zamjena}`))].join('')}čćšđžČĆŠĐŽ`;
  await Promise.all([
    ...FONTOVI.map(x => document.fonts?.load(x).catch(() => {})),
    ...likovi.map(x => document.fonts?.load(x, slova).catch(() => {})),
  ]);
  const [znak, foto, mreze] = await Promise.all([
    ucitajSliku(`/assets/brand/ammar_basic_logo_${s.logo}_1.png`).catch(() => null),
    ucitajSliku('/assets/brand/author.jpg').catch(() => null),
    ucitajMreze(),
  ]);

  const rast = odnos / 1.25, tip = 1 + (rast - 1) * .35;
  const U = W * 0.012 * rast * (odnos < 1.5 ? .8 : 1);
  const F = Object.fromEntries(Object.entries({
    nad: 0.023, poruka: 0.064, link: 0.0215,
  }).map(([k, v]) => [k, W * v * tip]));

  if (RAZMAK_NA_PLATNU) c.letterSpacing = '0px';
  podloga(c, W, H, s);
  if (foto) fotoNaPlatno(c, W, H, foto, FOTO[s.id] ?? FOTO.zelena);

  const m2 = W * 0.078, x0 = m2 + W * 0.025, sirina = W - x0 - (m2 + W * 0.045);
  c.textAlign = 'left';
  c.textBaseline = 'middle';

  const z = zaglavlje(W, m2, U, F, tip, false);
  const dno = H - m2 - U * 3;
  const lk = mjereLinkova(c, mreze, F.link, U, sirina);

  const prava = bezOznaka(p.tekst).trim();
  const pasusi = rastaviOznake(prava ? p.tekst : zamjena);

  /* --- navodnici kao na kartici poruke dana (i slici za dijeljenje u
     aplikaciji, app.js): veliki, providni, vise izvan teksta — “ lijevo od
     prvog reda, ” desno od zadnjeg. Vežu se za okvir bloka teksta, pa ne
     mogu naletjeti na tekst; tekst je zato uži za njihovu širinu sa svake
     strane. Na krupnim slovima („Max“) ne rastu dalje od krupne poruke. --- */
  c.save();
  c.font = `700 100px ${DISPLAY}`;
  c.textBaseline = 'top';
  const [q0, q1] = ['“', '”'].map(z => c.measureText(z));
  c.restore();
  const navodnici = (fs, visTeksta) => {
    const fq = Math.min(fs, F.poruka * 1.25), Fq = fq * 2.4, k = Fq / 100, lh = fs * iz.prored;
    const yO = lh / 2 - fq * .38 - Fq * .25;                     // vrh “ od vrha teksta (kao u app.js)
    const yZ = visTeksta - lh / 2 + fq * .48 - Fq * .25;         // vrh ” od vrha teksta
    return {
      fq, Fq, yO, yZ,
      bok: fq * .24 + Math.max(q0.width, q1.width) * k,           // koliko navodnik zauzme sa strane
      iznad: Math.max(0, -(yO - q0.actualBoundingBoxAscent * k)),
      ispod: Math.max(0, yZ + q1.actualBoundingBoxDescent * k - visTeksta),
    };
  };
  const bok = fs => navodnici(fs, 0).bok;
  const sirinaTeksta = fs => sirina - 2 * bok(fs);

  /* --- poruka: krupno koliko izgled kaže, ali cijeli blok uvijek stane
     između zaglavlja i dna — dužina nije ograničena. Veličina se traži
     raspolovljavanjem, a svaki pokušaj složi redove istim slogom kojim se
     poslije crta (slogPoruke), pa blok stane tačno. Riječ šira od reda
     (npr. link) smanjuje slova dok ne stane. --- */
  // svaki red, i prazan, visok je jedan red
  const visTeksta = fs => {
    c.save();
    const { redovi, siroko } = slogPoruke(pasusi, sirinaTeksta(fs), pismo(c, iz, fs), iz.poravnanje === 'obostrano');
    c.restore();
    return siroko ? Infinity : redovi.length * fs * iz.prored;
  };
  const visBlokaZa = fs => {
    const vt = visTeksta(fs);
    if (!Number.isFinite(vt)) return Infinity;
    const q = navodnici(fs, vt);
    return q.iznad + vt + q.ispod + U * 4 + lk.vis;
  };
  const prostor = dno - z.dno - U * 4, najmanje = W * 0.006;
  /* najveća slova pri kojima cijela poruka stane („Max“), raspolavljanjem;
     izgled bira udio toga, a „Auto“ uobičajenu veličinu ako stane */
  const staje = k => visBlokaZa(k) <= prostor;
  let fsMax = najmanje, stalo = true;
  if (!staje(najmanje)) stalo = false;
  else {
    let manje = najmanje, vece = F.poruka * 10;
    if (staje(vece)) manje = vece;
    else for (let i = 0; i < 20; i++) { const k = (manje + vece) / 2; if (staje(k)) manje = k; else vece = k; }
    fsMax = manje;
  }
  const fs = iz.slova == null ? Math.min(F.poruka, fsMax) : fsMax * iz.slova;
  const visBloka = visBlokaZa(fs), lh = fs * iz.prored;

  /* --- crtanje, odozgo nadolje od vrha bloka --- */
  const vrhBloka = dno - visBloka;
  await ispodSloga(c, W, H, s, vrhBloka, { foto });
  crtajZaglavlje(c, z, x0, W, F, s, znak, '');

  c.save();
  if (!prava) c.globalAlpha = .38;
  const pi = pismo(c, iz, fs);
  const sirT = sirinaTeksta(fs);
  const { redovi } = slogPoruke(pasusi, sirT, pi, iz.poravnanje === 'obostrano');
  const vt = redovi.length * lh, q = navodnici(fs, vt);
  const centar = iz.poravnanje === 'centar', obostrano = iz.poravnanje === 'obostrano';
  const vrhTeksta = vrhBloka + q.iznad, xT = x0 + q.bok;           // lijevi rub teksta

  // obostrano: višak širine ide u razmake, osim u zadnjem redu pasusa i u redu s jednom riječi
  const rasiri = r => obostrano && !r.kraj && r.rijeci.length > 1;
  const pocetak = r => (centar ? x0 + (sirina - r.w) / 2 : xT);

  // navodnici prate rečenicu: “ ispred prve riječi, ” odmah iza zadnje
  const sRedovi = redovi.filter(Boolean), prviR = sRedovi[0], zadnjiR = sRedovi.at(-1);
  const xL = prviR ? pocetak(prviR) : xT;
  const xD = zadnjiR ? pocetak(zadnjiR) + (rasiri(zadnjiR) ? sirT : zadnjiR.w) : xT;
  c.save();
  c.textBaseline = 'top';
  c.font = `700 ${q.Fq}px ${DISPLAY}`;
  c.fillStyle = saAlfom(s.navod, .32);
  c.textAlign = 'right';
  c.fillText('“', xL - q.fq * .24, vrhTeksta + q.yO);
  c.textAlign = 'left';
  c.fillText('”', xD + q.fq * .24, vrhTeksta + q.yZ);
  c.restore();

  // podvučeno: crta ispod osnovne linije, debljine po slovu
  pi.sirina('H', {});                            // postavi font poruke
  const ispodLinije = c.measureText('H').actualBoundingBoxDescent + fs * .1, debljinaCrte = Math.max(1, fs * .045);
  let y = vrhTeksta;
  for (const r of redovi) {
    if (r === null) { y += lh; continue; }
    const yR = y + lh / 2;
    const siri = rasiri(r);
    const razmak = siri ? pi.sp + (sirT - r.w) / (r.rijeci.length - 1) : pi.sp;
    let x = pocetak(r);
    const crte = [];                             // podvučeni dijelovi reda: { x, w, boja }
    const pisi = (t, k, w) => {
      c.fillStyle = k.z ? s.gold : s.ink;
      pi.pisi(t, x, yR, k);
      if (k.u) crte.push({ x, w: w - (RAZMAK_NA_PLATNU ? iz.razmak * fs : 0), boja: c.fillStyle });
      x += w;
    };
    /* Uzastopne riječi iste oznake pišu se kao jedan niz — prirodni razmaci,
       a arapske riječi zadrže redoslijed. Riječ s više oznaka (i svaka riječ
       u raširenom redu) ide komad po komad. */
    let niz = [], k0 = null, w0 = 0;
    const isprazni = () => {
      if (!niz.length) return;
      pisi(niz.join(' '), k0, w0);
      x += razmak;
      niz = []; w0 = 0;
    };
    for (const rijec of r.rijeci) {
      const k = rijec.komadi[0];
      if (rijec.komadi.length === 1 && !siri) {
        if (niz.length && !istaOznaka(k, k0)) isprazni();
        if (niz.length) w0 += pi.sp;
        niz.push(k.t); k0 = k; w0 += rijec.w;
        continue;
      }
      isprazni();
      for (const d of rijec.komadi) pisi(d.t, d, pi.sirina(d.t, d));
      x += razmak;
    }
    isprazni();
    // podvučene riječi jedna do druge dijele crtu — i ispod razmaka među njima
    let crta = null;
    const povuci = () => { if (crta) { c.fillStyle = crta.boja; c.fillRect(crta.x, yR + ispodLinije, crta.w, debljinaCrte); } };
    for (const d of crte) {
      if (crta && crta.boja === d.boja && d.x - (crta.x + crta.w) <= razmak * 1.5) crta.w = d.x + d.w - crta.x;
      else { povuci(); crta = { ...d }; }
    }
    povuci();
    y += lh;
  }
  c.restore();

  crtajLinkove(c, mreze, lk, { x0, sirina, dno, fl: F.link, U, W, s });
  return { stalo, udio: Math.min(1, fs / fsMax) };
}

/** Poruka kao slika — PNG u duploj veličini, kao plakat. */
export async function porukaBlob(p, o = {}) {
  const cv = document.createElement('canvas');
  await nacrtajPoruku(cv, p, { mjerilo: IZVOZ_MJERILO(o.format), ...o });
  return new Promise(res => cv.toBlob(res, 'image/png'));
}

/** poruka-ko-se-allaha-boji-objava-zelena.png — bez kvačica, za svaki sistem. */
export function imePoruke(p, format = 'objava', stil = 'zelena') {
  const pocetak = bezOznaka(p.tekst).trim().split(/\s+/).slice(0, 4).join(' ').toLowerCase()
    .replace(/đ/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').slice(0, 32).replace(/^-|-$/g, '');
  const naziv = (PLAKAT_FORMATI.find(x => x.id === format)?.naziv || format).toLowerCase();
  return `${['poruka', pocetak, naziv, stil].filter(Boolean).join('-')}.png`;
}
