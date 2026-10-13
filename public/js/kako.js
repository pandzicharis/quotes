/* ============================================================
   „Pogledaj kako“ — instalacija odigrana na telefonu
   ------------------------------------------------------------
   Preglednik s otvorenom stranicom → meni → „Dodaj na početni
   ekran“ → potvrda → početni ekran na kojem iskoči ikonica Poruke
   dana. Vrti se u krug; ispod telefona stoji korak koji se upravo
   odigrava, pa se animacija i uputa čitaju kao jedno.

   Sistemski ekrani prate originale: iOS (Safari, lista dijeljenja,
   tastatura, tamni način) i Chrome na Androidu (Material You, tamni),
   s engleskim natpisima — istim koje navode koraci u uvodu, pa korisnik
   traži tačno ono što je upravo vidio. Isto kao u Stihu dana.

   Učitava se tek na zahtjev (dinamički import iz app.js, 16. UVOD) —
   instalirana aplikacija ovaj kod nikad ne preuzme. Sve mjere su u
   `em`: 1em je jedan piksel ekrana telefona, pa telefon stane u bilo
   koju visinu ekrana bez ijedne posebne mjere.
   ============================================================ */

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = '/css/kako.css';
const cssSpreman = new Promise(r => { css.onload = css.onerror = r; });
document.head.appendChild(css);

const FAZE = ['strana', 'dodirMeni', 'meni', 'skrol', 'dodirDodaj', 'dijalog', 'dodirPotvrdi', 'pocetni'];
/** kad koja faza počinje, u sekundama */
const KAD = [0, 2.0, 2.5, 3.5, 4.7, 5.3, 7.6, 8.2];
/** jedan krug: instalacija (~9 s), pa predah na početnom ekranu s novom ikonicom */
const KRUG = 11000;

/** iPhone 16 Pro i Galaxy S25 — ekran u CSS pikselima */
const UREDJAJ = {
  ios: { w: 402, h: 874, rub: 3.5, okvir: 11, r: 54, rubR: 68, okvirR: 64.5, traka: 50 },
  and: { w: 384, h: 832, rub: 3, okvir: 8, r: 34, rubR: 44, okvirR: 41, traka: 34 },
};

const HOST = location.host;
const SAT = '12:00';
const IOS_PLAVA = '#0A84FF';

/** Koji korak upute odgovara kojoj fazi animacije. */
const korakFaze = f => (f === 'strana' || f === 'dodirMeni' ? 0
  : f === 'meni' || f === 'skrol' || f === 'dodirDodaj' ? 1 : 2);

/* Koraci dolaze iz uvoda (app.js) — isti tekst na sva tri mjesta. Ovi su
   samo rezerva ako se modul otvori sam. */
const glif = id => `<svg class="glif" aria-hidden="true"><use href="#${id}"/></svg>`;
const KORACI = {
  ios: [
    `Dodirni ${glif('i-ios-dijeli')} na dnu Safarija`,
    'Skrolaj i odaberi <b>Add to Home Screen</b>',
    'Potvrdi sa <b>Add</b>, pa otvori ikonu',
  ],
  and: [
    `Dodirni ${glif('i-meni')} gore desno u Chromeu`,
    'Odaberi <b>Add to Home screen</b>',
    'Potvrdi sa <b>Install</b>, pa otvori ikonu',
  ],
};

/* ---------- sitni dijelovi ---------- */

