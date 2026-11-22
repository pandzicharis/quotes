/* ============================================================
   REELS — hafiz zalijepi link YouTube predavanja, ostalo je automatski.
   Posao radi radnik u Dockeru na laptopu (alati/reels/radnik.py): preuzme
   video, transkript (Groq), AI izbor, ispravke i rezovi (Gemini), izrada
   1080×1920 s brendom. Ovdje se prati stanje, podese isječci i preuzmu
   gotovi reelsi. Server: /api/poruke?reels=… (api/_lib/reels.js).
   Uređivanje isječaka je isto kao u lokalnom alatu (alati/reels/ekran.html),
   samo se pregleda kroz YouTube player umjesto lokalnog fajla.
   ============================================================ */
const $ = (s, k = document) => k.querySelector(s);
const $$ = (s, k = document) => [...k.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`; };
const parsiraj = s => { const d = String(s).trim().split(':').map(Number); if (d.some(isNaN)) return null; return d.length === 2 ? d[0] * 60 + d[1] : d[0]; };
const dijeloviOd = x => (x.dijelovi && x.dijelovi.length) ? x.dijelovi : [[x.od, x.do]];
const trajanje = x => dijeloviOd(x).reduce((s, [a, b]) => s + (b - a), 0);
const mb = b => `${(b / 1048576).toFixed(1)} MB`;
const KADROVI = [['traka', 'video gore, brend dole'], ['izrez', 'puni ekran 9:16'], ['okvir', 'cijeli kadar + zamućena pozadina']];

let poslovi = [], radnik = null, posao = null, aktivan = -1, izmijenjeni = new Set(), uIzradi = new Set();
let recenice = [], player = null, igrac = null, krajPustanja = null, redPustanja = [];
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

/* ---------- stanje posla (lista i detalj) ---------- */
function opisStanja(p) {
  if (p.stanje === 'radi') return { tekst: p.faza || 'Radi…', procenat: p.procenat, radi: true };
  if (p.zahtjev) return { tekst: radnik?.ziv ? 'Čeka na red…' : 'Čeka da se laptop uključi', ceka: true };
  if (p.stanje === 'greska') return { tekst: p.greska || 'Greška', greska: true };
  if (p.stanje === 'gotovo') return { tekst: p.faza || 'Gotovo' };
  return { tekst: 'Čeka…', ceka: true };
}

function trakaStanja(p) {
  const s = opisStanja(p);
  return `<div class="rl-stanje${s.greska ? ' greska' : ''}${s.radi && s.procenat == null ? ' neodredjeno' : ''}">
    <span>${esc(s.tekst)}</span>${s.radi || s.ceka ? `<i class="rl-traka"><b style="width:${s.procenat ?? 0}%"></b></i>` : ''}</div>`;
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
      <span class="rl-red__tekst">
        <b>${esc(p.naslov || p.url)}</b>
        ${trakaStanja(p)}
      </span>
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
  if (posao && posao.id === p.id && !novIzbor) {           // isti izbor: osvježi samo stanje i gotove (izmjene ostaju)
    Object.assign(posao, { stanje: p.stanje, zahtjev: p.zahtjev, faza: p.faza, procenat: p.procenat, greska: p.greska,
      sirina: p.sirina, visina: p.visina, naslov: p.naslov });
    if (JSON.stringify(posao.gotovi.map(g => g.put)) !== JSON.stringify(p.gotovi.map(g => g.put))) { posao.gotovi = p.gotovi; crtajGotove(); crtajIsjecke(); }
    if (!p.zahtjev && p.stanje !== 'radi' && uIzradi.size) { uIzradi = new Set(); crtajIsjecke(); }
    if (!izmijenjeni.size && !cuvanjeT && JSON.stringify(posao.isjecci) !== JSON.stringify(p.isjecci)) { posao.isjecci = p.isjecci; crtajIsjecke(); }
    if (!recenice.length && p.recenice_url) ucitajRecenice(p.recenice_url);
    crtajStanjePosla();
    return;
  }
  if (tiho && izmijenjeni.size) return;                    // ne briši hafizove izmjene ispod njega
  posao = p; aktivan = -1; izmijenjeni = new Set(); uIzradi = new Set(); recenice = [];
  $('#rl-pocetak').hidden = true; $('#rl-detalj').hidden = false;
  $('#rl-naslov').textContent = p.naslov || p.url;
  $('#rl-yt-link').href = p.url;
  $('#rl-tema').value = p.tema || '';
  postaviPlayer(p);
  crtajStanjePosla(); crtajIsjecke(); crtajGotove();
  $('#rl-transkript').innerHTML = '<small>Transkript stiže kad AI izabere isječke…</small>';
  if (p.recenice_url) ucitajRecenice(p.recenice_url);
  if (p.isjecci.length) izaberi(0, false);
}

async function ucitajRecenice(url) {
  try { recenice = await (await fetch(url)).json(); } catch { recenice = []; }
  $('#rl-transkript').innerHTML = recenice.map((r, i) => `<span data-i="${i}" data-t="${r.t0}"><small>${fmt(r.t0).slice(0, 5)}</small>${esc(r.tekst)}</span> `).join('');
  oznaciTranskript();
}

function crtajStanjePosla() {
  $('#rl-stanje').innerHTML = trakaStanja(posao);
  const radi = posao.stanje === 'radi' || Boolean(posao.zahtjev);
  const bez = !posao.isjecci.length;
  $('#rl-napravi').disabled = bez;
  $('#rl-napravi').textContent = posao.zahtjev === 'napravi' ? 'Čeka izradu…' : 'Napravi izmijenjene';
  $('#rl-ponovo').disabled = radi;
  $('#rl-dodaj').disabled = bez;
  $('#rl-prazno').hidden = !bez;
  $('#rl-prazno').textContent = posao.stanje === 'greska' ? 'Obrada nije uspjela. Poruka je iznad; „Ponovo predloži“ pokušava iznova.'
    : 'AI još bira isječke. Kad završi, ovdje se pojave, a reelsi se prave sami.';
}

/* ---------- YouTube player umjesto lokalnog videa ---------- */
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
  $('#rl-video').style.aspectRatio = p.sirina && p.visina ? `${p.sirina} / ${p.visina}` : '16 / 9';
  await ytApi();
  if (player) { player.cueVideoById(p.yt_id); return; }
  player = new YT.Player('rl-yt', { videoId: p.yt_id, playerVars: { rel: 0, playsinline: 1, modestbranding: 1 } });
  clearInterval(igrac);
  igrac = setInterval(pratiPlayer, 200);
}

const vrijeme = () => player?.getCurrentTime?.() ?? 0;
function skoci(t, pusti = false) { player?.seekTo?.(t, true); if (pusti) player?.playVideo?.(); }
function pusti(od, d) { redPustanja = []; krajPustanja = d; skoci(od, true); }
function pustiDijelove(dij) { redPustanja = dij.slice(1); krajPustanja = dij[0][1]; skoci(dij[0][0], true); }

function pratiPlayer() {
  if (!otvoren || !player?.getCurrentTime) return;
  const t = vrijeme();
  $('#rl-sad').textContent = fmt(t);
  if (krajPustanja != null && t >= krajPustanja) {
    if (redPustanja.length) { const [a, b] = redPustanja.shift(); krajPustanja = b; skoci(a); }
    else { player.pauseVideo(); krajPustanja = null; }
  }
  const i = recenice.findIndex(r => t >= r.t0 && t < r.t1);
  const sad = $('#rl-transkript span.sad');
  if (sad && +sad.dataset.i !== i) sad.classList.remove('sad');
  if (i >= 0) $(`#rl-transkript span[data-i="${i}"]`)?.classList.add('sad');
}

