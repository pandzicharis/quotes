/* ============================================================
   PREDAVANJA — modul aplikacije (iza zastavice PREDAVANJA u app.js)
   ------------------------------------------------------------
   Učitava se tek kad je zastavica uključena, pa korisnicima kojima je
   isključena ne dodaje ni bajt ni zahtjev. Dva odvojena mjesta:

     · PREDAVANJE — jedno predavanje: podaci, plakat, dijeljenje. Otvara ga
       traka „Sljedeće predavanje“, red u kalendaru, obavijest o novom i
       link iz push notifikacije (/?predavanje=<id>).
     · KALENDAR  — nadolazeća predavanja, s filterom po mjesecu i gradu.
       Otvara ga ikonica u zaglavlju.

   Vrijeme je svuda lokalno vrijeme mjesta održavanja, bez preračunavanja.
   ============================================================ */
import {
  ucitajPredavanja, trenutak, proslo, ics, imeZemlje, radiLokalno, TRAJANJE_MS,
  danUSedmici, punDatumP, MJESECI, MJESECI_KRATKO, DANI, hidzriDatum, opcijePlakata,
} from './predavanja-jezgro.js';
import { plakatBlob, imePlakata, mjeriloEkrana } from './plakat.js';
import { STILOVI } from './platno.js';

const VIDJENA = 'pd.predavanjaVidjena';
const GRAD = 'pd.predavanjaGrad';            // filter po gradu u kalendaru ('' = svi)
const OBAVIJESTI = 'pd.predavanjaObavijesti'; // obavijesti za predavanja (null = nije birano, znači da)
const PRACENA = 'pd.predavanjaPracena';       // id-evi predavanja koja korisnik prati (zvjezdica)
const $ = (s, k = document) => k.querySelector(s);
const $$ = (s, k = document) => [...k.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => String(n).padStart(2, '0');
const ikona = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const cita = (k, z) => { try { return JSON.parse(localStorage.getItem(k)) ?? z; } catch { return z; } };
const pisi = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

let app;                       // { otvori, zatvori, postaviPovlacenje, poruka, autor }
let lista = [];
let otvoreno = null;           // predavanje u drawer-u PREDAVANJE
let plakatUrl = '';
let format = 'objava', boja = 'zelena';
let kalMjesec = '';            // filter kalendara: 'YYYY-MM' ili '' za sve mjesece
let kalGrad = cita(GRAD, '');
let kalPrikaz = 'sva';         // kalendar: 'sva' ili 'pracena' (moja predavanja)
const KAL_POGLED = 'pd.kalendarPogled';
let kalPogled = cita(KAL_POGLED, 'lista') === 'plakati' ? 'plakati' : 'lista';   // kalendar kao lista ili kao plakati

const vidjena = () => cita(VIDJENA, []);
function oznaciVidjeno(id) {
  const v = vidjena();
  if (!v.includes(id)) pisi(VIDJENA, [...v, id].slice(-200));
}
const obavijestiUkljucene = () => cita(OBAVIJESTI, true) !== false;
const pracena = () => cita(PRACENA, []);
const prati = id => pracena().includes(id);

/* Izbor obavijesti i praćena predavanja idu serveru uz push pretplatu — po
   njima zna kome šalje „Novo predavanje“, a kome podsjetnik dan prije. Bez
   pretplate (podsjetnik isključen) sve ostaje na uređaju i ide uz sljedeću. */
async function javiServeru() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return false;
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sub.toJSON(), predavanja: obavijestiUkljucene(), pracena: pracena() }),
    });
    return true;
  } catch { return false; }
}

/** Zvjezdica: prati ili pusti predavanje. Osvježava sve zvjezdice za njega. */
function prebaciPracenje(p) {
  if (!p) return;
  const sad = !prati(p.id);
  pisi(PRACENA, sad ? [...pracena(), p.id] : pracena().filter(id => id !== p.id));
  osvjeziZvjezdice();
  crtajTraku();
  // u „Planiram ići“ pušteno predavanje odmah nestaje s liste
  if (kalPrikaz === 'pracena' && $('#m-kalendar')?.classList.contains('on')) crtajKalendar();
  javiServeru();
  if (!sad) { app.poruka('Uklonjeno iz „Planiram ići“', 'i-zvijezda'); return; }
  app.javi?.('prati', `predavanje:${p.id}`);
  const dozvola = 'Notification' in window && Notification.permission === 'granted';
  app.poruka(!obavijestiUkljucene() ? 'Planiraš ići — za podsjetnik uključi obavijesti za predavanja'
    : !dozvola ? 'Planiraš ići — za podsjetnik uključi podsjetnik u postavkama'
    : 'Planiraš ići — podsjetnik stiže dan prije', 'i-zvijezda-f');
}

/** Koliko nadolazećih predavanja korisnik prati. */
const brojPracenih = () => sljedeca().filter(p => prati(p.id)).length;

/** Broj „Planiram ići“ — na tabu u kalendaru i uz ikonicu kalendara. */
function osvjeziBrojPracenih() {
  const n = brojPracenih();
  for (const broj of $$('#kal-broj, [data-broj-pracenih]')) { broj.textContent = n; broj.hidden = !n; }
}

function osvjeziZvjezdice() {
  osvjeziBrojPracenih();
  for (const b of $$('[data-prati]')) {
    const da = prati(Number(b.dataset.prati));
    b.setAttribute('aria-pressed', String(da));
    b.setAttribute('aria-label', da ? 'Ukloni iz „Planiram ići“' : 'Planiram ići');
    $('use', b)?.setAttribute('href', da ? '#i-zvijezda-f' : '#i-zvijezda');
  }
  for (const r of $$('.kal-red[data-pred]')) r.classList.toggle('kal-red--prati', prati(Number(r.dataset.pred)));
}

const sljedeca = (sada = Date.now()) => lista.filter(p => !proslo(p, sada));
const gradDrzava = p => [p.grad, p.drzava !== 'BA' ? imeZemlje(p.drzava) : ''].filter(Boolean).join(', ');