/** SF/Material znak: jedna putanja u mreži 24×24, veličina u pikselima ekrana. */
const sym = (d, size, boja, w = 1.7, puna = false) => `
  <svg class="kd-sym" viewBox="0 0 24 24" style="width:${size}em;height:${size}em;color:${boja}"
       fill="${puna ? 'currentColor' : 'none'}" stroke="${puna ? 'none' : 'currentColor'}"
       stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

/** Tekst u pikselima ekrana. Unutra ne smije ništa u `em` — veličina bi se množila. */
const t = (tekst, px, extra = '') => `<span class="kd-t" style="font-size:${px}em;${extra}">${tekst}</span>`;

/**
 * Superelipsa kao maska ikonice. iOS ima „kontinuirane“ uglove (n≈5), a ne
 * obični border-radius; One UI je nešto obliji (n≈4).
 */
function superelipsa(n) {
  let d = '';
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const x = 50 + 50 * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = 50 + 50 * Math.sign(s) * Math.abs(s) ** (2 / n);
    d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='${d}Z'/></svg>`;
  // jednostruki navodnici: ovo ide u style="…" atribut
  return `url('data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}')`;
}
const MASKA = { ios: superelipsa(5), and: superelipsa(4) };
const maska = p => `-webkit-mask-image:${MASKA[p]};mask-image:${MASKA[p]};-webkit-mask-size:100% 100%;mask-size:100% 100%;`;

/** Ikonica Poruke dana onako kako je sistem crta na početnom ekranu. */
const appIkona = (p, size, radius) => `
  <img class="kd-app" src="${p === 'ios' ? '/assets/icons/apple-touch-icon.png' : '/assets/icons/icon-maskable-512.png'}"
       alt="" style="width:${size}em;height:${size}em;${radius ? `border-radius:${radius}em;` : maska(p)}">`;

/** Sistemska ikonica s gradijentom i bijelim znakom. */
const sysIkona = (p, size, bg, d, boja = '#fff') => `
  <span class="kd-sys" style="width:${size}em;height:${size}em;background:${bg};${maska(p)}">
    ${sym(d, size * 0.52, boja, 2)}</span>`;

/** Dodir — kao „Show touches“ na snimku ekrana. Bez x/y sjedi u sredini roditelja. */
const dodir = (p, faza, x, y) => `<i class="kd-dodir kd-dodir--${p}" data-u="${faza}"
  style="${x === undefined ? '' : `left:${x}em;top:${y}em;`}"></i>`;

/* ---------- okvir telefona ---------- */

const signal = s => `<svg viewBox="0 0 18 12" style="width:${18 * s}em;height:${12 * s}em" fill="currentColor">
  <rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/>
  <rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>`;
const wifi = s => `<svg viewBox="0 0 16 12" style="width:${16 * s}em;height:${12 * s}em" fill="currentColor">
  <path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.3-1.4A10.8 10.8 0 0 0 8 .3 10.8 10.8 0 0 0 .4 3.3l1.3 1.4A9 9 0 0 1 8 2.2z"/>
  <path d="M8 5.6c1.5 0 2.8.5 3.9 1.5l1.3-1.4A7.6 7.6 0 0 0 8 3.7a7.6 7.6 0 0 0-5.2 2l1.3 1.4A5.7 5.7 0 0 1 8 5.6z"/>
  <path d="M8 9a2.3 2.3 0 0 1 1.6.6L8 11.4 6.4 9.6A2.3 2.3 0 0 1 8 9z"/></svg>`;
const baterija = s => `<svg viewBox="0 0 27 13" style="width:${27 * s}em;height:${13 * s}em" fill="none">
  <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" stroke="currentColor" opacity="0.4"/>
  <rect x="2.2" y="2.2" width="15" height="8.6" rx="2.2" fill="currentColor"/>
  <path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" fill="currentColor" opacity="0.45"/></svg>`;

const statusIos = () => `
  <div class="kt-status kt-status--ios">${t(SAT, 17, 'font-weight:600;letter-spacing:-0.01em')}
    <span class="kt-status__ik">${signal(1)}${wifi(1)}${baterija(1)}</span></div>`;
const statusAnd = () => `
  <div class="kt-status kt-status--and">${t(SAT, 13.5, 'font-weight:500')}
    <span class="kt-status__ik">${wifi(.82)}${signal(.82)}${baterija(.82)}</span></div>`;

