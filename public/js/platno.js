/* ============================================================
   PLATNO — zajednički alati za slike koje se crtaju na canvasu
   ------------------------------------------------------------
   Slika za dijeljenje (js/app.js) i plakat predavanja (js/plakat.js)
   crtaju se istom rukom: ista podloga, iste mrlje, ista tekstura, isti
   okvir. Zato sve to živi ovdje, a ne dvaput.
   ============================================================ */

const SERIF = '"EB Garamond", Georgia, serif';
const DISPLAY = '"Playfair Display", Georgia, serif';
const SANS  = '"IBM Plex Sans", system-ui, sans-serif';

/* `uzorak` je jačina teksture na podlozi slike za dijeljenje. Na zelenoj je
   niža: svijetao motiv na tamnoj podlozi ima veći kontrast pa iskače jače
   nego zlato na papiru — ista brojka tu ne daje isti utisak. Vrijednosti su
   složene po izgledu, ne po računu.
   `korica` je jačina korice knjige u pozadini — ista kao na kartici u
   tamnoj odnosno svijetloj temi (`--korica-op` × 1,3 iz `.karta > .korica`). */
const STILOVI = [
  { id: 'zelena', naziv: 'Zelena', bg: ['#204234', '#0D1C15'], ink: '#F6EFDF', gold: '#E3C489', navod: '#E9C77E', logo: 'w', uzorak: .038, korica: .338 },
  { id: 'krem',   naziv: 'Krem',   bg: ['#F7F1E2', '#E6D9BC'], ink: '#162C21', gold: '#8E6C28', navod: '#A8813A', logo: 'b', uzorak: .09,  korica: .286 },
];

const slikeCache = new Map();
function ucitajSliku(src) {
  if (!slikeCache.has(src)) {
    slikeCache.set(src, new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(src));
      i.src = src;
    }));
  }
  return slikeCache.get(src);
}

/** Lomi tekst na redove koji staju u zadanu širinu. */
function lomiTekst(c, tekst, maxW) {
  const redovi = [];
  let red = '';
  for (const rijec of tekst.split(/\s+/)) {
    const test = red ? `${red} ${rijec}` : rijec;
    if (c.measureText(test).width > maxW && red) { redovi.push(red); red = rijec; }
    else red = test;
  }
  if (red) redovi.push(red);
  return redovi;
}

/* --- ornamenti na platnu --- */

/* Odnos stranica iz viewBoxa texture.svg — pločica ga mora poštovati, inače
   se motiv razvuče i šavovi između pločica postanu vidljivi. */
const UZORAK_ODNOS = 12649.62 / 11492.45;

/**
 * Maska za teksturu, složena u zasebnom platnu. Tri mrlje se sabiraju
 * (`lighter`) pa se preko njih spusti opšti pad prema dnu: uzorak se negdje
 * nakupi, negdje skoro nestane. Isti dah kao na kartici — nigdje oštrog ruba
 * i nigdje ravnog polja.
 */
function uzorakMaska(W, H) {
  const mk = document.createElement('canvas');
  mk.width = W; mk.height = H;
  const mc = mk.getContext('2d');
  mc.globalCompositeOperation = 'lighter';

  const domet = Math.max(W, H);
  const mrlja = (cx, cy, r, jacina) => {
    const g = mc.createRadialGradient(W * cx, H * cy, 0, W * cx, H * cy, domet * r);
    g.addColorStop(0,   `rgba(255,255,255,${jacina})`);
    g.addColorStop(.55, `rgba(255,255,255,${jacina * .4})`);
    g.addColorStop(1,   'rgba(255,255,255,0)');
    mc.fillStyle = g;
    mc.fillRect(0, 0, W, H);
  };

  mrlja(.16, .05, .54, .8);
  mrlja(.93, .24, .40, .5);
  mrlja(.26, .58, .38, .26);

  /* podnožje ostaje mirno — ispod citata nosi tekst, ne ornament */
  const pad = mc.createLinearGradient(0, 0, 0, H);
  pad.addColorStop(0,   'rgba(255,255,255,.5)');
  pad.addColorStop(.5,  'rgba(255,255,255,.2)');
  pad.addColorStop(.85, 'rgba(255,255,255,.04)');
  pad.addColorStop(1,   'rgba(255,255,255,0)');
  mc.fillStyle = pad;
  mc.fillRect(0, 0, W, H);

  return mk;
}