/* --- odbrojavanje (samo u drawer-u predavanja) --- */
function ostatak(p) {
  const ms = trenutak(p).getTime() - Date.now();
  if (ms <= 0) return null;
  // bez sekundi — minute se zaokružuju naviše, pa zadnja minuta ne piše „00 min“
  const min = Math.ceil(ms / 6e4);
  return { d: Math.floor(min / 1440), h: Math.floor(min / 60) % 24, m: min % 60 };
}
function tacno(p) {
  const o = ostatak(p);
  if (!o) return '';
  return `${o.d ? `<b>${o.d}</b> d ` : ''}<b>${p2(o.h)}</b> h <b>${p2(o.m)}</b> min`;
}
function tik() {
  for (const el of $$('[data-za]')) {
    const p = lista.find(x => String(x.id) === el.dataset.za);
    if (p) el.innerHTML = tacno(p);
  }
}

/* ================= KOSTUR: ikonice, stil, drawer-i, ulazi ================= */
function napraviKostur() {
  $('svg symbol')?.parentElement?.insertAdjacentHTML('beforeend', `
    <symbol id="i-kalendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width: var(--ik-sw, 1.7)" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>
    </symbol>
    <symbol id="i-mjesto" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width: var(--ik-sw, 1.7)" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>
    </symbol>
    <symbol id="i-lista" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width: var(--ik-sw, 1.7)" stroke-linecap="round">
      <path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.6" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.6" cy="17.5" r="1.1" fill="currentColor" stroke="none"/>
    </symbol>
    <symbol id="i-mreza" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width: var(--ik-sw, 1.7)" stroke-linejoin="round">
      <rect x="4" y="3.5" width="6.8" height="8.5" rx="1.6"/><rect x="13.2" y="3.5" width="6.8" height="8.5" rx="1.6"/><rect x="4" y="14.5" width="6.8" height="6" rx="1.6"/><rect x="13.2" y="14.5" width="6.8" height="6" rx="1.6"/>
    </symbol>`);

  // box se crta tek kad stil stigne — da se ni na trenutak ne vidi neuređen
  const css = document.createElement('link');
  const stil = new Promise(r => { css.onload = css.onerror = r; });
  css.rel = 'stylesheet'; css.href = '/css/predavanja.css';
  document.head.append(css);

  /* Oba drawer-a imaju fiksno zaglavlje (i kalendar svoje filtere); skrola
     samo tijelo ispod. */
  document.body.insertAdjacentHTML('beforeend', `
    <div class="sloj" id="m-kalendar"><div class="sloj__zav" data-zatvori></div>
      <div class="modal modal--kalendar" role="dialog" aria-modal="true" aria-label="Kalendar predavanja">
        <i class="modal__rucka" aria-hidden="true"></i>
        <div class="modal__nas">
          <span class="modal__ikona"><svg><use href="#i-kalendar"/></svg></span>
          <div class="modal__naslov"><small>Poruka dana</small><h3>Predavanja</h3></div>
          <div class="kal-pogled" id="kal-pogled" role="group" aria-label="Izgled">
            <button type="button" data-pogled="lista" aria-pressed="true" aria-label="Lista" title="Lista"><svg><use href="#i-lista"/></svg></button>
            <button type="button" data-pogled="plakati" aria-pressed="false" aria-label="Plakati" title="Plakati"><svg><use href="#i-mreza"/></svg></button>
          </div>
          <button class="icon-btn" data-zatvori aria-label="Zatvori"><svg><use href="#i-x"/></svg></button>
        </div>
        <div class="kal-prikaz" id="kal-prikaz" role="group" aria-label="Prikaz">
          <button data-prikaz="sva" aria-pressed="true">${ikona('i-kalendar')}Sva predavanja</button>
          <button data-prikaz="pracena" aria-pressed="false">${ikona('i-zvijezda-f')}Planiram ići<b id="kal-broj" hidden>0</b></button>
        </div>
        <div class="kal-filteri" id="kal-filteri">
          <label class="kal-izbor">${ikona('i-kalendar')}<select id="kal-mjesec" aria-label="Mjesec"></select>${ikona('i-strelica')}</label>
          <label class="kal-izbor">${ikona('i-mjesto')}<select id="kal-grad" aria-label="Grad"></select>${ikona('i-strelica')}</label>
        </div>
        <div class="modal__telo" id="kal-telo"></div>
      </div>
    </div>
    <div class="sloj" id="m-nova"><div class="sloj__zav" data-zatvori></div>
      <div class="modal modal--kalendar modal--nova" role="dialog" aria-modal="true" aria-labelledby="nova-nas">
        <i class="modal__rucka" aria-hidden="true"></i>
        <div class="modal__nas">
          <span class="modal__ikona"><svg><use href="#i-kalendar"/></svg></span>
          <div class="modal__naslov"><small>Poruka dana</small><h3 id="nova-nas">Nova predavanja</h3></div>
          <button class="icon-btn" data-zatvori aria-label="Zatvori"><svg><use href="#i-x"/></svg></button>
        </div>
        <div class="modal__telo">
          <div class="nova-karusel" id="nova-karusel"></div>
          <div class="nova-tacke" id="nova-tacke" aria-hidden="true"></div>
        </div>
      </div>
    </div>
    <div class="sloj" id="m-predavanje"><div class="sloj__zav" data-zatvori></div>
      <div class="modal modal--predavanje" role="dialog" aria-modal="true" aria-label="Predavanje">
        <i class="modal__rucka" aria-hidden="true"></i>
        <div class="modal__nas">
          <span class="modal__ikona"><svg><use href="#i-mjesto"/></svg></span>
          <div class="modal__naslov"><small>Predavanje</small><h3 id="pr-grad">Predavanje</h3></div>
          <button class="icon-btn pr-prati" id="pr-prati" data-prati="" aria-pressed="false" title="Planiram ići — podsjetnik dan prije"><svg><use href="#i-zvijezda"/></svg></button>
          <button class="icon-btn" data-zatvori aria-label="Zatvori"><svg><use href="#i-x"/></svg></button>
        </div>
        <div class="modal__telo">
          <div class="pr-sadrzaj" id="pr-sadrzaj"></div>
          <h4 class="pr-sekcija">Plakati</h4>
          <figure class="pr-plakat" id="pr-plakat"><img id="pr-slika" alt=""></figure>
          <div class="pr-izbor">
            <div class="pr-segment" id="pr-formati" role="group" aria-label="Format plakata">
              <button data-format="prica"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/></svg>Story</button>
              <button data-format="objava"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2"/></svg>Objava</button>
              <button data-format="a3"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 2.5h7.5l4.5 4.5v14.5h-12z"/><path d="M13.5 2.5V7.5h5"/></svg>A3</button>
            </div>
            <div class="pr-boje" id="pr-boje" role="group" aria-label="Boja plakata">
              ${STILOVI.map(s => `<button data-boja="${s.id}" aria-label="${s.naziv}" title="${s.naziv}"
                style="--a:${s.bg[0]};--b:${s.bg[1]}"></button>`).join('')}
            </div>
          </div>
        </div>
        <div class="modal__pod pr-akcije">
          <button class="btn btn--zlatno" id="pr-sacuvaj"><svg><use href="#i-preuzmi"/></svg> Sačuvaj plakat</button>
          <button class="btn btn--obris" id="pr-ics"><svg><use href="#i-kalendar"/></svg> Dodaj u kalendar</button>
        </div>
      </div>
    </div>`);

  for (const id of ['m-kalendar', 'm-nova', 'm-predavanje']) {
    const sloj = $(`#${id}`);
    $$('[data-zatvori]', sloj).forEach(b => b.addEventListener('click', () =>
      app.zatvori(sloj, { cijeli: b.classList.contains('sloj__zav') })));
    app.postaviPovlacenje(sloj);
  }

  // ulazi: ikonica u zaglavlju → kalendar; box ispod poruke → nadolazeća i ona na koja korisnik planira ići
  // uz ikonicu broj predavanja na koja korisnik planira ići, kao uz Sačuvane
  $('#btn-postavke')?.insertAdjacentHTML('beforebegin',
    '<button class="pilula pilula--ikona" id="btn-predavanja" aria-label="Kalendar predavanja" title="Kalendar predavanja"><svg><use href="#i-kalendar"/></svg><i class="pilula__broj" data-broj-pracenih hidden></i></button>');
  $('#btn-predavanja')?.addEventListener('click', () => otvoriKalendar());
  $('#nav-postavke')?.insertAdjacentHTML('beforebegin', `<button class="donja__btn" id="nav-predavanja">
      <span class="donja__ik"><svg><use href="#i-kalendar"/></svg><i class="donja__broj" data-broj-pracenih hidden></i></span>
      <span>Kalendar</span></button>`);
  $('#nav-predavanja')?.addEventListener('click', () => otvoriKalendar());
  // poruka je u fokusu — predavanja dolaze tek ispod nje
  $('#karta')?.insertAdjacentHTML('afterend', `
    <section class="pred-box" id="pred-box" aria-label="Predavanja" hidden>
      <div class="pred-box__glava"><span>Nadolazeća predavanja <b id="pred-broj-sva"></b></span></div>
      <button class="pred-sub" id="pred-sub"></button>
      <div class="pred-moja" id="pred-moja" hidden></div>
    </section>`);
  $('#pred-sub')?.addEventListener('click', () => otvoriPredavanje(sljedeca()[0]));
  $('#pred-moja')?.addEventListener('click', e => {
    const k = e.target.closest('[data-pred]');
    if (k) otvoriPredavanje(lista.find(p => String(p.id) === k.dataset.pred));
  });

  // predavanje: format i boja, dugmad
  $('#pr-formati').addEventListener('click', e => {
    const b = e.target.closest('[data-format]');
    if (b) { format = b.dataset.format; osvjeziIzbor(); crtajPlakat(); }
  });
  $('#pr-boje').addEventListener('click', e => {
    const b = e.target.closest('[data-boja]');
    if (b) { boja = b.dataset.boja; osvjeziIzbor(); crtajPlakat(); }
  });
  $('#pr-sacuvaj').addEventListener('click', () => sacuvaj(otvoreno));
  $('#pr-prati').addEventListener('click', () => prebaciPracenje(otvoreno));
  $('#pr-ics').addEventListener('click', () => dodajUKalendar(otvoreno));

  // kalendar: filteri i klik na predavanje
  $('#kal-prikaz').addEventListener('click', e => {
    const b = e.target.closest('[data-prikaz]');
    if (b && b.dataset.prikaz !== kalPrikaz) { kalPrikaz = b.dataset.prikaz; crtajKalendar(); $('#kal-telo').scrollTop = 0; }
  });
  $('#kal-pogled').addEventListener('click', e => {
    const b = e.target.closest('[data-pogled]');
    if (!b || b.dataset.pogled === kalPogled) return;
    kalPogled = b.dataset.pogled;
    pisi(KAL_POGLED, kalPogled);
    crtajKalendar();
  });
  // skrol ne putuje gore, ali se hvata u spuštanju — vrtuljak se crta iznova
  $('#kal-telo').addEventListener('scroll', e => { if (e.target.classList?.contains('nova-karusel')) osvjeziTackice(e.target); }, { capture: true, passive: true });
  $('#kal-mjesec').addEventListener('change', e => { kalMjesec = e.target.value; crtajKalendar(); });
  $('#kal-grad').addEventListener('change', e => { kalGrad = e.target.value; pisi(GRAD, kalGrad); crtajKalendar(); });
  $('#kal-telo').addEventListener('click', e => {
    const z = e.target.closest('[data-prati]');
    if (z) { prebaciPracenje(lista.find(p => p.id === Number(z.dataset.prati))); return; }
    const r = e.target.closest('[data-pred]');
    if (r) otvoriPredavanje(lista.find(p => String(p.id) === r.dataset.pred));
  });

  // nova predavanja: zvjezdica prati, ostatak kartice otvara predavanje
  $('#nova-karusel').addEventListener('click', e => {
    const z = e.target.closest('[data-prati]');
    if (z) { prebaciPracenje(lista.find(p => p.id === Number(z.dataset.prati))); return; }
    const k = e.target.closest('[data-pred]');
    if (k) otvoriPredavanje(lista.find(p => String(p.id) === k.dataset.pred));
  });
  // tačke ispod prate karticu koja je u sredini
  $('#nova-karusel').addEventListener('scroll', e => osvjeziTackice(e.currentTarget), { passive: true });

  napraviPostavku();
  return stil;
}

