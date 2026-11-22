/* ============================================================
   REELS — hafiz zalijepi link YouTube predavanja, ostalo je automatski.
   Posao radi radnik u Dockeru na laptopu (alati/reels/radnik.py): zvuk,
   transkript (Groq), AI izbor, ispravke i montaža (Gemini), komadi videa i
   izrada 1080×1920 s brendom. Ovdje se prate koraci, pregleda reel (uživo,
   s grafikama, preko YouTube playera, ili gotov MP4), podese isječci i
   preuzmu reelsi. Server: /api/poruke?reels=… (api/_lib/reels.js).
   Uređivanje isječaka je isto kao u lokalnom alatu (alati/reels/ekran.html).
   ============================================================ */
const $ = (s, k = document) => k.querySelector(s);
const $$ = (s, k = document) => [...k.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`; };
const parsiraj = s => { const d = String(s).trim().split(':').map(Number); if (d.some(isNaN)) return null; return d.length === 2 ? d[0] * 60 + d[1] : d[0]; };
const dijeloviOd = x => (x.dijelovi && x.dijelovi.length) ? x.dijelovi : [[x.od, x.do]];
const komadiOd = x => (x.komadi && x.komadi.length) ? x.komadi : dijeloviOd(x).map(([a, b], k) => [a, b, k]);
const trajanje = x => komadiOd(x).reduce((s, [a, b]) => s + (b - a), 0);
const mb = b => `${(b / 1048576).toFixed(1)} MB`;
const KADROVI = [['traka', 'video gore, brend dole'], ['izrez', 'puni ekran 9:16'], ['okvir', 'cijeli kadar + zamućena pozadina']];
const KORACI = ['Zvuk', 'Transkript', 'AI bira isječke', 'AI doteruje', 'Reelsi', 'Gotovo'];
const STATUS = { c: 'čeka', a: 'AI doteruje', v: 'skida video', p: 'pravi reel', s: 'šalje', g: 'gotov', x: 'greška', '-': '' };

let poslovi = [], radnik = null, posao = null, aktivan = -1, izmijenjeni = new Set();
let recenice = [], player = null, igrac = null, krajPustanja = null, redPustanja = [];
let mod = 'reel', pregled = null;            // pregled: { i, komadi } dok se isječak pušta s grafikama
let cuvanjeT = null, cuvanje = Promise.resolve(), anketa = null, otvoren = false, ucitavam = false;

async function api(radnja, tijelo, upit = '') {
  const r = await fetch(`/api/poruke?reels=${radnja}${upit}`, {
    method: tijelo ? 'POST' : 'GET', cache: 'no-store', body: tijelo ? JSON.stringify(tijelo) : undefined,
    headers: { Authorization: `Bearer ${localStorage.getItem('pd.adminTajna') || ''}`, ...(tijelo ? { 'Content-Type': 'application/json' } : {}) },
  });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error('Reels radi samo na objavljenoj verziji (treba /api i baza).');
  if (!r.ok) throw Object.assign(new Error(j.greska || `Greška ${r.status}`), { status: r.status });
  return j;
}

function poruka(t, greska = false) {
  const el = $('#rl-poruka');
  el.textContent = t; el.hidden = !t; el.classList.toggle('greska', greska);
}

/* ---------- koraci obrade (radnik piše fazu „N/6 opis|kodovi isječaka“) ---------- */
function tok(p) {
  const m = /^(\d)\/(\d) ([^|]*)(?:\|(.*))?$/.exec(p.faza || '');
  const korak = m ? +m[1] : 0;
  if (p.stanje === 'radi') return { vrsta: 'radi', korak: korak || 1, opis: m ? m[3] : (p.faza || 'Počinjem…'), kodovi: m?.[4] || '', procenat: p.procenat };
  if (p.zahtjev) return { vrsta: 'ceka', korak: 0, opis: radnik?.ziv ? 'Na redu — počinje za par sekundi' : 'Čeka da se laptop uključi', kodovi: '' };
  if (p.stanje === 'greska') return { vrsta: 'greska', korak, opis: p.greska || 'Greška', kodovi: '' };
  if (p.stanje === 'gotovo') return { vrsta: 'gotovo', korak: 6, opis: m ? m[3] : (p.faza || 'Gotovo'), kodovi: '' };
  return { vrsta: 'ceka', korak: 0, opis: 'Čeka…', kodovi: '' };
}

function kratkoStanje(p) {
  const t = tok(p);
  const tekst = t.vrsta === 'radi' ? `${t.korak}/6 · ${KORACI[t.korak - 1]}${t.opis && !t.opis.startsWith(KORACI[t.korak - 1]) ? ` — ${t.opis}` : ''}` : t.opis;
  const ukupno = t.vrsta === 'radi' ? ((t.korak - 1) + (t.procenat ?? 0) / 100) / 5 * 100 : t.vrsta === 'gotovo' ? 100 : 0;
  return `<div class="rl-stanje ${t.vrsta}"><span>${esc(tekst)}</span>${t.vrsta === 'radi' || t.vrsta === 'ceka' ? `<i class="rl-traka"><b style="width:${Math.min(100, ukupno)}%"></b></i>` : ''}</div>`;
}

function crtajTok() {
  const t = tok(posao), el = $('#rl-tok');
  if (t.vrsta === 'gotovo') {
    el.innerHTML = `<div class="rl-tok__gotovo">✓ ${esc(t.opis.replace(/^Gotovo/, 'Reelsi su gotovi'))}${izmijenjeni.size ? ' · ima neizrađenih izmjena' : ''}</div>`;
    return;
  }
  const koraci = KORACI.map((ime, k) => {
    const n = k + 1;
    const st = t.vrsta === 'radi' ? (n < t.korak ? 'gotov' : n === t.korak ? 'aktivan' : '') : '';
    const detalj = st === 'aktivan' ? `<small>${esc(t.opis)}${t.procenat != null && n !== 5 ? ` · ${Math.round(t.procenat)}%` : ''}</small>` : '';
    return `<li class="${st}"><span class="rl-tok__krug">${st === 'gotov' ? '✓' : n}</span><span>${ime}${detalj}</span></li>`;
  }).join('');
  el.innerHTML = `${t.vrsta !== 'radi' ? `<div class="rl-tok__poruka ${t.vrsta}">${esc(t.opis)}</div>` : ''}<ol class="rl-tok__koraci">${koraci}</ol>`;
}

function crtajRadnika() {
  const el = $('#rl-radnik');
  const ziv = radnik?.ziv;
  el.className = `rl-radnik${ziv ? ' ziv' : ''}`;
  el.textContent = ziv ? 'Laptop je uključen' : radnik?.vidjen
    ? `Laptop isključen · zadnji put ${new Date(radnik.vidjen).toLocaleString('bs-BA', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'Laptop se još nije javio';
  el.title = ziv ? 'Radnik na laptopu prima poslove' : 'Poslovi čekaju; obrada kreće čim se laptop otvori';
}

function crtajListu() {
  const el = $('#rl-lista');
  if (!poslovi.length) { el.innerHTML = '<p class="prazno">Zalijepi link predavanja i klikni „Napravi reelse“.</p>'; return; }
  el.innerHTML = poslovi.map(p => `
    <button class="rl-red" data-posao="${p.id}">
      <img src="https://i.ytimg.com/vi/${esc(p.yt_id)}/mqdefault.jpg" alt="" loading="lazy">
      <span class="rl-red__tekst"><b>${esc(p.naslov || p.url)}</b>${kratkoStanje(p)}</span>
      <span class="rl-red__broj">${p.gotovih ? `${p.gotovih} ${p.gotovih === 1 ? 'reel' : 'reelsa'}` : ''}</span>
    </button>`).join('');
}

async function osvjeziListu() {
  try {
    ({ poslovi, radnik } = await api('lista'));
    poruka('');
    crtajRadnika(); crtajListu();
  } catch (e) { poruka(e.message, true); }
}

/* ---------- otvoren posao ---------- */
async function otvoriPosao(id, tiho = false) {
  const p = await api('posao', null, `&id=${id}`);
  const novIzbor = !posao || posao.id !== p.id || posao.verzija !== p.verzija;
  if (posao && posao.id === p.id && !novIzbor) {           // isti izbor: osvježi stanje i gotove (izmjene ostaju)
    Object.assign(posao, { stanje: p.stanje, zahtjev: p.zahtjev, faza: p.faza, procenat: p.procenat, greska: p.greska,
      sirina: p.sirina, visina: p.visina, naslov: p.naslov });
    if (JSON.stringify(posao.gotovi.map(g => g.put)) !== JSON.stringify(p.gotovi.map(g => g.put))) posao.gotovi = p.gotovi;
    if (!izmijenjeni.size && !cuvanjeT && JSON.stringify(posao.isjecci) !== JSON.stringify(p.isjecci)) {
      posao.isjecci = p.isjecci;                            // radnik je doterao isječke (rezovi, titlovi)
      const zauzeto = $('#rl-isjecci details[open]') || $('#rl-isjecci').contains(document.activeElement);
      if (!zauzeto) { crtajIsjecke(); izaberi(Math.max(0, aktivan), false); }
    }
    if (!recenice.length && p.recenice_url) ucitajRecenice(p.recenice_url);
    crtajTok(); osvjeziIsjecke(); rasporediVideo(); crtajGrafiku();
    return;
  }
  if (tiho && izmijenjeni.size) return;                    // ne briši hafizove izmjene ispod njega
  posao = p; aktivan = -1; izmijenjeni = new Set(); recenice = []; pregled = null;
  $('#rl-pocetak').hidden = true; $('#rl-detalj').hidden = false;
  $('#rl-naslov').textContent = p.naslov || p.url;
  $('#rl-yt-link').href = p.url;
  $('#rl-tema').value = p.tema || '';
  postaviPlayer(p);
  crtajTok(); crtajIsjecke();
  $('#rl-transkript').innerHTML = '<small>Transkript stiže kad AI izabere isječke…</small>';
  if (p.recenice_url) ucitajRecenice(p.recenice_url);
  if (p.isjecci.length) izaberi(0, false);
}

async function ucitajRecenice(url) {
  try { recenice = await (await fetch(url)).json(); } catch { recenice = []; }
  $('#rl-transkript').innerHTML = recenice.map((r, i) => `<span data-i="${i}" data-t="${r.t0}"><small>${fmt(r.t0).slice(0, 5)}</small>${esc(r.tekst)}</span> `).join('');
  oznaciTranskript();
}

/* ---------- ekran: pregled reela (YouTube + grafike), gotov reel (MP4) ili cijeli kadar ---------- */
function ytApi() {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise(res => {
    const stari = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { stari?.(); res(); };
    if (!$('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.append(s);
    }
  });
}

async function postaviPlayer(p) {
  await ytApi();
  if (player) { player.cueVideoById(p.yt_id); rasporediVideo(); return; }
  player = new YT.Player('rl-yt', {
    videoId: p.yt_id, playerVars: { rel: 0, playsinline: 1, controls: 0, disablekb: 1, iv_load_policy: 3, modestbranding: 1 },
    events: { onReady: rasporediVideo, onStateChange: () => { $('#rl-play').textContent = svira() ? '❚❚' : '▶'; } },
  });
  clearInterval(igrac);
  igrac = setInterval(pratiPlayer, 120);
}

const svira = () => player?.getPlayerState?.() === 1;
const vrijeme = () => player?.getCurrentTime?.() ?? 0;
function skoci(t, pusti = false) { player?.seekTo?.(t, true); if (pusti) player?.playVideo?.(); }
function pusti(od, d) { pregled = null; redPustanja = []; krajPustanja = d; skoci(od, true); }

function postaviMod(m) {
  mod = m;
  $('#rl-ekran').dataset.mod = m;
  $$('.rl-modovi [data-mod]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mod === m)));
  const v = $('#rl-gotov-video');
  if (m === 'gotov') { player?.pauseVideo?.(); pregled = null; postaviGotov(); } else { v.pause(); v.hidden = true; $('#rl-ekran-poruka').hidden = true; }
  rasporediVideo(); crtajIzrez(); crtajGrafiku();
}

function postaviGotov() {
  const x = posao?.isjecci[aktivan], g = gotovZa(aktivan), v = $('#rl-gotov-video'), msg = $('#rl-ekran-poruka');
  const ima = g?.url && !izmijenjeni.has(aktivan);
  v.hidden = !ima; msg.hidden = !!ima;
  msg.textContent = !x ? 'Izaberi isječak.' : izmijenjeni.has(aktivan) ? 'Isječak je izmijenjen — klikni „Napravi izmijenjene“.' : 'Ovaj reel još nije napravljen.';
  if (ima && v.dataset.put !== g.put) { v.src = g.url; v.dataset.put = g.put; }
}

/* Video se u pregledu reže i postavlja isto kao u reels.py: „traka“ = 1080×1500 gore, izrez oko pozicije lica. */
function rasporediVideo() {
  const ek = $('#rl-ekran'), box = $('#rl-video');
  if (mod !== 'reel') { box.removeAttribute('style'); return; }
  const W = ek.clientWidth, H = ek.clientHeight, x = posao?.isjecci[aktivan];
  const ar = posao?.sirina && posao?.visina ? posao.sirina / posao.visina : 16 / 9;
  const kadar = x?.kadar || 'traka';
  let w, h, left, top = 0;
  if (kadar === 'okvir') { w = W; h = W / ar; left = 0; top = H * 300 / 1920; }
  else {
    h = H * (kadar === 'izrez' ? 1 : 1500 / 1920); w = h * ar;
    left = Math.min(0, Math.max(W - w, W / 2 - (x?.pozicija ?? 0.5) * w));
  }
  Object.assign(box.style, { width: `${w}px`, height: `${h}px`, left: `${left}px`, top: `${top}px` });
}

function crtajGrafiku() {
  const x = posao?.isjecci[aktivan];
  $('#rl-grafika').dataset.kadar = x?.kadar || 'traka';
  $('#rl-g-tema').textContent = (posao?.tema || '').toUpperCase();
  $('#rl-g-naslov').textContent = x?.naslov || '';
  if (!pregled) $('#rl-g-titl').innerHTML = '';
}

/* Titl za trenutni trenutak pregleda: vrijeme YouTubea → vrijeme spojenog reela (preko komada). */
function crtajTitl(t) {
  const x = posao?.isjecci[pregled?.i];
  if (!x) return;
  const el = $('#rl-g-titl');
  if (x.titlovi_ukljuceni === false) { el.innerHTML = ''; return; }
  if (!x.titlovi?.length) { el.innerHTML = '<span class="rl-g-nema">titlovi se slažu pri izradi</span>'; return; }
  let spojeno = null, prije = 0;
  for (const [a, b] of pregled.komadi) {
    if (t >= a - 0.05 && t <= b + 0.05) { spojeno = prije + (t - a); break; }
    prije += b - a;
  }
  if (spojeno == null) return;
  const gi = x.titlovi.findIndex((g, k) => spojeno >= g.t0 - 0.02 && spojeno < (x.titlovi[k + 1]?.t0 ?? 1e9) && spojeno <= g.t1 + 0.6);
  const g = x.titlovi[gi];
  if (!g) { el.innerHTML = ''; el.dataset.kljuc = ''; return; }
  const rijeci = g.tekst.split(/\s+/);
  const aktivna = (g.rijeci?.length === rijeci.length) ? g.rijeci.reduce((n, [a], k) => (spojeno >= a ? k : n), 0) : -1;
  const kljuc = `${gi}:${aktivna}`;
  if (el.dataset.kljuc === kljuc) return;
  el.dataset.kljuc = kljuc;
  el.innerHTML = rijeci.map((w, k) => `<span${k === aktivna ? ' class="sad"' : ''}>${esc(k === rijeci.length - 1 ? w.replace(/[,.;:]$/, '') : w)}</span>`).join(' ');
}

function pratiPlayer() {
  if (!otvoren || !player?.getCurrentTime) return;
  const t = vrijeme();
  $('#rl-sad').textContent = fmt(t);
  if (krajPustanja != null && t >= krajPustanja) {
    if (redPustanja.length) { const [a, b] = redPustanja.shift(); krajPustanja = b; skoci(a); }
    else { player.pauseVideo(); krajPustanja = null; }
  }
  if (pregled && mod === 'reel') crtajTitl(t);
  const i = recenice.findIndex(r => t >= r.t0 && t < r.t1);
  const sad = $('#rl-transkript span.sad');
  if (sad && +sad.dataset.i !== i) sad.classList.remove('sad');
  if (i >= 0) $(`#rl-transkript span[data-i="${i}"]`)?.classList.add('sad');
}

function pregledaj(i) {
  const x = posao.isjecci[i];
  if (i !== aktivan) izaberi(i, false);
  if (mod !== 'reel') postaviMod('reel');
  const komadi = komadiOd(x).map(([a, b]) => [a, b]);
  pregled = { i, komadi };
  $('#rl-g-titl').dataset.kljuc = '';
  redPustanja = komadi.slice(1); krajPustanja = komadi[0][1]; skoci(komadi[0][0], true);
  $('#rl-ispod-tekst').textContent = `Pregled #${i + 1}: ${trajanje(x).toFixed(0)} s, ${komadi.length > 1 ? `${komadi.length} dijela` : 'bez rezova'}`;
}

/* ---------- isječci ---------- */
const gotovZa = i => (posao?.gotovi || []).find(g => g.br === i + 1);

function statusIsjecka(i, x) {
  const t = tok(posao), kod = t.vrsta === 'radi' ? t.kodovi[i] : null;
  if (x.ukljuci === false) return ['', 'isključen'];
  if (kod && kod !== 'g' && kod !== '-') return [kod === 'x' ? 'greska' : 'radi', STATUS[kod]];
  if (izmijenjeni.has(i)) return ['izmijenjen', 'izmijenjen'];
  if (posao.zahtjev === 'napravi' && !gotovZa(i)) return ['radi', 'čeka izradu'];
  if (gotovZa(i)) return ['gotov', '✓ gotov'];
  return ['', t.vrsta === 'radi' || t.vrsta === 'ceka' ? 'čeka' : 'nije napravljen'];
}

function crtajIsjecke() {
  $('#rl-isjecci').innerHTML = posao.isjecci.map((x, i) => `
    <li class="rl-isj${i === aktivan ? ' aktivan' : ''}${x.ukljuci === false ? ' iskljucen' : ''}" data-i="${i}">
      <div class="rl-isj__red">
        <span class="rl-br">${i + 1}</span>
        <div class="rl-isj__tekst">
          <input type="text" class="rl-naslov-isj" data-p="naslov" value="${esc(x.naslov)}" placeholder="Naslov na reelsu" aria-label="Naslov reelsa ${i + 1}">
          <div class="rl-isj__meta"><span class="nad">${esc(x.tip || 'ručno')}</span> · <span class="rl-trajanje">${trajanje(x).toFixed(0)} s</span>
            <span class="rl-status" data-status></span></div>
        </div>
      </div>
      <div class="rl-isj__akcije">
        <button data-a="pregled" title="Pusti s naslovom, brendom i titlovima">▶ Pregled</button>
        <span class="rl-gotov-akcije"></span>
      </div>
      <details class="rl-uredi"><summary>Uredi isječak</summary>
        ${x.poenta ? `<p>${esc(x.poenta)}</p>` : ''}${x.zasto ? `<p class="sitno">Zašto: ${esc(x.zasto)}</p>` : ''}
        ${dijeloviOd(x).length > 1 ? `<details class="rl-montaza"><summary>✂ <b>${dijeloviOd(x).length} dijela</b>, izbačeno ${(x.do - x.od - dijeloviOd(x).reduce((s, [a, b]) => s + b - a, 0)).toFixed(0)} s</summary>
          ${x.rezovi ? `<p class="sitno">${esc(x.rezovi)}</p>` : ''}
          ${dijeloviOd(x).map(([a, b], k) => `<div class="rl-dio">
            <button data-dio="${k}" data-kraj="0" data-d="-0.2">−.2</button><button data-dio="${k}" data-kraj="0" data-d="0.2">+.2</button>
            <span>${fmt(a)} → ${fmt(b)}</span>
            <button data-dio="${k}" data-kraj="1" data-d="-0.2">−.2</button><button data-dio="${k}" data-kraj="1" data-d="0.2">+.2</button>
            <button data-dio="${k}" data-pusti-dio="1" title="Pusti ovaj dio">▶</button><button data-dio="${k}" data-izbaci="1" title="Izbaci ovaj dio">✕</button></div>`).join('')}
          <button class="tiho" data-a="bezrezova">Vrati bez rezova</button></details>` : ''}
        <div class="rl-vrijeme">
          <span>Početak</span><button data-m="od" data-d="-1">−1</button><button data-m="od" data-d="-0.2">−.2</button>
          <input type="text" data-t="od" value="${fmt(x.od)}" aria-label="Početak"><button data-m="od" data-d="0.2">+.2</button><button data-m="od" data-d="1">+1</button>
          <button data-sada="od" title="Postavi na mjesto gdje je video sada">= sada</button>
          <span>Kraj</span><button data-m="do" data-d="-1">−1</button><button data-m="do" data-d="-0.2">−.2</button>
          <input type="text" data-t="do" value="${fmt(x.do)}" aria-label="Kraj"><button data-m="do" data-d="0.2">+.2</button><button data-m="do" data-d="1">+1</button>
          <button data-sada="do" title="Postavi na mjesto gdje je video sada">= sada</button>
        </div>
        <div class="rl-red-opcija">
          <select data-p="kadar" aria-label="Kadar">${KADROVI.map(([k, t]) => `<option value="${k}"${(x.kadar || 'traka') === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
          <label ${x.kadar === 'okvir' ? 'hidden' : ''} title="Pomjeri izrez lijevo-desno">pozicija <input type="range" min="0" max="1" step="0.01" data-p="pozicija" value="${x.pozicija ?? .5}"></label>
          <label class="rl-kvacica"><input type="checkbox" data-p="titlovi_ukljuceni" ${x.titlovi_ukljuceni !== false ? 'checked' : ''}> titlovi</label>
          <label class="rl-kvacica" title="Duge pauze u govoru se izrežu"><input type="checkbox" data-p="zbij_pauze" ${x.zbij_pauze !== false ? 'checked' : ''}> zbij pauze</label>
          <label class="rl-kvacica"><input type="checkbox" data-p="ukljuci" ${x.ukljuci !== false ? 'checked' : ''}> pravi ovaj reel</label>
        </div>
        <details class="rl-titlovi" data-i="${i}"><summary>Ispravi titlove</summary><div class="rl-titlovi__lista"></div></details>
        <button class="tiho opasno" data-a="obrisi">Ukloni isječak</button>
      </details>
    </li>`).join('');
  osvjeziIsjecke(); oznaciTranskript();
}

/* Status, dugmad za gotov reel i dno — bez ponovnog crtanja (otvorena polja ostaju kakva jesu). */
function osvjeziIsjecke() {
  if (!posao) return;
  posao.isjecci.forEach((x, i) => {
    const li = $(`.rl-isj[data-i="${i}"]`); if (!li) return;
    const [klasa, tekst] = statusIsjecka(i, x);
    const s = li.querySelector('[data-status]');
    s.className = `rl-status ${klasa}`; s.textContent = tekst;
    const tr = li.querySelector('.rl-trajanje'); if (tr) tr.textContent = `${trajanje(x).toFixed(0)} s`;
    const g = gotovZa(i), ak = li.querySelector('.rl-gotov-akcije');
    const html = g?.url && !izmijenjeni.has(i) ? `<button data-a="gotov" title="Pusti napravljeni MP4">Gotov reel</button><a class="dugme" href="${esc(g.preuzmi)}" download="${esc(g.ime)}" title="${g.trajanje ? `${Math.round(g.trajanje)} s · ` : ''}${g.velicina ? mb(g.velicina) : ''}"><svg class="ik"><use href="#i-preuzmi"/></svg> Preuzmi</a>` : '';
    if (ak.dataset.html !== html) { ak.innerHTML = html; ak.dataset.html = html; }
  });
  const g = posao.gotovi || [], t = tok(posao);
  $('#rl-broj').textContent = posao.isjecci.length ? `${g.length} od ${posao.isjecci.filter(x => x.ukljuci !== false).length} gotovo` : '';
  $('#rl-preuzmi-sve').hidden = g.length < 2;
  const radi = t.vrsta === 'radi' || t.vrsta === 'ceka', bez = !posao.isjecci.length;
  $('#rl-napravi').disabled = bez || !izmijenjeni.size;
  $('#rl-napravi').textContent = posao.zahtjev === 'napravi' ? 'Čeka izradu…' : izmijenjeni.size ? `Napravi izmijenjene (${izmijenjeni.size})` : 'Nema izmjena';
  $('#rl-ponovo').disabled = radi; $('#rl-dodaj').disabled = bez;
  $('#rl-prazno').hidden = !bez;
  $('#rl-prazno').textContent = t.vrsta === 'greska' ? 'Obrada nije uspjela — poruka je iznad. „AI ponovo bira“ pokušava iznova.'
    : 'AI još bira isječke. Pojaviće se ovdje, a reelsi se prave sami.';
  if (mod === 'gotov') postaviGotov();
}

function izaberi(i, premotaj = true) {
  aktivan = i;
  $$('.rl-isj').forEach(li => li.classList.toggle('aktivan', +li.dataset.i === i));
  if (premotaj && posao.isjecci[i]) skoci(posao.isjecci[i].od);
  oznaciTranskript(); rasporediVideo(); crtajIzrez(); crtajGrafiku();
  if (mod === 'gotov') postaviGotov();
}

function crtajIzrez() {
  const x = posao?.isjecci[aktivan], el = $('#rl-izrez');
  if (mod !== 'kadar' || !x || x.kadar === 'okvir' || !posao.sirina) { el.hidden = true; return; }
  const sir = Math.min(1, posao.visina * 1080 / (x.kadar === 'izrez' ? 1920 : 1500) / posao.sirina);   // isto kao u reels.py
  const lijevo = Math.min(1 - sir, Math.max(0, (x.pozicija ?? .5) - sir / 2));
  el.hidden = false; el.style.width = `${sir * 100}%`; el.style.left = `${lijevo * 100}%`;
}

function oznaciTranskript() {
  const x = posao?.isjecci[aktivan];
  $$('#rl-transkript span[data-i]').forEach(s => {
    const r = recenice[+s.dataset.i];
    s.classList.toggle('u', !!x && !!r && r.t1 > x.od + 0.3 && r.t0 < x.do - 0.3);
  });
}

function oznaci(i) {
  izmijenjeni.add(i);
  osvjeziIsjecke();
}

function sacuvaj() {
  clearTimeout(cuvanjeT);
  $('#rl-sacuvano').textContent = '…';
  cuvanjeT = setTimeout(() => { cuvanjeT = null; cuvanje = posalji('sacuvaj'); }, 600);
}

async function posalji(radnja) {
  try {
    const r = await api(radnja, { id: posao.id, verzija: posao.verzija, isjecci: posao.isjecci, tema: posao.tema, tema_rucno: posao.tema_rucno });
    $('#rl-sacuvano').textContent = 'Sačuvano';
    return r;
  } catch (e) {
    if (e.status === 409) { alert(e.message); const id = posao.id; posao = null; izmijenjeni = new Set(); return otvoriPosao(id); }
    $('#rl-sacuvano').textContent = '';
    poruka(e.message, true);
  }
}

/* Novi raspon → titlovi i komadi se slažu iznova (radnik, uz AI ispravku novog dijela). */
const bezTitlova = x => { x.titlovi = null; x.komadi = null; };

function promijeniVrijeme(i, polje, t) {
  const x = posao.isjecci[i];
  t = Math.max(0, Math.min(posao.trajanje || 1e9, Math.round(t * 100) / 100));
  x[polje] = t;
  if (x.do <= x.od + 1) x[polje === 'od' ? 'do' : 'od'] = polje === 'od' ? t + 1 : Math.max(0, t - 1);
  if (x.dijelovi && x.dijelovi.length) {   // prvi dio počinje na početku, zadnji završava na kraju
    x.dijelovi = x.dijelovi.filter(([a, b]) => b > x.od + 0.3 && a < x.do - 0.3).map(([a, b]) => [Math.max(a, x.od), Math.min(b, x.do)]);
    if (!x.dijelovi.length) x.dijelovi = [[x.od, x.do]];
    x.dijelovi[0][0] = x.od; x.dijelovi[x.dijelovi.length - 1][1] = x.do;
  }
  bezTitlova(x);
  const li = $(`.rl-isj[data-i="${i}"]`);
  li.querySelector('[data-t="od"]').value = fmt(x.od);
  li.querySelector('[data-t="do"]').value = fmt(x.do);
  const det = li.querySelector('details.rl-titlovi'); if (det.open) crtajTitlove(i, det);
  if (mod === 'gotov') postaviMod('kadar');
  pregled = null; skoci(polje === 'od' ? x.od : Math.max(x.od, x.do - 3));
  oznaci(i); oznaciTranskript(); sacuvaj();
}

function crtajTitlove(i, det) {
  const x = posao.isjecci[i];
  det.querySelector('.rl-titlovi__lista').innerHTML = x.titlovi?.length
    ? x.titlovi.map((g, k) => `<div><small>${fmt(g.t0)}</small><input type="text" data-titl="${k}" value="${esc(g.tekst)}"></div>`).join('')
    : '<small>Za novi raspon titlovi se slažu pri izradi (AI prvo ispravi riječi). Klikni „Napravi izmijenjene“, pa ih ovdje možeš popraviti.</small>';
}

/* ---------- događaji ---------- */
function vezi() {
  $('#rl-forma').addEventListener('submit', async e => {
    e.preventDefault();
    const url = $('#rl-url').value.trim(); if (!url) return;
    $('#rl-posalji').disabled = true;
    try {
      const r = await api('novi', { url });
      $('#rl-url').value = '';
      poruka(r.postoji ? 'Taj video je već ovdje — otvaram ga.' : '');
      await osvjeziListu();
      otvori(r.id);
    } catch (err) { poruka(err.message, true); }
    finally { $('#rl-posalji').disabled = false; }
  });
  $('#rl-lista').addEventListener('click', e => { const b = e.target.closest('[data-posao]'); if (b) otvori(b.dataset.posao); });
  $('#rl-nazad').addEventListener('click', () => { history.replaceState(null, '', '#reels'); zatvoriPosao(); osvjeziListu(); });
  $$('.rl-modovi [data-mod]').forEach(b => b.addEventListener('click', () => postaviMod(b.dataset.mod)));
  $('#rl-play').addEventListener('click', () => {
    if (svira()) return player.pauseVideo();
    if (mod === 'reel' && aktivan >= 0 && !pregled) return pregledaj(aktivan);
    player?.playVideo?.();
  });
  new ResizeObserver(rasporediVideo).observe($('#rl-ekran'));

  $('#rl-napravi').addEventListener('click', async () => {
    clearTimeout(cuvanjeT); cuvanjeT = null; await cuvanje;
    const r = await posalji('napravi');
    if (r?.ok) { izmijenjeni = new Set(); posao.zahtjev = 'napravi'; crtajTok(); osvjeziIsjecke(); }
  });
  $('#rl-ponovo').addEventListener('click', async () => {
    if (!confirm('AI će ponovo izabrati isječke, a trenutni (i tvoje izmjene) se brišu. Nastaviti?')) return;
    try { await api('predlozi', { id: posao.id }); posao.zahtjev = 'predlozi'; crtajTok(); osvjeziIsjecke(); } catch (e) { poruka(e.message, true); }
  });
  $('#rl-obrisi').addEventListener('click', async () => {
    if (!confirm('Obrisati ovaj video, njegove isječke i sve reelse? Ovo se ne može vratiti.')) return;
    try { await api('obrisi', { id: posao.id }); zatvoriPosao(); history.replaceState(null, '', '#reels'); osvjeziListu(); } catch (e) { poruka(e.message, true); }
  });
  $('#rl-preuzmi-sve').addEventListener('click', () => {
    (posao.gotovi || []).forEach((g, k) => setTimeout(() => {
      const a = Object.assign(document.createElement('a'), { href: g.preuzmi, download: g.ime }); document.body.append(a); a.click(); a.remove();
    }, k * 700));
  });
  $('#rl-tema').addEventListener('input', e => { posao.tema = e.target.value.trim(); crtajGrafiku(); });
  $('#rl-tema').addEventListener('change', e => { posao.tema = e.target.value.trim(); posao.tema_rucno = true; posao.isjecci.forEach((_, i) => izmijenjeni.add(i)); osvjeziIsjecke(); sacuvaj(); });
  $('#rl-dodaj').addEventListener('click', () => {
    const t = vrijeme();
    posao.isjecci.push({ od: t, do: Math.min(t + 60, posao.trajanje || t + 60), naslov: '', tip: '', poenta: '', zasto: '', ukljuci: true, kadar: 'traka', pozicija: 0.5 });
    posao.isjecci.sort((a, b) => a.od - b.od);
    const i = posao.isjecci.findIndex(x => x.od === t);
    izmijenjeni = new Set([...izmijenjeni].map(k => k >= i ? k + 1 : k)); izmijenjeni.add(i);
    crtajIsjecke(); izaberi(i, false); sacuvaj();
    $(`.rl-isj[data-i="${i}"] details.rl-uredi`).open = true;
  });
  $('#rl-transkript').addEventListener('click', e => { const s = e.target.closest('span[data-t]'); if (s) { krajPustanja = null; pregled = null; if (mod === 'gotov') postaviMod('kadar'); skoci(+s.dataset.t, true); } });

  const ol = $('#rl-isjecci');
  ol.addEventListener('click', e => {
    const li = e.target.closest('.rl-isj'); if (!li) return;
    const i = +li.dataset.i, x = posao.isjecci[i], b = e.target.closest('button');
    if (i !== aktivan) izaberi(i, false);
    if (!b) return;
    if (b.dataset.a === 'pregled') pregledaj(i);
    else if (b.dataset.a === 'gotov') { postaviMod('gotov'); $('#rl-gotov-video').play().catch(() => {}); }
    else if (b.dataset.a === 'bezrezova') { x.dijelovi = null; bezTitlova(x); oznaci(i); crtajIsjecke(); izaberi(i, false); sacuvaj(); }
    else if (b.dataset.a === 'obrisi') {
      if (!confirm(`Ukloniti isječak #${i + 1}?`)) return;
      posao.isjecci.splice(i, 1); aktivan = -1;
      izmijenjeni = new Set([...izmijenjeni].filter(k => k !== i).map(k => k > i ? k - 1 : k));
      crtajIsjecke(); crtajIzrez(); sacuvaj();
    } else if (b.dataset.dio != null) {
      const k = +b.dataset.dio, dij = dijeloviOd(x).map(p => [...p]);
      if (b.dataset.pustiDio) return pusti(dij[k][0], dij[k][1]);
      if (b.dataset.izbaci) { if (dij.length < 2) return; dij.splice(k, 1); }
      else dij[k][+b.dataset.kraj] = Math.round((dij[k][+b.dataset.kraj] + +b.dataset.d) * 100) / 100;
      x.dijelovi = dij; x.od = dij[0][0]; x.do = dij[dij.length - 1][1]; bezTitlova(x);
      oznaci(i); crtajIsjecke(); izaberi(i, false);
      const li2 = $(`.rl-isj[data-i="${i}"]`); li2.querySelector('details.rl-uredi').open = true; li2.querySelector('details.rl-montaza').open = true;
      sacuvaj();
    } else if (b.dataset.m) promijeniVrijeme(i, b.dataset.m, x[b.dataset.m] + +b.dataset.d);
    else if (b.dataset.sada) promijeniVrijeme(i, b.dataset.sada, vrijeme());
  });
  ol.addEventListener('change', e => {
    const li = e.target.closest('.rl-isj'); if (!li) return;
    const i = +li.dataset.i, x = posao.isjecci[i], el = e.target;
    if (el.dataset.t) { const t = parsiraj(el.value); if (t == null) el.value = fmt(x[el.dataset.t]); else promijeniVrijeme(i, el.dataset.t, t); return; }
    if (el.dataset.titl) { x.titlovi[+el.dataset.titl].tekst = el.value.trim(); oznaci(i); sacuvaj(); return; }
    const p = el.dataset.p; if (!p) return;
    x[p] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    if (p === 'zbij_pauze') bezTitlova(x);
    if (p === 'ukljuci') li.classList.toggle('iskljucen', !x.ukljuci);
    if (p === 'kadar') li.querySelector('[data-p="pozicija"]').closest('label').hidden = x.kadar === 'okvir';
    oznaci(i); rasporediVideo(); crtajIzrez(); crtajGrafiku(); sacuvaj();
  });
  ol.addEventListener('input', e => {
    const li = e.target.closest('.rl-isj'); if (!li) return;
    const i = +li.dataset.i;
    if (e.target.type === 'range') { posao.isjecci[i].pozicija = +e.target.value; if (i === aktivan) { rasporediVideo(); crtajIzrez(); } }
    if (e.target.dataset.p === 'naslov') { posao.isjecci[i].naslov = e.target.value; if (i === aktivan) crtajGrafiku(); }
  });
  ol.addEventListener('toggle', e => { if (e.target.open && e.target.matches('details.rl-titlovi')) crtajTitlove(+e.target.dataset.i, e.target); }, true);
}

/* ---------- ulaz: tab i adresa (#reels, #reels?id=…) ---------- */
function otvori(id) {
  history.replaceState(null, '', `#reels?id=${id}`);
  otvoriPosao(id).catch(e => poruka(e.message, true));
}

function zatvoriPosao() {
  posao = null; aktivan = -1; izmijenjeni = new Set(); pregled = null;
  player?.pauseVideo?.();
  $('#rl-detalj').hidden = true; $('#rl-pocetak').hidden = false;
}

async function korak() {
  if (!otvoren || ucitavam || document.hidden) return;
  const sekcija = $('section[data-pogled="reels"]');
  if (!sekcija || sekcija.hidden) { otvoren = false; clearInterval(anketa); return; }
  ucitavam = true;
  try {
    if (posao) await otvoriPosao(posao.id, true);
    else await osvjeziListu();
  } catch (e) { poruka(e.message, true); }
  finally { ucitavam = false; }
}

let vezano = false;
export function reelsOtvori() {
  if (!vezano) { vezi(); vezano = true; }
  otvoren = true;
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
  osvjeziListu().then(() => { if (id && !posao) otvori(id); });
  clearInterval(anketa);
  anketa = setInterval(korak, 3000);
}