/**
 * Ista tekstura koja stoji iza aplikacije i na kartici, položena preko cijele
 * slike za dijeljenje — krupno, tiho i neravnomjerno, da se osjeti materijal
 * a ne da se čita kao šara.
 *
 * Vraća `false` ako slika ne prođe — slika za dijeljenje se svejedno crta,
 * samo bez teksture.
 *
 * `tamnije` (0–1) zatamni zlato prije crtanja — na krem papiru svijetlo zlato
 * se gubi, kao što ga i kartica tamo spušta s `--zlato-filter`. Platnov
 * `filter` Safari ne zna, pa se zatamni ručno, preko same pločice.
 * `maska` (platno W×H) bira gdje se uzorak vidi; bez nje ide ona s kartice.
 * `sirina` je pločica u širinama platna — manja daje sitniji, gušći motiv.
 */
async function uzorakNaPlatno(c, W, H, jacina, { tamnije = 0, maska = null, sirina = 2.3 } = {}) {
  let img;
  try { img = await ucitajSliku('/assets/texture/texture.svg'); } catch { return false; }

  /* Pločica je šira od same slike, pa se motiv preko nje i ne ponovi cijeli —
     vidi se jedan krupan isječak, isto kao na kartici u aplikaciji. Odnos je
     preuzet odatle: `background-size: 780px` preko kartice široke ~339px je
     2,3 širine, pa isto toliko ide i ovdje. Sitnija pločica je davala gust,
     nervozan uzorak koji se uz karticu vidio kao drugi motiv. */
  const ploca = Math.round(W * sirina);
  const plocaH = Math.round(ploca * UZORAK_ODNOS);

  const pl = document.createElement('canvas');
  pl.width = ploca; pl.height = plocaH;
  const pc = pl.getContext('2d');
  pc.drawImage(img, 0, 0, ploca, plocaH);
  if (tamnije) {
    pc.globalCompositeOperation = 'source-atop';
    pc.fillStyle = `rgba(0,0,0,${tamnije})`;
    pc.fillRect(0, 0, ploca, plocaH);
  }

  const sloj = document.createElement('canvas');
  sloj.width = W; sloj.height = H;
  const sc = sloj.getContext('2d');
  const pat = sc.createPattern(pl, 'repeat');
  if (!pat) return false;
  sc.fillStyle = pat;
  sc.fillRect(0, 0, W, H);

  sc.globalCompositeOperation = 'destination-in';
  sc.drawImage(maska || uzorakMaska(W, H), 0, 0);

  c.save();
  c.globalAlpha = jacina;
  c.drawImage(sloj, 0, 0);
  c.restore();
  return true;
}

/* --- boje i prelivi za platno --- */

/** `#RRGGBB` + alfa (0–1) → `#RRGGBBAA`. */
const saAlfom = (hex, a) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

/* Ista boja, alfa nula. Canvas `'transparent'` je PROZIRNA CRNA, pa preliv
   koji na njoj završava usput posivi — zlatna mrlja dobije prljav rub. */
const prozirno = hex => `${hex.slice(0, 7)}00`;

/** Linearna mješavina dvije `#RRGGBB` boje. */
function mijesaj(a, b, t) {
  const raz = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = raz(a), [r2, g2, b2] = raz(b);
  const k = v => Math.round(v).toString(16).padStart(2, '0');
  return `#${k(r1 + (r2 - r1) * t)}${k(g1 + (g2 - g1) * t)}${k(b1 + (b2 - b1) * t)}`;
}

/** Preliv zadan CSS uglom (0deg = prema gore, 90deg = udesno), kao u `.karta`. */
function kosiPreliv(c, W, H, deg, stanice) {
  const rad = deg * Math.PI / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const duz = Math.abs(W * dx) + Math.abs(H * dy);
  const g = c.createLinearGradient(
    W / 2 - dx * duz / 2, H / 2 - dy * duz / 2,
    W / 2 + dx * duz / 2, H / 2 + dy * duz / 2);
  for (const [p, boja] of stanice) g.addColorStop(p, boja);
  return g;
}

/* CSS `radial-gradient` crta elipsu, canvas zna samo krug — pa se krug razvuče
   po visini. Bez toga bi mrlje bile okrugle i uzorak sjaja ne bi odgovarao
   kartici, koja je sve svoje zadala kao elipse. */