/* ================= POSTAVKE: obavijest o novom predavanju ================= */
/* Red u grupi „Podsjetnik“, isti kao dnevna notifikacija. Izbor se čuva na
   uređaju i šalje serveru uz push pretplatu, da isključen korisnik ne dobija
   notifikaciju; isključuje i obavijest koja iskače u aplikaciji. */
function napraviPostavku() {
  $('#r-notif')?.insertAdjacentHTML('afterend', `
    <button class="red" id="r-pred-notif">
      <span class="red__ikona"><svg><use href="#i-kalendar"/></svg></span>
      <span class="red__telo"><b>Obavijesti za predavanja</b><span>Svako novo predavanje i podsjetnik dan prije za ona na koja planiraš ići</span></span>
      <span class="red__kraj"><span class="prekidac" id="p-pred-notif" role="switch" aria-checked="true"></span></span>
    </button>`);
  // razvojna alatka, kao „Ponovi uvod“: splash novih predavanja kakav vidi korisnik
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    $('#r-ponovi-uvod')?.insertAdjacentHTML('afterend', `
      <button class="red" id="r-pred-dodano">
        <span class="red__ikona"><svg><use href="#i-zvono"/></svg></span>
        <span class="red__telo"><b>Simuliraj: dodano novo predavanje</b><span>Aplikacija se otvori ispočetka, kao kod korisnika koji je sve ostalo već vidio — samo lokalno</span></span>
        <span class="red__kraj"><svg><use href="#i-strelica"/></svg></span>
      </button>
      <button class="red" id="r-pred-nova">
        <span class="red__ikona"><svg><use href="#i-kalendar"/></svg></span>
        <span class="red__telo"><b>Prikaži nova predavanja</b><span>Sva nadolazeća kao neviđena — samo lokalno</span></span>
        <span class="red__kraj"><svg><use href="#i-strelica"/></svg></span>
      </button>`);
    // ponovno učitavanje, ne samo drawer: tačno ono što korisnik vidi kad otvori aplikaciju
    $('#r-pred-dodano')?.addEventListener('click', () => { location.href = '/?nova=zadnje'; });
    $('#r-pred-nova')?.addEventListener('click', () => {
      pisi(VIDJENA, []);
      $$('.sloj.on').forEach(s => app.zatvori(s, { cijeli: true }));
      setTimeout(() => ponudiNovo(0, true), 450);
    });
  }
  const osvjezi = () => $('#p-pred-notif')?.setAttribute('aria-checked', String(obavijestiUkljucene()));
  osvjezi();
  $('#r-pred-notif')?.addEventListener('click', () => {
    pisi(OBAVIJESTI, !obavijestiUkljucene());
    osvjezi();
    javiServeru();
  });
}