/* ---------- isječci (kao ekran.html lokalnog alata) ---------- */
function crtajIsjecke() {
  const g = new Map((posao.gotovi || []).map(x => [x.br, x]));
  $('#rl-isjecci').innerHTML = posao.isjecci.map((x, i) => `
    <li class="rl-isj${i === aktivan ? ' aktivan' : ''}${x.ukljuci === false ? ' iskljucen' : ''}" data-i="${i}">
      <div class="rl-isj__glava">
        <label class="rl-kvacica"><input type="checkbox" data-p="ukljuci" ${x.ukljuci !== false ? 'checked' : ''}> #${i + 1}</label>
        <span class="nad">${esc(x.tip || 'ručno')}</span>
        <span class="rl-trajanje">${trajanje(x).toFixed(0)} s</span>
        <span class="rl-oznaka">${oznakaIsjecka(i, x, g)}</span>
        <span class="razmak"></span>
        <button class="tiho" data-a="pusti">▶ Pusti</button>
        <button class="tiho" data-a="kraj" title="Pusti zadnje 4 sekunde">▶ kraj</button>
        <button class="tiho ikona-dugme" data-a="obrisi" title="Ukloni isječak" aria-label="Ukloni isječak">✕</button>
      </div>
      <input type="text" class="rl-naslov-isj" data-p="naslov" value="${esc(x.naslov)}" placeholder="Naslov na reelsu">
      ${x.poenta ? `<p>${esc(x.poenta)}</p>` : ''}${x.zasto ? `<p class="sitno">Zašto: ${esc(x.zasto)}</p>` : ''}
      ${dijeloviOd(x).length > 1 ? `<details class="rl-montaza"><summary>✂ <b>${dijeloviOd(x).length} dijela</b>, izbačeno ${(x.do - x.od - trajanje(x)).toFixed(0)} s</summary>
        ${x.rezovi ? `<p class="sitno">${esc(x.rezovi)}</p>` : ''}
        ${dijeloviOd(x).map(([a, b], k) => `<div class="rl-dio">
          <button data-dio="${k}" data-kraj="0" data-d="-0.2">−.2</button><button data-dio="${k}" data-kraj="0" data-d="0.2">+.2</button>
          <span>${fmt(a)} → ${fmt(b)}</span>
          <button data-dio="${k}" data-kraj="1" data-d="-0.2">−.2</button><button data-dio="${k}" data-kraj="1" data-d="0.2">+.2</button>
          <button data-dio="${k}" data-pusti-dio="1">▶</button><button data-dio="${k}" data-izbaci="1" title="Izbaci ovaj dio">✕</button></div>`).join('')}
        <button class="tiho" data-a="bezrezova">Vrati bez rezova</button></details>` : ''}
      <div class="rl-vrijeme">
        <span>Početak</span><button data-m="od" data-d="-1">−1</button><button data-m="od" data-d="-0.2">−.2</button>
        <input type="text" data-t="od" value="${fmt(x.od)}"><button data-m="od" data-d="0.2">+.2</button><button data-m="od" data-d="1">+1</button>
        <button data-sada="od" title="Postavi na trenutno mjesto u videu">= sada</button>
        <span>Kraj</span><button data-m="do" data-d="-1">−1</button><button data-m="do" data-d="-0.2">−.2</button>
        <input type="text" data-t="do" value="${fmt(x.do)}"><button data-m="do" data-d="0.2">+.2</button><button data-m="do" data-d="1">+1</button>
        <button data-sada="do" title="Postavi na trenutno mjesto u videu">= sada</button>
      </div>
      <div class="rl-red-opcija">
        <select data-p="kadar" aria-label="Kadar">${KADROVI.map(([k, t]) => `<option value="${k}"${(x.kadar || 'traka') === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <label ${x.kadar === 'okvir' ? 'hidden' : ''} title="Pomjeri izrez lijevo-desno (zlatni okvir na videu)">pozicija <input type="range" min="0" max="1" step="0.01" data-p="pozicija" value="${x.pozicija ?? .5}"></label>
        <label class="rl-kvacica"><input type="checkbox" data-p="titlovi_ukljuceni" ${x.titlovi_ukljuceni !== false ? 'checked' : ''}> titlovi</label>
        <label class="rl-kvacica" title="Duge pauze u govoru se izrežu"><input type="checkbox" data-p="zbij_pauze" ${x.zbij_pauze !== false ? 'checked' : ''}> zbij pauze</label>
      </div>
      <details class="rl-titlovi" data-i="${i}"><summary>Ispravi titlove</summary><div class="rl-titlovi__lista"></div></details>
    </li>`).join('');
  oznaciTranskript();
}

function oznakaIsjecka(i, x, g) {
  if (x.ukljuci === false) return '';
  if (izmijenjeni.has(i)) return 'izmijenjen';
  if (!g.has(i + 1) || (uIzradi.has(i) && (posao.zahtjev || posao.stanje === 'radi'))) return 'pravi se';
  return '✓ reel';
}

function izaberi(i, premotaj = true) {
  aktivan = i;
  $$('.rl-isj').forEach(li => li.classList.toggle('aktivan', +li.dataset.i === i));
  if (premotaj && posao.isjecci[i]) skoci(posao.isjecci[i].od);
  oznaciTranskript(); crtajIzrez();
}

function crtajIzrez() {
  const x = posao?.isjecci[aktivan], el = $('#rl-izrez');
  if (!x || x.kadar === 'okvir' || !posao.sirina) { el.hidden = true; return; }
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
  $('#rl-transkript span.u')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function oznaci(i) {
  izmijenjeni.add(i);
  const o = $(`.rl-isj[data-i="${i}"] .rl-oznaka`); if (o) o.textContent = 'izmijenjen';
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
  x.titlovi = null;                         // radnik ih slaže iznova (i AI ispravi novi dio) pri izradi
  const li = $(`.rl-isj[data-i="${i}"]`);
  li.querySelector('[data-t="od"]').value = fmt(x.od);
  li.querySelector('[data-t="do"]').value = fmt(x.do);
  li.querySelector('.rl-trajanje').textContent = `${trajanje(x).toFixed(0)} s`;
  const det = li.querySelector('details.rl-titlovi'); if (det.open) crtajTitlove(i, det);
  skoci(polje === 'od' ? x.od : Math.max(x.od, x.do - 3));
  oznaci(i); oznaciTranskript(); sacuvaj();
}

function crtajTitlove(i, det) {
  const x = posao.isjecci[i];
  det.querySelector('.rl-titlovi__lista').innerHTML = x.titlovi?.length
    ? x.titlovi.map((g, k) => `<div><small>${fmt(g.t0)}</small><input type="text" data-titl="${k}" value="${esc(g.tekst)}"></div>`).join('')
    : '<small>Titlovi za novi raspon se slože pri izradi (AI prvo ispravi riječi). Klikni „Napravi izmijenjene“, pa ih ovdje možeš popraviti.</small>';
}

function crtajGotove() {
  const g = posao.gotovi || [];
  $('#rl-gotovi').hidden = !g.length;
  $('#rl-gotovi-broj').textContent = g.length ? `(${g.length})` : '';
  $('#rl-mreza').innerHTML = g.map(x => `<figure>
    <video src="${esc(x.url || '')}" controls playsinline preload="metadata"></video>
    <figcaption><b>#${x.br}</b> ${esc(posao.isjecci[x.br - 1]?.naslov || x.ime)}
      <span class="sitno">${x.trajanje ? `${Math.round(x.trajanje)} s · ` : ''}${x.velicina ? mb(x.velicina) : ''}</span>
      ${x.preuzmi ? `<a class="dugme" href="${esc(x.preuzmi)}" download="${esc(x.ime)}">Preuzmi</a>` : ''}</figcaption></figure>`).join('');
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
  $('#rl-nazad').addEventListener('click', () => { history.replaceState(null, '', '#reels'); zatvoriPosao(); });

  $('#rl-napravi').addEventListener('click', async () => {
    clearTimeout(cuvanjeT); cuvanjeT = null; await cuvanje;
    const r = await posalji('napravi');
    if (r?.ok) { uIzradi = new Set(izmijenjeni); izmijenjeni = new Set(); posao.zahtjev = 'napravi'; crtajStanjePosla(); crtajIsjecke(); }
  });
  $('#rl-ponovo').addEventListener('click', async () => {
    if (!confirm('AI će ponovo izabrati isječke, a trenutni (i tvoje izmjene) se brišu. Nastaviti?')) return;
    try { await api('predlozi', { id: posao.id }); posao.zahtjev = 'predlozi'; crtajStanjePosla(); } catch (e) { poruka(e.message, true); }
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
  $('#rl-tema').addEventListener('change', e => { posao.tema = e.target.value.trim(); posao.tema_rucno = true; posao.isjecci.forEach((_, i) => oznaci(i)); sacuvaj(); });
  $('#rl-dodaj').addEventListener('click', () => {
    const t = vrijeme();
    posao.isjecci.push({ od: t, do: Math.min(t + 45, posao.trajanje || t + 45), naslov: '', tip: '', poenta: '', zasto: '', ukljuci: true, kadar: 'traka', pozicija: 0.5 });
    posao.isjecci.sort((a, b) => a.od - b.od);
    const i = posao.isjecci.findIndex(x => x.od === t);
    oznaci(i); crtajIsjecke(); izaberi(i, false); sacuvaj();
  });
  $('#rl-transkript').addEventListener('click', e => { const s = e.target.closest('span[data-t]'); if (s) { krajPustanja = null; skoci(+s.dataset.t); } });

  const ol = $('#rl-isjecci');
  ol.addEventListener('click', e => {
    const li = e.target.closest('.rl-isj'); if (!li) return;
    const i = +li.dataset.i, x = posao.isjecci[i], b = e.target.closest('button');
    if (i !== aktivan) izaberi(i, !b && !['INPUT', 'SELECT', 'SUMMARY'].includes(e.target.tagName));
    if (!b) return;
    if (b.dataset.a === 'pusti') pustiDijelove(dijeloviOd(x));
    else if (b.dataset.a === 'kraj') pusti(Math.max(x.od, x.do - 4), x.do);
    else if (b.dataset.a === 'bezrezova') { x.dijelovi = null; x.titlovi = null; oznaci(i); crtajIsjecke(); izaberi(i, false); sacuvaj(); }
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
      x.dijelovi = dij; x.od = dij[0][0]; x.do = dij[dij.length - 1][1]; x.titlovi = null;
      oznaci(i); crtajIsjecke(); izaberi(i, false);
      const det = $(`.rl-isj[data-i="${i}"] details.rl-montaza`); if (det) det.open = true;
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
    if (p === 'zbij_pauze') { x.titlovi = null; li.querySelector('.rl-trajanje').textContent = `${trajanje(x).toFixed(0)} s`; }
    if (p === 'ukljuci' || p === 'kadar') crtajIsjecke();
    oznaci(i); crtajIzrez(); sacuvaj();
  });
  ol.addEventListener('input', e => {
    if (e.target.type !== 'range') return;
    const i = +e.target.closest('.rl-isj').dataset.i;
    posao.isjecci[i].pozicija = +e.target.value; if (i === aktivan) crtajIzrez();
  });
  ol.addEventListener('toggle', e => { if (e.target.open && e.target.matches('details.rl-titlovi')) crtajTitlove(+e.target.dataset.i, e.target); }, true);
}

/* ---------- ulaz: tab i adresa (#reels, #reels?id=…) ---------- */
function otvori(id) {
  history.replaceState(null, '', `#reels?id=${id}`);
  otvoriPosao(id).catch(e => poruka(e.message, true));
}

function zatvoriPosao() {
  posao = null; aktivan = -1; izmijenjeni = new Set();
  player?.pauseVideo?.();
  $('#rl-detalj').hidden = true; $('#rl-pocetak').hidden = false;
}

async function korak() {
  if (!otvoren || ucitavam || document.hidden) return;
  if (!$('section[data-pogled="reels"]') || $('section[data-pogled="reels"]').hidden) { otvoren = false; clearInterval(anketa); return; }
  ucitavam = true;
  try {
    await osvjeziListu();
    if (posao) await otvoriPosao(posao.id, true);
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
  anketa = setInterval(korak, 4000);
}