function eliptSjaj(c, W, H, { x, y, rx, ry, boja, kraj = 1 }) {
  const k = ry / rx;
  c.save();
  c.translate(x, y);
  c.scale(1, k);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, boja);
  g.addColorStop(kraj, prozirno(boja));
  if (kraj < 1) g.addColorStop(1, prozirno(boja));
  c.fillStyle = g;
  c.fillRect(-W * 3, -H * 3 / k, W * 6, H * 6 / k);
  c.restore();
}

/* Zlatne mrlje kartice, prepisane iz `.karta` i `.karta__aura`. Udjeli su
   isti kao u CSS-u, samo se množe sa W/H. Raspored je namjerno asimetričan —
   vrh, donji desni ugao, gornji lijevi, pa tiha sredina — i baš to čini da
   podloga diše umjesto da leži ravno. */
const MRLJE = [
  { x: .50,  y: -.10, rx: 1.20, ry: .68, a: .17, kraj: .62 },   // karta: vrh
  { x: 1.05, y: 1.00, rx:  .95, ry: .55, a: .12, kraj: .60 },   // karta: donji desni
  { x: .16,  y:  .06, rx:  .58, ry: .42, a: .26, kraj: .70 },   // aura: gornji lijevi
  { x: .88,  y:  .94, rx:  .54, ry: .40, a: .20, kraj: .72 },   // aura: donji desni
  { x: .50,  y:  .50, rx:  .70, ry: .50, a: .08, kraj: .75 },   // aura: sredina
];

/**
 * Korica knjige u pozadini, prepisana iz `.korica` i `.karta > .korica`:
 * 64% širine, 2:3, gore desno (top 4%, right -12%), nagnuta 9°, zamućena,
 * utopljena maskom i položena kao `luminosity` — uzme boju podloge, ostane
 * samo njen crtež i svjetlo. Pikseli iz CSS-a (blur, zaobljenje) važe za
 * karticu široku ~339px, pa se skaliraju na širinu slike.
 */
function koricaNaPlatno(c, W, H, img, jacina) {
  const mj = W / 339;
  const cw = Math.round(W * 0.64), ch = Math.round(cw * 1.5);

  const kp = document.createElement('canvas');
  kp.width = cw; kp.height = ch;
  const kc = kp.getContext('2d');

  // background: center / cover, uz border-radius 6px
  kc.save();
  if (kc.roundRect) { kc.beginPath(); kc.roundRect(0, 0, cw, ch, 6 * mj); kc.clip(); }
  const sk = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
  const iw = img.naturalWidth * sk, ih = img.naturalHeight * sk;
  kc.filter = `blur(${1.3 * mj}px)`;
  kc.drawImage(img, (cw - iw) / 2, (ch - ih) / 2, iw, ih);
  kc.restore();

  // mask: radial-gradient(95% 80% at 70% 26%, #000 0%, rgba(0,0,0,.75) 48%, transparent 88%)
  const rx = cw * 0.95, ry = ch * 0.80;
  kc.globalCompositeOperation = 'destination-in';
  kc.translate(cw * 0.70, ch * 0.26);
  kc.scale(1, ry / rx);
  const g = kc.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0,   'rgba(0,0,0,1)');
  g.addColorStop(.48, 'rgba(0,0,0,.75)');
  g.addColorStop(.88, 'rgba(0,0,0,0)');
  g.addColorStop(1,   'rgba(0,0,0,0)');
  kc.fillStyle = g;
  kc.fillRect(-cw * 2, -ch * 2 * rx / ry, cw * 4, ch * 4 * rx / ry);

  c.save();
  c.globalAlpha = jacina;
  c.globalCompositeOperation = 'luminosity';
  c.translate(W * 1.12 - cw / 2, H * 0.04 + ch / 2);
  c.rotate(9 * Math.PI / 180);
  c.drawImage(kp, -cw / 2, -ch / 2);
  c.restore();
}

/** Arabeskni ugao sa zaobljenim prelazom. */
function ugaoOrnament(c, x, y, sx, sy, u) {
  c.beginPath();
  c.moveTo(x + sx * u, y);
  c.lineTo(x + sx * u * 0.4, y);
  c.quadraticCurveTo(x, y, x, y + sy * u * 0.4);
  c.lineTo(x, y + sy * u);
  c.stroke();
}

/* --- slojevi koje dijele slika za dijeljenje i plakat --- */

/* Podloga: isti recept kao kartica u aplikaciji. Ranije je ovdje bio jedan
   preliv i jedna mrlja u sredini, pa je slika pored kartice djelovala ravno.
   Kartica ima kosi preliv i pet zlatnih mrlja (vidi MRLJE) — sve je preuzeto
   odatle, da su to dvije slike iste ruke. */