/* Plakat se crta onoliko velik koliko ga ekran stvarno pokazuje, s gustinom
   piksela: umanjen da crtanje bude brzo, a da logo i sitna slova ostanu
   oštri (na pola veličine su na telefonu bili mutni). */
/* Plakat se crta tačno u pikselima ekrana (širina slike × gustoća): bez
   ikakvog naknadnog smanjivanja, koje bi omekšalo slova i logo. */
const mjeriloZa = sirinaCss => Math.min(1, Math.max(.25, Math.ceil(sirinaCss * (devicePixelRatio || 1)) / 1080));

/* ================= BOX ISPOD PORUKE: sljedeće predavanje ================= */
/* Red je složen kao ulaznica: gore list s datumom, dan i naslov; ispod tanke
   linije gdje i kada, i „Detalji“. List ostaje svoje veličine, koliko god
   redova bilo ispod. Niže, u istom boxu, ona na koja korisnik planira ići. */
function crtajTraku() {
  osvjeziBrojPracenih();     // i pri otvaranju i kad neko predavanje prođe
  const sub = $('#pred-sub');
  if (!sub) return;
  const sva = sljedeca();
  const p = sva[0];
  $('#pred-box').hidden = !p;
  if (!p) return;
  $('#pred-broj-sva').textContent = sva.length;      // koliko ih je ukupno, kao uz „Planiram ići“
  sub.innerHTML = `
    <span class="pred-sub__glava">
      ${listKalendara(p)}
      <span class="pred-sub__tekst">
        <small>${esc(danUSedmici(p.datum))} · ${zaDana(danaDo(p))}</small>
        <b>${esc(p.naslov)}</b>
      </span>
    </span>
    <span class="pred-sub__dno">
      <span class="pred-sub__gdje">${satIMjesto(p)}</span>
      <span class="pred-sub__cta">Detalji<svg><use href="#i-strelica"/></svg></span>
    </span>`;
  crtajMoja();
}

/** List kalendara: mjesec u zlatnoj traci, ispod krupan dan. */
const listKalendara = p => {
  const [, m, d] = p.datum.split('-').map(Number);
  return `<span class="pred-sub__list"><small>${esc(MJESECI_KRATKO[m - 1])}</small><b>${d}</b></span>`;
};

/* Dva reda, isto u boxu i u „Planiram ići“, kao u detaljima predavanja:
   gdje (džemat ili dvorana) sa zastavom, pa sat i grad. Bez naziva mjesta
   prvi red je grad. Dugo ime ide u drugi red, a sat i zastava ostaju cijeli. */