function telefon(p, ekran, sirina) {
  const U = UREDJAJ[p];
  const ow = U.w + 2 * (U.rub + U.okvir), oh = U.h + 2 * (U.rub + U.okvir);
  const dugme = (strana, top, h, blijedo) =>
    `<i class="kt__dugme kt__dugme--${p}" style="${strana}:-2.6em;top:${top}em;height:${h}em;${blijedo ? 'opacity:.7' : ''}"></i>`;
  const dugmad = p === 'ios'
    ? dugme('left', 168, 34) + dugme('left', 228, 62) + dugme('left', 302, 62) + dugme('right', 258, 98) + dugme('right', 540, 74, true)
    : dugme('right', 200, 112) + dugme('right', 330, 58);
  return `
    <div class="kt kt--${p}" style="font-size:calc(${sirina} / ${ow});width:${ow}em;height:${oh}em">
      ${dugmad}
      <div class="kt__rub" style="border-radius:${U.rubR}em;padding:${U.rub}em">
        <div class="kt__okvir" style="border-radius:${U.okvirR}em;padding:${U.okvir}em">
          <div class="kt__ekran" style="width:${U.w}em;height:${U.h}em;border-radius:${U.r}em">
            ${ekran}
            ${p === 'ios' ? statusIos() : statusAnd()}
            ${p === 'ios' ? '<i class="kt__otok"><i></i></i>' : '<i class="kt__rupica"></i>'}
            <i class="kt__staklo"></i>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------- naša stranica u malom ---------- */
/* Uvod s korakom instalacije — ono što animacija „otvori“ u pregledniku. */
function strana(p, koraci) {
  const U = UREDJAJ[p];
  const vrh = p === 'ios' ? U.traka : U.traka + 60;
  return `
    <div class="ks" style="top:${vrh}em;padding:48em 32em ${p === 'ios' ? 96 : 0}em">
      <img class="ks__znak" src="/assets/brand/ammar_basic_logo_w_m_1.png" alt="">
      <div class="ks__sredina">
        ${t('Jedna poruka, svaki dan', 20, 'font-family:var(--serif);display:block;line-height:1.35;color:rgba(242,236,224,.88)')}
        <i class="ks__crta"></i>
        <ol class="ks__koraci">
          ${koraci.map((k, i) => `
            <li><span class="ks__br">${t(String(i + 1), 10, 'font-weight:600')}</span>
                ${t(k, 13, 'line-height:1.5;color:rgba(242,236,224,.58);text-align:left')}</li>`).join('')}
        </ol>
      </div>
    </div>`;
}

/* ---------- iOS ---------- */

const IOS_SEP = 'rgba(84,84,88,0.65)';
const IOS_SIVA = 'rgba(235,235,245,0.6)';

function safariTraka() {
  return `
    <div class="kd-safari">
      <div class="kd-safari__polje">
        ${sym('M7 3.5h7.5L19 8v12.5H7zM14.5 3.5V8H19M10 12h6M10 15.5h6', 19, '#fff', 1.8)}
        <span class="kd-safari__adr">${t(HOST, 16.5, 'letter-spacing:-0.01em')}</span>
        ${sym('M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.5H15', 17, '#fff', 2)}
      </div>
      <div class="kd-safari__alati">
        ${sym('m15 19-7-7 7-7', 23, 'rgba(235,235,245,0.3)', 2.2)}
        ${sym('m9 19 7-7-7-7', 23, 'rgba(235,235,245,0.3)', 2.2)}
        <span class="kd-cilj">${sym('M12 3v12.5M8 7l4-4 4 4M8.5 10H6.5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5h-2', 25, IOS_PLAVA, 1.9)}${dodir('ios', 'dodirMeni')}</span>
        ${sym('M12 6.5C10.5 5 8 4.5 3.5 4.5v14c4.5 0 7 .5 8.5 2 1.5-1.5 4-2 8.5-2v-14c-4.5 0-7 .5-8.5 2zM12 6.5v14', 25, IOS_PLAVA, 1.8)}
        ${sym('M8.5 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h8.5A1.5 1.5 0 0 1 20 5.5V14a1.5 1.5 0 0 1-1.5 1.5h-2M5.5 8.5H14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 14 20H5.5A1.5 1.5 0 0 1 4 18.5V10a1.5 1.5 0 0 1 1.5-1.5z', 24, IOS_PLAVA, 1.8)}
      </div>
    </div>`;
}

/** Ikonice iz iOS-ovog reda aplikacija — Poruke s pravim oblačićem, ostale znakom. */
const iosPoruke = size => `
  <span class="kd-sys" style="width:${size}em;height:${size}em;${maska('ios')}">
    <svg viewBox="0 0 100 100" style="width:100%;height:100%;display:block">
      <defs><linearGradient id="kd-msg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5DF376"/><stop offset="1" stop-color="#0BBF2E"/></linearGradient></defs>
      <rect width="100" height="100" fill="url(#kd-msg)"/>
      <g fill="#fff"><ellipse cx="50" cy="47" rx="32" ry="26.5"/><path d="M28 63c-1 7-5 12-10 15 8 1 16-2 21-8z"/></g>
    </svg></span>`;

function iosListaDijeljenja() {
  const ljudi = [['AirDrop', ''], ['Emina', 'E'], ['Kenan', 'K'], ['Selma', 'S']];
  const plocica = (ime, sadrzaj) => `
    <span class="kd-plocica">${sadrzaj}${t(ime, 11, 'margin-top:0.65em;white-space:nowrap')}</span>`;
  const krug = (bg, unutra) => `<span class="kd-krug" style="background:${bg}">${unutra}</span>`;
  const grupa = (redovi, cilj) => `
    <div class="kd-grupa">${redovi.map(([tekst, d]) => `
      <div class="kd-red${tekst === cilj ? ' kd-red--cilj' : ''}">
        ${t(tekst, 17, 'letter-spacing:-0.02em')}${sym(d, 22, '#fff', 1.6)}
        ${tekst === cilj ? dodir('ios', 'dodirDodaj') : ''}
      </div>`).join('')}
    </div>`;
  return `
    <div class="kd-ios-zag">
      ${appIkona('ios', 46, 9)}
      <div class="kd-ios-zag__ime">
        ${t('Poruka dana · Ammar Bašić', 15, 'font-weight:600;letter-spacing:-0.01em;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}
        ${t(HOST, 13, `color:${IOS_SIVA};display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}
        ${t('Options ›', 13, `color:${IOS_PLAVA};display:block`)}
      </div>
      <span class="kd-ios-zag__x">${sym('M7.5 7.5l9 9M16.5 7.5l-9 9', 14, 'rgba(235,235,245,0.6)', 3)}</span>
    </div>
    <div class="kd-niz">
      ${ljudi.map(([ime, slovo]) => plocica(ime, slovo
        ? krug('linear-gradient(180deg,#A5ABB8,#858994)', t(slovo, 25, 'font-weight:500'))
        : krug('linear-gradient(180deg,#3EB4FF,#0A6CFF)', sym('M12 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zM8.8 15.6a4.5 4.5 0 1 1 6.4 0M6.2 18.2a8.2 8.2 0 1 1 11.6 0', 34, '#fff', 1.8)))).join('')}
    </div>
    <div class="kd-niz kd-niz--crta">
      ${plocica('Messages', iosPoruke(62))}
      ${plocica('Mail', sysIkona('ios', 62, 'linear-gradient(180deg,#3EB4FF,#0A6CFF)', 'M3.5 6.5h17v11h-17zM3.5 6.5l8.5 6.5 8.5-6.5'))}
      ${plocica('Notes', sysIkona('ios', 62, 'linear-gradient(180deg,#FFE680,#FFD20A)', 'M7 4h10v16H7zM9.5 9h5M9.5 12.5h5M9.5 16h3'))}
      ${plocica('Reminders', sysIkona('ios', 62, 'linear-gradient(180deg,#FFFFFF,#F2F2F7)', 'M6 7h.01M10 7h8M6 12h.01M10 12h8M6 17h.01M10 17h8', '#FF9F0A'))}
    </div>
    <div class="kd-grupe">
      ${grupa([['Copy', 'M9 9h10.5v11.5H9zM15 9V4.5H4.5V15H9']])}
      ${grupa([
        ['Add to Reading List', 'M3.5 14a3 3 0 1 0 6 0 3 3 0 0 0-6 0zM14.5 14a3 3 0 1 0 6 0 3 3 0 0 0-6 0zM9.5 14h5'],
        ['Add Bookmark', 'M12 6.5C10.5 5 8 4.5 3.5 4.5v14c4.5 0 7 .5 8.5 2 1.5-1.5 4-2 8.5-2v-14c-4.5 0-7 .5-8.5 2zM12 6.5v14'],
        ['Add to Favourites', 'm12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z'],
        ['Add to Quick Note', 'M5 4h14v16H5zM9 4v16M12 9h4M12 13h4'],
        ['Find on Page', 'M6 3.5h8l4 4v13H6zM11 16a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6zM13 15.5l2.2 2.2'],
        ['Add to Home Screen', 'M5.5 3.5h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM12 8v8M8 12h8'],
        ['Markup', 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'],
        ['Print', 'M7 9V3.5h10V9M7 17H4.5V9h15v8H17M7 14h10v6.5H7z'],
      ], 'Add to Home Screen')}
    </div>
    <i class="kd-dodir kd-dodir--ios kd-dodir--skrol"></i>`;
}

/** Tastatura (tamna) — iskoči s poljem za ime, kao na pravom iPhoneu. */
function iosTastatura() {
  const redovi = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const tipka = (sadrzaj, extra = '') => `<span class="kd-tipka" style="${extra}">${sadrzaj}</span>`;
  const fn = 'background:#464649;';
  return `
    <div class="kd-tastatura">
      <div class="kd-tastatura__redovi">
        ${redovi.map((r, k) => `
          <div class="kd-tastatura__red">
            ${k === 2 ? tipka(sym('M12 4 4.5 12H9v7h6v-7h4.5z', 19, '#fff', 1.7), `${fn}width:44em;margin-right:8em`) : ''}
            ${r.split('').map(c => tipka(t(c, 22.5), 'width:34em')).join('')}
            ${k === 2 ? tipka(sym('M9 5.5h11v13H9L3.5 12zM12 9.5l5 5M17 9.5l-5 5', 21, '#fff', 1.6), `${fn}width:44em;margin-left:8em`) : ''}
          </div>`).join('')}
        <div class="kd-tastatura__red">
          ${tipka(t('123', 16), `${fn}width:92em`)}
          ${tipka(t('space', 16), 'flex:1')}
          ${tipka(t('done', 16), `background:${IOS_PLAVA};width:92em`)}
        </div>
      </div>
      <div class="kd-tastatura__dno">
        ${sym('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01', 27, 'rgba(235,235,245,0.8)', 1.6)}
        ${sym('M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5V21', 27, 'rgba(235,235,245,0.8)', 1.6)}
      </div>
    </div>`;
}

function iosPotvrda() {
  return `
    <div class="kd-potvrda__vrh">
      ${t('Cancel', 17, `color:${IOS_PLAVA}`)}
      <span class="kd-potvrda__nas">${t('Add to Home Screen', 17, 'font-weight:600;letter-spacing:-0.02em')}</span>
      <span class="kd-cilj">${t('Add', 17, `font-weight:600;color:${IOS_PLAVA}`)}${dodir('ios', 'dodirPotvrdi')}</span>
    </div>
    <div class="kd-potvrda__polje">
      ${appIkona('ios', 60, 13)}
      <div class="kd-potvrda__tekst">
        <div class="kd-potvrda__ime">
          ${t('Poruka dana', 17)}<i class="kd-kursor"></i><span style="flex:1"></span>
          <span class="kd-potvrda__brisi">${sym('M8 8l8 8M16 8l-8 8', 11, '#2C2C2E', 3.4)}</span>
        </div>
        ${t(`https://${HOST}/`, 15, `color:${IOS_SIVA};display:block;margin-top:0.6em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}
      </div>
    </div>
    ${t('An icon will be added to your Home Screen so you can quickly access this website.', 13, `display:block;margin:0.6em 1.25em 0;color:${IOS_SIVA};line-height:1.35`)}
    ${iosTastatura()}`;
}

/* ---------- Chrome na Androidu (Material You, tamni) ---------- */

const M_ON = '#E3E3E3';
const M_VAR = '#C4C7C5';
const M_PRIM = '#A8C7FA';

function chromeTraka(top) {
  return `
    <div class="kd-chrome" style="top:${top}em">
      ${sym('M4.5 11 12 4.5l7.5 6.5M6.5 9.5V19.5h4v-5h3v5h4V9.5', 22, M_ON, 1.8)}
      <div class="kd-chrome__polje">
        ${sym('M4 7.5h9M17 7.5h3M15 5.5v4M4 16.5h3M11 16.5h9M9 14.5v4', 18, M_VAR, 1.8)}
        ${t(HOST, 15.5, 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}
      </div>
      <span class="kd-chrome__tabovi">${t('1', 11.5, 'font-weight:700')}</span>
      <span class="kd-cilj kd-chrome__meni">${sym('M12 5h.01M12 12h.01M12 19h.01', 24, M_ON, 3.2)}${dodir('and', 'dodirMeni')}</span>
    </div>`;
}

function chromeMeni() {
  const stavke = [
    ['New tab', 'M5 5h14v14H5zM12 9v6M9 12h6'],
    ['New Incognito tab', 'M4 14a3 3 0 1 0 6 0 3 3 0 0 0-6 0zM14 14a3 3 0 1 0 6 0 3 3 0 0 0-6 0zM10 14h4M3 10h18l-2-5H5z'],
    ['History', 'M12 21a9 9 0 1 0-9-9M3 4v5h5M12 7v5l3 2'],
    ['Delete browsing data', 'M6 7h12l-1 13H7zM4 7h16M10 4h4'],
    ['Downloads', 'M12 4v11M7 10l5 5 5-5M5 20h14'],
    ['Bookmarks', 'M6.5 3.5h11v17L12 16.5l-5.5 4z'],
    ['Recent tabs', 'M4 6h16v12H4zM4 10h16'],
    ['Share…', 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4'],
    ['Find in page', 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20'],
    ['Add to Home screen', 'M7 2.5h10a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V4A1.5 1.5 0 0 1 7 2.5zM12 8.5v7M8.5 12h7'],
    ['Desktop site', 'M3.5 5h17v11h-17zM9 20h6M12 16v4'],
    ['Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1'],
  ];
  const vrh = ['M5 12h14M13 6l6 6-6 6', 'm12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z',
               'M12 4v11M7 10l5 5 5-5M5 20h14', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
               'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.5H15'];
  return `
    <div class="kd-meni">
      <div class="kd-meni__vrh">${vrh.map(d => sym(d, 21, M_ON, 1.8)).join('')}</div>
      ${stavke.map(([tekst, d]) => {
        const cilj = tekst === 'Add to Home screen';
        return `<div class="kd-meni__red${cilj ? ' kd-red--cilj' : ''}">
          ${sym(d, 21, M_VAR, 1.7)}${t(tekst, 15.5)}${cilj ? dodir('and', 'dodirDodaj', 120, 23) : ''}</div>`;
      }).join('')}
    </div>`;
}

function chromeDijalog() {
  return `
    <div class="kd-and-dijalog">
      <div class="kd-and-dijalog__karta">
        ${t('Install app', 24, 'display:block;line-height:1.33')}
        <div class="kd-and-dijalog__app">
          ${appIkona('and', 48)}
          <div style="min-width:0">
            ${t('Poruka dana', 16, 'display:block')}
            ${t(HOST, 14, `display:block;color:${M_VAR};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}
          </div>
        </div>
        <div class="kd-and-dijalog__dugmad">
          <span class="kd-and-dijalog__dugme">${t('Cancel', 14.5, `color:${M_PRIM};font-weight:500`)}</span>
          <span class="kd-and-dijalog__dugme kd-cilj">${t('Install', 14.5, `color:${M_PRIM};font-weight:500`)}${dodir('and', 'dodirPotvrdi')}</span>
        </div>
      </div>
    </div>`;
}

/* ---------- početni ekran ---------- */
/* Tapeta, Poruka dana na prvom mjestu i dock. Druge ikonice u mreži ne
   trebaju — oko jedne ikonice pogled nema šta tražiti. */
function pocetni(p) {
  const U = UREDJAJ[p];
  const ios = p === 'ios';
  const size = ios ? 62 : 58, strana = ios ? 27 : 26;
  const korak = size + (U.w - 2 * strana - 4 * size) / 3;
  const y = ios ? U.traka + 22 : U.traka + 64;
  const dockIos = [
    sysIkona('ios', size, 'linear-gradient(180deg,#5DF376,#0BBF2E)', 'M6.6 3.5h2.6l1.6 4.2-2 1.4a10.5 10.5 0 0 0 5.1 5.1l1.4-2 4.2 1.6v2.6a2 2 0 0 1-2 2A15.6 15.6 0 0 1 4.6 5.5a2 2 0 0 1 2-2z'),
    sysIkona('ios', size, 'linear-gradient(180deg,#FFFFFF,#E3E3E8)', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.8 8.2l-2 5.6-5.6 2 2-5.6z', IOS_PLAVA),
    iosPoruke(size),
    sysIkona('ios', size, 'linear-gradient(180deg,#FB5C74,#FA233B)', 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z'),
  ];
  const dockAnd = [
    ['linear-gradient(180deg,#4CD07A,#1FA35A)', 'M6.6 3.5h2.6l1.6 4.2-2 1.4a10.5 10.5 0 0 0 5.1 5.1l1.4-2 4.2 1.6v2.6a2 2 0 0 1-2 2A15.6 15.6 0 0 1 4.6 5.5a2 2 0 0 1 2-2z'],
    ['linear-gradient(180deg,#4F8DFD,#2A5BEA)', 'M4 5h16v11H9l-5 4z'],
    ['linear-gradient(180deg,#8C7BFF,#5B45E0)', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z'],
    ['linear-gradient(180deg,#FF6B6B,#E5383B)', 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  ];
  return `
    <div class="kd-pocetni kd-pocetni--${p}">
      <div class="kd-pocetni__mjesto" style="left:${strana}em;top:${y}em;width:${size}em">
        <span class="kd-pocetni__ik">${appIkona(p, size)}</span>
        <span class="kd-pocetni__ime">${t('Poruka dana', ios ? 12 : 12.5, ios ? 'letter-spacing:0.01em' : 'text-shadow:0 1px 2px rgba(0,0,0,.5)')}</span>
      </div>
      ${ios ? `
        <div class="kd-pocetni__trazi">${sym('M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20', 12, '#fff', 2.4)}${t('Search', 13, 'font-weight:500')}</div>
        <div class="kd-pocetni__dock">
          ${dockIos.map((h, k) => `<span style="position:absolute;left:${strana - 12 + k * korak}em;top:17em">${h}</span>`).join('')}
        </div>`
      : `
        <div class="kd-pocetni__tacke"><i></i><i style="opacity:.35"></i></div>
        ${dockAnd.map(([bg, d], k) => `<span style="position:absolute;left:${strana + k * korak}em;bottom:44em">${sysIkona('and', size, bg, d)}</span>`).join('')}
        <i class="kd-pocetni__gest"></i>`}
    </div>`;
}

/* ---------- jedan prolaz animacije ---------- */

function demo(p) {
  const U = UREDJAJ[p];
  const el = document.createElement('div');
  el.className = `kd kd--${p}`;
  el.style.setProperty('--vrh', U.traka);
  el.style.setProperty('--visina', U.h);
  el.innerHTML = p === 'ios' ? `
    ${safariTraka()}
    <div class="kd-list kd-list--dijeli"><i class="kd-list__zav"></i>
      <div class="kd-list__ploca">${iosListaDijeljenja()}</div></div>
    <div class="kd-list kd-list--potvrda"><i class="kd-list__zav"></i>
      <div class="kd-list__ploca">${iosPotvrda()}</div></div>
    ${pocetni(p)}`
  : `
    ${chromeTraka(U.traka)}
    <div class="kd-meni-drzac" style="top:${U.traka + 6}em">${chromeMeni()}</div>
    ${chromeDijalog()}
    ${pocetni(p)}`;
  return el;
}

function postaviFazu(el, i) {
  const osnova = el.className.split(' ').filter(c => !/^(p|na)-/.test(c));
  el.className = [...osnova, ...FAZE.slice(0, i + 1).map(f => `p-${f}`), `na-${FAZE[i]}`].join(' ');
}

/* ---------- prozor ---------- */

/**
 * Otvara animaciju preko cijelog ekrana. `platforma` je 'ios' ili 'and'.
 * Vraća funkciju koja je zatvara.
 */
export async function pokaziKako(platforma, { povratak, koraci: izUvoda } = {}) {
  await cssSpreman;
  const p = platforma === 'ios' ? 'ios' : 'and';
  const U = UREDJAJ[p];
  const ow = U.w + 2 * (U.rub + U.okvir), oh = U.h + 2 * (U.rub + U.okvir);
  const koraci = izUvoda || KORACI[p];
  // telefon staje u visinu ekrana zajedno s tekstom i dugmetom ispod
  const sirina = `max(9rem, min(16.5rem, calc((100dvh - 14rem) * ${(ow / oh).toFixed(4)})))`;

  const sloj = document.createElement('div');
  sloj.className = 'kako';
  sloj.setAttribute('role', 'dialog');
  sloj.setAttribute('aria-modal', 'true');
  sloj.setAttribute('aria-label', `Kako dodati Poruku dana na početni ekran — ${p === 'ios' ? 'iPhone' : 'Android'}`);
  sloj.innerHTML = `
    <div class="kako__blok">
      ${telefon(p, `${strana(p, koraci)}<div class="kd-drzac"></div>`, sirina)}
      <div class="kako__napredak" aria-hidden="true">${koraci.map(() => '<i></i>').join('')}</div>
      <p class="kako__korak" aria-live="polite"></p>
      <button class="kako__zatvori" type="button">Zatvori</button>
    </div>`;
  document.body.appendChild(sloj);

  const drzac = sloj.querySelector('.kd-drzac');
  const tekst = sloj.querySelector('.kako__korak');
  const crtice = [...sloj.querySelectorAll('.kako__napredak i')];
  let tajmeri = [];
  let korak = -1;

  const pokaziKorak = k => {
    if (k === korak) return;
    korak = k;
    crtice.forEach((c, i) => { c.className = i === k ? 'on' : i < k ? 'bilo' : ''; });
    tekst.classList.remove('ulaz');
    void tekst.offsetWidth;                          // restart animacije teksta
    tekst.innerHTML = koraci[k];
    tekst.classList.add('ulaz');
  };

  const krug = () => {
    const stari = drzac.lastElementChild;
    const novi = demo(p);
    postaviFazu(novi, 0);
    drzac.appendChild(novi);
    if (stari) {
      stari.classList.add('kd--van');
      setTimeout(() => stari.remove(), 450);
    }
    pokaziKorak(0);
    KAD.slice(1).forEach((s, i) => tajmeri.push(setTimeout(() => {
      postaviFazu(novi, i + 1);
      pokaziKorak(korakFaze(FAZE[i + 1]));
    }, s * 1000)));
  };

  krug();
  const interval = setInterval(() => { tajmeri.forEach(clearTimeout); tajmeri = []; krug(); }, KRUG);
  requestAnimationFrame(() => sloj.classList.add('on'));

  const dugme = sloj.querySelector('.kako__zatvori');
  dugme.focus({ preventScroll: true });

  const naTipku = e => { if (e.key === 'Escape') { e.stopPropagation(); zatvori(); } };
  addEventListener('keydown', naTipku, true);

  function zatvori() {
    clearInterval(interval);
    tajmeri.forEach(clearTimeout);
    removeEventListener('keydown', naTipku, true);
    sloj.classList.remove('on');
    setTimeout(() => sloj.remove(), 300);
    povratak?.focus({ preventScroll: true });
  }

  dugme.addEventListener('click', zatvori);
  sloj.addEventListener('click', e => { if (!e.target.closest('.kako__blok > *')) zatvori(); });
  return zatvori;
}