function podloga(c, W, H, s) {
  c.fillStyle = kosiPreliv(c, W, H, 165, [
    [0,   mijesaj(s.bg[0], s.gold, .08)],
    [.38, s.bg[0]],
    [1,   s.bg[1]],
  ]);
  c.fillRect(0, 0, W, H);

  for (const m of MRLJE) {
    eliptSjaj(c, W, H, {
      x: m.x * W, y: m.y * H, rx: m.rx * W, ry: m.ry * H,
      boja: saAlfom(s.gold, m.a), kraj: m.kraj,
    });
  }

  // tiha sjena pri dnu — dubina, kao `--surface-2` na dnu kartice
  const dubina = c.createLinearGradient(0, H * 0.62, 0, H);
  dubina.addColorStop(0, prozirno(s.bg[1]));
  dubina.addColorStop(1, `${s.bg[1]}66`);
  c.fillStyle = dubina;
  c.fillRect(0, H * 0.62, W, H * 0.38);

  // tanka svijetla nit po vrhu — `inset 0 1px 0 rgba(255,255,255,.05)`
  c.fillStyle = 'rgba(255,255,255,.05)';
  c.fillRect(0, 0, W, Math.max(1, W * 0.0026));
}

/** Dvostruki okvir i arabeskni uglovi. Vraća oba ruba, od njih se slaže slog.
    Plakat traži mirniji okvir: bez unutrašnje linije (`dvostruki: false`) i
    s utišanim uglovima (`uglovi` — jačina 0–1). */
function okvir(c, W, H, s, { dvostruki = true, uglovi = 1 } = {}) {
  const m  = W * 0.062;
  const m2 = m + W * 0.016;
  c.strokeStyle = `${s.gold}33`;
  c.lineWidth = Math.max(1.2, W * 0.0013);
  c.strokeRect(m, m, W - m * 2, H - m * 2);
  if (dvostruki) {
    c.strokeStyle = `${s.gold}1C`;
    c.strokeRect(m2, m2, W - m2 * 2, H - m2 * 2);
  }

  c.strokeStyle = saAlfom(s.gold, .66 * uglovi);
  c.lineWidth = W * 0.0032;
  const u = W * 0.052;
  ugaoOrnament(c, m, m, 1, 1, u);
  ugaoOrnament(c, W - m, m, -1, 1, u);
  ugaoOrnament(c, m, H - m, 1, -1, u);
  ugaoOrnament(c, W - m, H - m, -1, -1, u);
  return { m, m2 };
}

/* Razdjelnik: linija — brend znak — linija. Linije se gase prema oba kraja,
   isto kao `.razdjelnik i` na kartici: pune u sredini, nevidljive tamo gdje
   prilaze znaku i tamo gdje staju u prazno. Ravna linija je imala dva tvrda
   reza i bila prva stvar po kojoj se vidjelo da slika nije crtana istom
   rukom kao kartica. `y` je sredina znaka. */
function razdjelnikZnak(c, W, y, s, znak, znakP) {
  const poluL = znakP / 2 + W * 0.034;        // linije se drže dalje od znaka
  const kraj = W * 0.215;
  c.lineWidth = Math.max(1.2, W * 0.0013);
  for (const smjer of [-1, 1]) {
    const od = W / 2 + smjer * kraj;
    const do_ = W / 2 + smjer * poluL;
    const g = c.createLinearGradient(od, y, do_, y);
    g.addColorStop(0,   prozirno(s.gold));
    g.addColorStop(.45, saAlfom(s.gold, .27));
    g.addColorStop(.55, saAlfom(s.gold, .31));
    g.addColorStop(1,   prozirno(s.gold));
    c.strokeStyle = g;
    c.beginPath();
    c.moveTo(od, y); c.lineTo(do_, y);
    c.stroke();
  }
  if (znak) {
    c.globalAlpha = 0.95;
    c.drawImage(znak, W / 2 - znakP / 2, y - znakP / 2, znakP, znakP);
    c.globalAlpha = 1;
  }
}

export {
  SERIF, DISPLAY, SANS, STILOVI,
  ucitajSliku, lomiTekst, saAlfom, prozirno, mijesaj,
  uzorakNaPlatno, koricaNaPlatno, podloga, okvir, razdjelnikZnak,
};