const satIMjesto = p => {
  const naziv = p.mjesto || p.grad;
  const grad = p.mjesto ? p.grad : '';
  // zastava je u tekstu: kad se dug naziv prelomi, ide za zadnjom riječju, ne ostaje na kraju reda
  const gdje = naziv ? `<span class="pred-meta pred-meta--gdje">${ikona('i-mjesto')}<span>${esc(naziv)}${zastavica(p.drzava)}</span></span>` : '';
  const kad = p.vrijeme || grad ? `<span class="pred-meta">${
    p.vrijeme ? `${ikona('i-sat')}<span class="pred-meta__sat">${esc(p.vrijeme)}</span>` : ''}${
    grad ? `<span class="pred-meta__grad">${p.vrijeme ? '· ' : ''}${esc(grad)}</span>` : ''}</span>` : '';
  return gdje + kad;
};

/* ---- PLANIRAM IĆI: red kartica, drugi dio boxa ----
   Samo kad korisnik nešto prati. Kartica po predavanju: datum i dan, naslov,
   grad i koliko je još dana (dan prije i na dan kao zlatna pilula). Složena
   je kao mala kartica poruke — boje teme, zlatni sjaj i tekstura.
   Red se lista prstom, dodir otvara predavanje. */

/** Kalendarskih dana do predavanja, po datumu na uređaju: 0 danas, 1 sutra… */
function danaDo(p) {
  const d = new Date();
  return Math.round((Date.parse(`${p.datum}T00:00:00Z`) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
}
const zaDana = n => (n <= 0 ? 'danas' : n === 1 ? 'sutra' : `za ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'dan' : 'dana'}`);

function crtajMoja() {
  const el = $('#pred-moja');
  if (!el) return;
  const moja = sljedeca().filter(p => prati(p.id));
  el.hidden = !moja.length;
  if (!moja.length) return;
  el.innerHTML = `
    <div class="pred-box__glava"><span>Planiram ići <b>${moja.length}</b></span></div>
    <div class="pred-moja__red">${moja.map(p => `<button class="pred-moja__karta" data-pred="${p.id}">
        <span class="pred-sub__glava">
          ${listKalendara(p)}
          <span class="pred-moja__tekst">
            <small>${esc(danUSedmici(p.datum))}</small>
            <b>${esc(p.naslov)}</b>
          </span>
        </span>
        <span class="pred-moja__dno">${satIMjesto(p)}</span>
      </button>`).join('')}</div>`;

}

/* ================= PREDAVANJE: jedno, s plakatom ================= */
function osvjeziIzbor() {
  $$('#pr-formati [data-format]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.format === format)));
  $$('#pr-boje [data-boja]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.boja === boja)));
}

async function crtajPlakat() {
  const p = otvoreno;
  $('#pr-plakat').dataset.format = format;
  // pregled je tačno po ekranu (oštar), a puna izvozna veličina crta se tek za čuvanje
  const sirina = $('#pr-plakat').clientWidth || 360;
  const blob = await plakatBlob(p, { format, stil: boja, autor: app.autor, mjerilo: mjeriloEkrana(format, sirina), kvalitet: 1 });
  if (otvoreno !== p || !blob) return;
  if (plakatUrl) URL.revokeObjectURL(plakatUrl);
  plakatUrl = URL.createObjectURL(blob);
  $('#pr-slika').src = plakatUrl;
}

function otvoriPredavanje(p) {
  if (!p) return;
  otvoreno = p;
  app.javi?.('pregled', `predavanje:${p.id}`);
  oznaciVidjeno(p.id);
  boja = p.stil || 'zelena';
  format = 'objava';
  osvjeziIzbor();
  const img = $('#pr-slika');
  img.removeAttribute('src');
  img.alt = `Plakat: ${p.naslov}`;
  $('#pr-grad').textContent = p.grad || 'Ammar Bašić';

  const dolazi = !proslo(p);
  const hDat = opcijePlakata(p).hidzri ? hidzriDatum(p.datum) : '';
  // lokacija bez države — ona je već na plakatu ispod
  const adresa = [p.adresa, p.mjesto ? p.grad : ''].filter(Boolean).join(', ');
  $('#pr-sadrzaj').innerHTML = `
    <p class="pr-nad">${dolazi ? `Počinje za <span data-za="${p.id}">${tacno(p)}</span>` : 'Održano'}</p>
    <h2 class="pr-naslov">${esc(p.naslov)}</h2>
    ${p.podnaslov ? `<p class="pr-pod">${esc(p.podnaslov)}</p>` : ''}
    <ul class="pr-podaci">
      <li><svg><use href="#i-kalendar"/></svg><div>
        <b>${esc(danUSedmici(p.datum))}, ${esc(punDatumP(p.datum))}</b>
        ${hDat ? `<span>${esc(hDat)}</span>` : ''}</div></li>
      <li><svg><use href="#i-sat"/></svg><div><b>${esc(p.vrijeme)}<small> h</small></b>${p.vrijeme_opis ? `<span>${esc(p.vrijeme_opis)}</span>` : ''}</div></li>
      ${p.mjesto || p.grad ? `<li><svg><use href="#i-mjesto"/></svg><div>
        <b>${esc(p.mjesto || p.grad)}${zastavica(p.drzava)}</b>
        ${adresa ? `<span>${esc(adresa)}</span>` : ''}</div></li>` : ''}
      ${p.organizator ? `<li><svg><use href="#i-korisnik"/></svg><div>
        <b>${esc(p.organizator)}</b><span>Organizator</span></div></li>` : ''}
    </ul>
    ${p.opis ? `<p class="pr-opis">${esc(p.opis)}</p>` : ''}`;
  $('#pr-ics').hidden = !dolazi;
  // pratiti ima smisla samo ono što tek dolazi
  $('#pr-prati').hidden = !dolazi;
  $('#pr-prati').dataset.prati = p.id;
  osvjeziZvjezdice();
  app.otvori($('#m-predavanje'));
  crtajPlakat();
}

async function plakatFajl(p) {
  const blob = await plakatBlob(p, { format, stil: boja, autor: app.autor });
  return new File([blob], imePlakata(p, `${format}-${boja}`), { type: blob.type });
}

/* Na telefonu plakat ide kroz meni za dijeljenje — tamo je „Sačuvaj sliku“
   u galeriju, a i slanje dalje; na računaru se odmah preuzme. */
async function sacuvaj(p) {
  const f = await plakatFajl(p);
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f] }); app.javi?.('plakat', `predavanje:${p.id}`); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  spusti(f, f.name);
  app.poruka('Plakat je sačuvan', 'i-preuzmi');
  app.javi?.('plakat', `predavanje:${p.id}`);
}

/* „Dodaj u kalendar“ otvara kalendar uređaja: iPhone dobija .ics s pravog
   linka, pa ga iOS ponudi kao događaj u Kalendaru; Android otvara Google
   Calendar s popunjenim događajem; računar preuzme .ics, koji otvori
   kalendar podrazumijevan na njemu. */
const jeIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const jeAndroid = () => /Android/i.test(navigator.userAgent);

function googleKalendar(p) {
  const od = trenutak(p), f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${p.naslov}${app.autor ? ` — ${app.autor}` : ''}`,
    dates: `${f(od)}/${f(new Date(od.getTime() + TRAJANJE_MS))}`,
    location: [p.mjesto, p.adresa, p.grad, imeZemlje(p.drzava)].filter(Boolean).join(', '),
    details: [p.vrijeme_opis, p.opis, p.link].filter(Boolean).join('\n\n'),
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

function dodajUKalendar(p) {
  app.javi?.('kalendar', `predavanje:${p.id}`);
  if (jeAndroid()) { window.open(googleKalendar(p), '_blank', 'noopener'); return; }
  if (jeIOS() && !radiLokalno()) { location.href = `/api/predavanja?ics=${p.id}`; return; }
  preuzmiIcs(p);
}

function preuzmiIcs(p) {
  spusti(new Blob([ics(p, app.autor)], { type: 'text/calendar;charset=utf-8' }), `predavanje-${p.datum}.ics`);
}

function spusti(blob, ime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ime;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ================= KALENDAR: nadolazeća, po mjesecu i gradu ================= */
/** Gradovi iz nadolazećih predavanja, abecedno, s državom van BiH. */
function gradovi(dolaze) {
  const m = new Map();
  for (const p of dolaze) if (p.grad && !m.has(p.grad)) m.set(p.grad, p.drzava);
  return [...m].map(([grad, drzava]) => ({ grad, drzava })).sort((a, b) => a.grad.localeCompare(b.grad, 'bs'));
}

const imeMjeseca = k => { const [g, m] = k.split('-').map(Number); return `${MJESECI[m - 1]} ${g}.`; };

/** Predavanja po mjesecima: naslov mjeseca, pa redovi. */
function poMjesecima(predavanja) {
  const grupe = [];
  for (const p of predavanja) {
    const k = p.datum.slice(0, 7);
    if (grupe.at(-1)?.k !== k) grupe.push({ k, lista: [] });
    grupe.at(-1).lista.push(p);
  }
  return grupe.map(g => `<h4 class="kal-mjesec">${imeMjeseca(g.k)}</h4>${g.lista.map(redKalendara).join('')}`).join('');
}

/** Kalendar kao plakati: vrtuljak kao na ekranu novih predavanja. */
function karuselKalendara(predavanja) {
  if (!predavanja.length) return '';
  return `<div class="nova-karusel kal-karusel">${predavanja.map(p => kartaPlakata(p, true)).join('')}</div>
    <div class="nova-tacke" aria-hidden="true">${tackice(predavanja.length)}</div>`;
}
const prikazKalendara = predavanja => (kalPogled === 'plakati' ? karuselKalendara(predavanja) : poMjesecima(predavanja));

function crtajKalendar() {
  $$('#kal-prikaz [data-prikaz]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.prikaz === kalPrikaz)));
  $$('#kal-pogled [data-pogled]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pogled === kalPogled)));
  osvjeziZvjezdice();
  // moja predavanja: samo praćena, bez filtera — ima ih malo
  $('#kal-filteri').hidden = kalPrikaz === 'pracena';
  if (kalPrikaz === 'pracena') {
    const html = prikazKalendara(sljedeca().filter(p => prati(p.id)));
    $('#kal-telo').innerHTML = html || `<div class="kal-prazno">${ikona('i-zvijezda')}
      <p>Još nema predavanja na koja planiraš ići.<br>Dodirni zvjezdicu na predavanju — podsjetnik stiže dan prije.</p></div>`;
    crtajPlakateKalendara();
    return;
  }

  const sve = sljedeca();
  const sviGradovi = gradovi(sve);
  if (kalGrad && !sviGradovi.some(g => g.grad === kalGrad)) kalGrad = '';
  const uGradu = sve.filter(p => !kalGrad || p.grad === kalGrad);
  const mjeseci = [...new Set(uGradu.map(p => p.datum.slice(0, 7)))];
  if (kalMjesec && !mjeseci.includes(kalMjesec)) kalMjesec = '';

  // izbornici: izvorni select — na telefonu otvara sistemski birač
  $('#kal-mjesec').innerHTML = `<option value="">Svi mjeseci</option>${mjeseci.map(k =>
    `<option value="${k}"${k === kalMjesec ? ' selected' : ''}>${imeMjeseca(k)}</option>`).join('')}`;
  $('#kal-grad').innerHTML = `<option value="">Svi gradovi</option>${sviGradovi.map(g =>
    `<option value="${esc(g.grad)}"${g.grad === kalGrad ? ' selected' : ''}>${esc(gradDrzava(g))}</option>`).join('')}`;

  const izbor = uGradu.filter(p => !kalMjesec || p.datum.startsWith(kalMjesec));
  $('#kal-telo').innerHTML = prikazKalendara(izbor) || `<div class="kal-prazno">${ikona('i-kalendar')}
    <p>${sve.length ? 'Nema predavanja za ovaj izbor.' : 'Uskoro nova predavanja.<br>Čim hafiz doda novo, pojavit će se ovdje.'}</p></div>`;
  crtajPlakateKalendara();
}

/* ---- kalendar kao plakati: vrtuljak kartica, kao na ekranu novih predavanja ----
   Plakati se crtaju po veličini kartice, jedan po jedan, i pamte se —
   ponovno crtanje kalendara (filter, tab) ne crta ih ispočetka. */
const kalPlakati = new Map();       // `${id}:${stil}:${izmijenjeno}` → URL slike
const kljucPlakata = p => `${p.id}:${p.stil || 'zelena'}:${p.izmijenjeno || ''}`;
let kalPotez = 0;

/** Kartica s plakatom — u vrtuljku novih predavanja i u kalendaru. Ispod
    plakata dan, naslov, pa mjesto održavanja i sat s gradom, kao u boxu. */
function kartaPlakata(p, kalendar = false) {
  const [, m, d] = p.datum.split('-').map(Number);
  const url = kalendar ? kalPlakati.get(kljucPlakata(p)) : '';
  return `<article class="nova-karta" data-pred="${p.id}">
    <figure class="nova-karta__plakat"><img alt="Plakat: ${esc(p.naslov)}"${url ? ` src="${url}"` : ''}></figure>
    <div class="nova-karta__dno">
      <div class="nova-karta__tekst">
        <small>${esc(danUSedmici(p.datum))} · ${d}. ${esc(MJESECI[m - 1])}</small>
        <b>${esc(p.naslov)}</b>
        <span class="nova-karta__gdje">${satIMjesto(p)}</span>
      </div>
      <button class="nova-karta__prati" data-prati="${p.id}" aria-pressed="${prati(p.id)}" aria-label="Planiram ići"><svg><use href="#${prati(p.id) ? 'i-zvijezda-f' : 'i-zvijezda'}"/></svg></button>
    </div>
  </article>`;
}

/* Tačkice ispod vrtuljka; kad je kartica previše za tačkice, brojač. */
const tackice = n => (n > 12 ? `<span class="nova-broj">1 / ${n}</span>`
  : n > 1 ? Array.from({ length: n }, (_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('') : '');
function osvjeziTackice(k) {
  const prva = k.firstElementChild, t = k.nextElementSibling;
  if (!prva || !t) return;
  const i = Math.round(k.scrollLeft / (prva.offsetWidth + 12));
  $$('i', t).forEach((x, j) => x.classList.toggle('on', j === i));
  const broj = $('.nova-broj', t);
  if (broj) broj.textContent = `${Math.min(i + 1, k.children.length)} / ${k.children.length}`;
}

function crtajPlakateKalendara() {
  if (kalPogled !== 'plakati') return;
  const potez = ++kalPotez;
  const fale = $$('#kal-telo .nova-karta[data-pred]')
    .map(k => lista.find(p => String(p.id) === k.dataset.pred))
    .filter(p => p && !kalPlakati.has(kljucPlakata(p)));
  if (!fale.length) return;
  (async () => {
    await new Promise(r => setTimeout(r, 380));                // drawer prvo izađe
    for (const p of fale) {
      if (potez !== kalPotez) return;                          // kalendar je u međuvremenu nacrtan ponovo
      try {
        const sirina = $('#kal-telo .nova-karta__plakat img')?.clientWidth || 330;
        const blob = await plakatBlob(p, { format: 'objava', stil: p.stil || 'zelena', autor: app.autor, mjerilo: mjeriloZa(sirina), tip: 'image/jpeg', kvalitet: 1 });
        const url = URL.createObjectURL(blob);
        kalPlakati.set(kljucPlakata(p), url);
        const img = $(`#kal-telo .nova-karta[data-pred="${p.id}"] .nova-karta__plakat img`);
        if (img) img.src = url;
      } catch { /* bez plakata ostaju datum i naslov */ }
      await new Promise(r => setTimeout(r, 30));
    }
  })();
}

/* sitna zastava iza lokacije — samo van BiH; ISO kod je uvijek dva slova, sve drugo se preskače */
const zastavica = iso => (/^[A-Z]{2}$/.test(iso || '') && iso !== 'BA'
  ? `<img class="pred-zastava" src="/assets/zastave/${iso.toLowerCase()}.png" alt="" loading="lazy">` : '');

function redKalendara(p) {
  const [, , d] = p.datum.split('-').map(Number);
  const dan = DANI[new Date(`${p.datum}T12:00:00`).getDay()].slice(0, 3);
  return `<button class="kal-red${prati(p.id) ? ' kal-red--prati' : ''}" data-pred="${p.id}">
    <span class="kal-red__dan pred-sub__list"><small>${dan}</small><b>${d}</b></span>
    <span class="kal-red__tekst">
      <b>${esc(p.naslov)}<svg class="kal-red__zvj" aria-label="Planiraš ići"><use href="#i-zvijezda-f"/></svg></b>
      <span class="kal-red__gdje">${satIMjesto(p)}</span>
    </span>
    <svg class="kal-red__str" aria-hidden="true"><use href="#i-strelica"/></svg>
  </button>`;
}

async function otvoriKalendar(prikaz = 'sva') {
  kalPrikaz = prikaz;
  crtajKalendar();
  app.otvori($('#m-kalendar'));
  // svježa lista u pozadini — CDN je drži nekoliko sekundi, pa je ovo jeftino
  try { lista = await ucitajPredavanja(); crtajKalendar(); crtajTraku(); } catch { /* ostaje stara */ }
}

/* ================= nova predavanja: jednom, pri otvaranju =================
   Sve što je dodano a korisnik još nije vidio (nadolazeće) stiže kao splash
   s plakatima: kartica po predavanju, listaju se prstom. Zvjezdica na
   kartici odmah prati predavanje. Prikazano se bilježi kao viđeno, pa se
   ista ponuda ne pojavljuje dvaput. */
let novaUrl = [];

function crtajNova(nova) {
  const n = nova.length;
  // samo plakati — naslov drawera već kaže da su predavanja nova
  $('#nova-nas').textContent = n === 1 ? 'Novo predavanje' : 'Nova predavanja';
  novaUrl.forEach(u => URL.revokeObjectURL(u));
  novaUrl = [];
  $('#nova-karusel').innerHTML = nova.map(p => kartaPlakata(p)).join('');
  $('#nova-tacke').innerHTML = tackice(n);
  osvjeziZvjezdice();

  /* Plakati jedan po jedan, tek kad drawer izađe — crtanje je teško i ne
     smije trzati animaciju; između dva plakata nit diše. Veličina je kartice
     na ekranu, da logo i slova ostanu oštri. */
  const odmor = ms => new Promise(r => setTimeout(r, ms));
  (async () => {
    await odmor(420);
    for (const p of nova) {
      await odmor(30);
      const img = $(`.nova-karta[data-pred="${p.id}"] img`);
      if (!img) return;                                   // u međuvremenu nacrtana nova ponuda
      try {
        const sirina = img.clientWidth || 330;
        const blob = await plakatBlob(p, { format: 'objava', stil: p.stil || 'zelena', autor: app.autor, mjerilo: mjeriloZa(sirina), tip: 'image/jpeg', kvalitet: 1 });
        const u = URL.createObjectURL(blob);
        novaUrl.push(u);
        img.src = u;
      } catch { /* bez plakata kartica i dalje ima naslov i datum */ }
    }
  })();
}

function ponudiNovo(pokusaj = 0, proba = false) {
  if (!proba && !obavijestiUkljucene()) return;
  const v = vidjena();
  const nova = sljedeca().filter(p => !v.includes(p.id));
  if (!nova.length) return;
  // ne preko drugog prozora (pozdrav, uvod…) — čim se on zatvori, ponuda je tu
  if ($('.sloj.on, #uvod.on')) {
    if (pokusaj < 40) setTimeout(() => ponudiNovo(pokusaj + 1, proba), 600);
    return;
  }
  crtajNova(nova);
  pisi(VIDJENA, [...new Set([...v, ...nova.map(p => p.id)])].slice(-200));
  app.otvori($('#m-nova'));
}

/* Lista kreće čim se modul učita — app.js ga traži odmah pri pokretanju,
   uporedo s ostalim, pa je lista tu kad dođe red na pokreni(). Došao s push
   notifikacije o novom predavanju: lista odmah svježa (`svjeze` zaobilazi
   CDN), jednim pozivom — bez čekanja na staru listu. */
let unaprijed = null;
export function ucitajUnaprijed() {
  const id = new URLSearchParams(location.search).get('predavanje');
  unaprijed ??= ucitajPredavanja(id ? { svjeze: id } : {});
  return unaprijed;
}

/**
 * @param {object} a  alati iz app.js: otvori, zatvori, postaviPovlacenje, poruka, autor
 * @param {boolean} ponudi  smije li se odmah ponuditi novo predavanje (ne usred uvoda)
 */
export async function pokreni(a, ponudi = true) {
  app = a;
  const stil = napraviKostur();
  const q = new URLSearchParams(location.search);
  const izLinka = q.get('predavanje');
  try { [lista] = await Promise.all([ucitajUnaprijed(), stil]); } catch { return; }
  let ucitano = Date.now();
  crtajTraku();
  setInterval(tik, 1000);
  /* Povratak iz pozadine: telefon aplikaciju često ne pokreće ispočetka, pa
     bi novo predavanje ostalo nevidljivo dok se ona potpuno ne zatvori.
     Odbrojavanje u boxu se osvježi odmah, lista najviše jednom u 10 s (CDN je
     drži 5 s), pa ako je stiglo nešto novo — ponuda kao pri otvaranju. Kratak
     zastoj da dodir na obavijest (koji otvara baš to predavanje) stigne prvi. */
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    crtajTraku();
    if (Date.now() - ucitano < 10000) return;
    ucitano = Date.now();
    try { lista = await ucitajPredavanja(); } catch { return; }
    crtajTraku();
    setTimeout(() => ponudiNovo(), 400);
  });
  // praćena koja su prošla (ili skinuta) ne treba čuvati ni slati serveru
  const ziva = pracena().filter(id => lista.some(p => p.id === id && !proslo(p)));
  if (ziva.length !== pracena().length) pisi(PRACENA, ziva);

  /* Proba lokalno i na testu, i kad je obavijest o novim predavanjima u
     postavkama isključena: ?nova=1 zaboravi viđena i ponudi sva ispočetka;
     ?nova=zadnje glumi korisnika koji je vidio sve osim zadnjeg dodanog. */
  const proba = (radiLokalno() || /-git-test-/.test(location.hostname)) && q.has('nova');
  if (proba) {
    const dolaze = sljedeca();
    const zadnje = dolaze.reduce((a, p) => (!a || p.id > a.id ? p : a), null);   // id raste sa svakim dodanim
    pisi(VIDJENA, q.get('nova') === 'zadnje' ? dolaze.filter(p => p !== zadnje).map(p => p.id) : []);
    q.delete('nova');
    history.replaceState(history.state, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
  }

  // došao s push notifikacije o novom predavanju: odmah to predavanje
  if (izLinka) {
    // iz adrese napolje — osvježavanje stranice ga ne otvara ponovo
    q.delete('predavanje');
    history.replaceState(history.state, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
    const p = lista.find(x => String(x.id) === izLinka);
    if (p) { setTimeout(() => otvoriPredavanje(p), 200); return; }
  }
  if (ponudi || proba) setTimeout(() => ponudiNovo(0, proba), 700);
}
