/* ============================================================
   ADMIN — naredna predavanja, uređivanje s plakatom u modalu, poruke
   ============================================================ */
import {
  ZEMLJE, ZONE, SARAJEVO, OPCIJE, MJESECI, MJESECI_KRATKO,
  zemlja, imeZemlje, proslo, linkPlakata, danUSedmici, punDatumP,
  ucitajPredavanja, sacuvajPredavanje, obrisiPredavanjeId, radiLokalno,
} from '/js/predavanja-jezgro.js';
import { PLAKAT_FORMATI, nacrtajPlakat, plakatBlob, imePlakata, nacrtajRaspored, rasporedBlob, mjeriloEkrana } from '/js/plakat.js';

const $ = (s, k = document) => k.querySelector(s);
const $$ = (s, k = document) => [...k.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => String(n).padStart(2, '0');
const ikona = id => `<svg class="ik" aria-hidden="true"><use href="#${id}"/></svg>`;
const zastavica = iso => `<img class="zastavica" src="/assets/zastave/${(iso || 'ba').toLowerCase()}.png" alt="">`;
const kljucD = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
// imena fajlova u ZIP-u bez dijakritika — stari Windows ih inače pokaže kao ? (Beč → bec, Đulići → djulici)
const imeDat = t => t.toLowerCase().replace(/đ/g, 'dj').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const jeLokalniHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

const TAJNA = 'pd.adminTajna';
const CITATI = 'pd.adminCitati';
/* Na objavljenoj verziji šifru provjerava server (ADMIN_SECRET). Lokalno,
   bez /api, nema ko da je provjeri — tu vrijedi ova, samo da tok bude isti. */
const LOKALNA_SIFRA = 'admin';

let tajna = localStorage.getItem(TAJNA) || '';
let lista = [];
let urediId = null, urediKljuc = null, urediObjavljeno = true;
let stil = 'zelena', format = 'objava', opcije = { ...OPCIJE };

function obavijest(t, greska = false) {
  const el = $('#poruka');
  ($('dialog[open]') || document.body).append(el);     // otvoren dijalog je u gornjem sloju — poruka mora u njega
  el.textContent = t; el.classList.toggle('greska', greska); el.classList.add('on');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2600);
}

const poRedu = (a, b) => (a.datum + a.vrijeme).localeCompare(b.datum + b.vrijeme);

/* ---------- prijava ---------- */
$('#oko').addEventListener('click', () => {
  const i = $('#tajna');
  i.type = i.type === 'password' ? 'text' : 'password';
});

async function ucitaj() {
  try {
    lista = await ucitajPredavanja({ sve: true, tajna });
    // lokalno nema servera koji bi provjerio šifru, pa se provjerava ovdje
    if (radiLokalno() && tajna !== LOKALNA_SIFRA) throw Object.assign(new Error('Pogrešna šifra'), { status: 401 });
    $('#prijava').hidden = true;
    $('#radno').hidden = false;
    $('#rezim').hidden = !radiLokalno();
    $('[data-popuni]').hidden = !radiLokalno();
    crtajSve();
    return true;
  } catch (e) {
    if (e.status === 401) {
      $('#prijava').hidden = false;
      $('#radno').hidden = true;
      $('#prijava-greska').textContent = tajna ? e.message : '';
      $('#prijava-napomena').hidden = !radiLokalno();
      return false;
    }
    obavijest(e.message, true);
    return false;
  }
}

$('#f-prijava').addEventListener('submit', async e => {
  e.preventDefault();
  tajna = $('#tajna').value.trim();
  if (await ucitaj()) localStorage.setItem(TAJNA, tajna);
});
$('#odjava').addEventListener('click', () => { localStorage.removeItem(TAJNA); location.reload(); });

/* ---------- pogledi ---------- */
function pogled(ime) {
  $$('[data-pogled]').forEach(s => { s.hidden = s.dataset.pogled !== ime; });
  $$('[data-tab]').forEach(b => b.setAttribute('aria-current', String(b.dataset.tab === ime)));
  scrollTo({ top: 0 });
  if (ime === 'citati') ucitajCitate();
}
$$('[data-tab]').forEach(b => b.addEventListener('click', () => pogled(b.dataset.tab)));
$$('[data-novo]').forEach(b => b.addEventListener('click', () => { uFormu(); otvoriModal(); }));

/* Uređivanje je u velikom modalu — lista ostaje ispod, zatvaranje je X ili Esc. */
const modal = $('#uredi-modal');
function otvoriModal() {
  postaviDio('podaci');
  modal.showModal();
  $('.uredi', modal).scrollTop = 0;
  $('#forma').scrollTop = 0;
}
$('#uredi-zatvori').addEventListener('click', () => modal.close());

function crtajSve() { crtajListu(); }

// link (kopiranje) → predavanje (uređivanje)
document.addEventListener('click', e => {
  const l = e.target.closest('[data-link]');
  if (l) { kopirajLink(lista.find(p => String(p.id) === l.dataset.link)); return; }
  const u = e.target.closest('[data-uredi]');
  if (u) otvoriUredjivanje(u.dataset.uredi);
});

function otvoriUredjivanje(id) {
  const p = lista.find(x => String(x.id) === String(id));
  if (!p) return;
  uFormu(p);
  otvoriModal();
}

/* ---------- lista: samo naredna — održana ostaju u bazi i u izvozu, ali se ne prikazuju ---------- */
$('#lista-trazi').addEventListener('input', () => crtajListu());

function crtajListu() {
  const q = $('#lista-trazi').value.trim().toLowerCase();
  const sada = Date.now();
  const red = lista
    .filter(p => !proslo(p, sada))
    .filter(p => !q || [p.naslov, p.podnaslov, p.grad, p.mjesto, imeZemlje(p.drzava)].join(' ').toLowerCase().includes(q))
    .sort(poRedu);
  // po mjesecima, kao kalendar u aplikaciji: naslov mjeseca pa njegova predavanja
  const mjeseci = new Map();
  for (const p of red) {
    const k = p.datum.slice(0, 7);
    if (!mjeseci.has(k)) mjeseci.set(k, []);
    mjeseci.get(k).push(p);
  }
  $('#lista').innerHTML = red.length ? [...mjeseci].map(([k, ps]) => {
    const [g, m] = k.split('-').map(Number);
    return `<h3 class="mjesec-nas">${MJESECI[m - 1]} ${g}.<span>${ps.length}</span></h3>
      <div class="povrsina redovi">${ps.map(redPredavanja).join('')}</div>`;
  }).join('') : `<p class="prazno povrsina">${q ? 'Nijedno predavanje ne odgovara pretrazi.' : 'Nema zakazanih predavanja — dodaj novo dugmetom gore.'}</p>`;
}

function redPredavanja(p) {
  const d = Number(p.datum.slice(8));
  return `<div class="pred-red" data-uredi="${p.id}">
      <div class="pred-red__datum"><small>${danUSedmici(p.datum).slice(0, 3)}</small><b>${d}</b></div>
      <div><b>${esc(p.naslov)}</b><span class="sitno">${ikona('i-sat')}${esc(p.vrijeme)} ${ikona('i-mjesto')}<span>${esc([p.grad || p.mjesto, p.drzava !== 'BA' ? imeZemlje(p.drzava) : ''].filter(Boolean).join(', '))}</span>${zastavica(p.drzava)}</span></div>
      <div class="red">
        ${p.objavljeno === false ? '<span class="oznaka">Skriveno</span>' : ''}
        ${p.kljuc ? `<button class="tiho ikona-dugme" data-link="${p.id}" title="Kopiraj link — plakat za dijeljenje"><svg class="ik"><use href="#i-link"/></svg></button>` : ''}
        <svg class="ik" style="color:var(--ink-mute)"><use href="#i-desno"/></svg>
      </div></div>`;
}

/* ---------- uređivanje ---------- */
const forma = $('#forma');
$('#drzava').innerHTML = ZEMLJE.map(([iso, ime]) => `<option value="${iso}">${esc(ime)}</option>`).join('');
$('#zona').innerHTML = ZONE.map(z => `<option value="${z}">${z.replace('_', ' ')}</option>`).join('');
$('#drzava').addEventListener('change', () => { $('#zona').value = zemlja($('#drzava').value)?.[2] || SARAJEVO; osvjeziDrzavu(); osvjezi(); });

$('#formati').innerHTML = PLAKAT_FORMATI.map(f => `<button type="button" data-format="${f.id}" aria-pressed="${f.id === format}">
  <span class="okvir-ikona"><i style="width:${Math.round(30 * f.w / f.h)}px;height:30px"></i></span>${f.naziv}<small>${f.opis}</small></button>`).join('');
$$('#formati button').forEach(b => b.addEventListener('click', () => {
  format = b.dataset.format;
  $$('#formati button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  osvjezi();
}));
$$('#boje button').forEach(b => b.addEventListener('click', () => { postaviStil(b.dataset.stil); osvjezi(); }));
function postaviStil(s) {
  stil = s;
  $$('#boje button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stil === s)));
}

/** Zastava pored izbora države. */
function osvjeziDrzavu() {
  $('#drzava-zastava').src = `/assets/zastave/${forma.drzava.value.toLowerCase()}.png`;
}

/* ---- Gradovi: prijedlozi iz već unesenih predavanja ----
   Svaki grad s kojim je predavanje sačuvano postaje prijedlog, uz svoju
   državu i zonu — izbor grada popuni i njih. Pamti se i na uređaju, pa grad
   ostaje u prijedlozima i kad se njegovo predavanje obriše. Novi grad se ne
   dodaje posebno: dovoljno je sačuvati predavanje. */
const GRADOVI = 'pd.adminGradovi';
// bez velikih slova i kvačica: „bec“, „Bec“ i „Beč“ su isti grad, „munchen“ je „München“
const kljucGrada = ime => ime.trim().toLocaleLowerCase('bs').replace(/đ/g, 'dj').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function zapamceniGradovi() {
  try { return JSON.parse(localStorage.getItem(GRADOVI)) || []; } catch { return []; }
}
function gradovi() {
  const m = new Map();
  // zapamćeni prvi, pa predavanja po datumu — najnovije određuje državu i zonu
  const predavanja = [...lista].sort((a, b) => (a.datum < b.datum ? -1 : 1));
  for (const g of [...zapamceniGradovi(), ...predavanja]) {
    if (g.grad?.trim()) m.set(kljucGrada(g.grad), { grad: g.grad.trim(), drzava: g.drzava, zona: g.zona });
  }
  return m;
}
function zapamtiGrad(p) {
  if (!p.grad?.trim()) return;
  const l = zapamceniGradovi().filter(g => kljucGrada(g.grad) !== kljucGrada(p.grad));
  l.push({ grad: p.grad.trim(), drzava: p.drzava, zona: p.zona });
  try { localStorage.setItem(GRADOVI, JSON.stringify(l.slice(-300))); } catch { /* ostaje iz predavanja */ }
}
/* Lista ispod polja je naša, ne <datalist>: ta se ne da stilizovati i u
   drawer-u zna stajati pomaknuta od polja. */
let ponudjeni = [], aktivan = -1;
function prikaziGradove(da) {
  $('#gradovi').hidden = !da;
  forma.grad.setAttribute('aria-expanded', String(da));
}
function ponudiGradove() {
  const q = kljucGrada(forma.grad.value);
  const k = g => kljucGrada(g.grad);
  const svi = [...gradovi().values()].sort((a, b) => a.grad.localeCompare(b.grad, 'bs'));
  // prvo oni koji počinju upisanim, pa oni koji ga sadrže; već tačno upisan se ne nudi
  ponudjeni = (q ? [...svi.filter(g => k(g).startsWith(q)), ...svi.filter(g => !k(g).startsWith(q) && k(g).includes(q))] : svi)
    .filter(g => k(g) !== q).slice(0, q ? 7 : 60);          // prazno polje: svi, lista se skrola
  aktivan = -1;
  $('#gradovi').innerHTML = ponudjeni.map((g, i) => `<button type="button" role="option" data-i="${i}">
    ${zastavica(g.drzava)}<b>${esc(g.grad)}</b><small>${esc(imeZemlje(g.drzava))}</small></button>`).join('');
  prikaziGradove(ponudjeni.length > 0);
}
function izaberiGrad(g) {
  forma.grad.value = g.grad;                                // „bec“ → „Beč“, kako je prvi put upisan
  if (zemlja(g.drzava)) { forma.drzava.value = g.drzava; osvjeziDrzavu(); }
  if (ZONE.includes(g.zona)) forma.zona.value = g.zona;
  prikaziGradove(false);
  osvjezi();
}
forma.grad.addEventListener('focus', ponudiGradove);
forma.grad.addEventListener('input', ponudiGradove);
forma.grad.addEventListener('blur', () => prikaziGradove(false));
forma.grad.addEventListener('keydown', e => {
  if ($('#gradovi').hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    aktivan = (aktivan + (e.key === 'ArrowDown' ? 1 : -1) + ponudjeni.length) % ponudjeni.length;
    $$('#gradovi button').forEach((b, i) => b.classList.toggle('on', i === aktivan));
  } else if (e.key === 'Enter' && aktivan >= 0) {
    e.preventDefault();
    izaberiGrad(ponudjeni[aktivan]);
  } else if (e.key === 'Escape') {
    e.preventDefault();                                     // zatvara listu, ne drawer
    prikaziGradove(false);
  }
});
$('#gradovi').addEventListener('pointerdown', e => e.preventDefault());   // fokus ostaje u polju
$('#gradovi').addEventListener('click', e => {
  const b = e.target.closest('[data-i]');
  if (b) izaberiGrad(ponudjeni[b.dataset.i]);
});
// upisan do kraja, bez izbora iz liste: postojeći grad ipak povuče državu i zonu
forma.grad.addEventListener('change', () => {
  const g = gradovi().get(kljucGrada(forma.grad.value));
  if (g) izaberiGrad(g);                                    // novi grad — zapamti se pri čuvanju
});
$$('[data-opcija]').forEach(i => i.addEventListener('change', () => { opcije[i.dataset.opcija] = i.checked; osvjezi(); }));

function izForme() {
  const d = Object.fromEntries(new FormData(forma));
  return { ...d, id: urediId || undefined, kljuc: urediKljuc || undefined, stil, opcije: { ...opcije },
    // novo je uvijek objavljeno; izmjena čuva sakriveno sakrivenim. Obavijest samo uz novo.
    objavljeno: urediId ? urediObjavljeno : true, obavijest: !urediId && forma.obavijest.checked };
}

function uFormu(p = {}) {
  urediId = p.id || null;
  urediKljuc = p.kljuc || null;
  urediObjavljeno = p.objavljeno !== false;
  forma.reset();
  for (const k of ['naslov', 'podnaslov', 'datum', 'vrijeme', 'vrijeme_opis', 'grad', 'mjesto', 'adresa', 'organizator', 'opis', 'link']) forma[k].value = p[k] || '';
  if (!p.vrijeme) forma.vrijeme.value = '19:00';
  forma.drzava.value = p.drzava || 'BA';
  forma.zona.value = p.zona || zemlja(forma.drzava.value)?.[2] || SARAJEVO;
  // obavijest samo za novo predavanje; izmjena ne budi telefone — tu su sakrij i obriši
  forma.obavijest.checked = true;
  $('#obavijest-red').hidden = !!urediId;
  $('#upravljanje').hidden = !urediId;
  osvjeziSakrij();
  postaviStil(p.stil || 'zelena');
  opcije = { ...OPCIJE, ...(p.opcije || {}) };
  $$('[data-opcija]').forEach(i => { i.checked = !!opcije[i.dataset.opcija]; });
  osvjeziDrzavu();
  $('#f-naslov').textContent = urediId ? 'Uredi predavanje' : 'Novo predavanje';
  $('#obrisi').hidden = !urediId;
  $('#link-blok').hidden = !urediKljuc;
  $('#link').value = linkPlakata(p);
  prikaziGradove(false);
  osvjezi();
}

let crtanje = 0;
function osvjezi() {
  const p = izForme();
  clearTimeout(crtanje);
  crtanje = setTimeout(() => {
    // tačno po ekranu, da je oštar; sakriven (telefon, tab „Podaci“) crta se za širinu ekrana
    const cv = $('#platno'), sirina = cv.clientWidth || Math.min(innerWidth - 32, 460);
    nacrtajPlakat(cv, p, { format, stil, mjerilo: mjeriloEkrana(format, sirina) });
  }, 120);
}
forma.addEventListener('input', osvjezi);

/** Preuzima tačno ono što je izabrano gore — format i boju. */
$('#preuzmi').addEventListener('click', async () => {
  const p = izForme();
  const blob = await plakatBlob(p, { format, stil });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = imePlakata(p, `${format}-${stil}`);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

async function kopirajLink(p) {
  const l = linkPlakata(p);
  if (!l) return;
  try { await navigator.clipboard.writeText(l); obavijest('Link je kopiran'); }
  catch { prompt('Kopiraj link:', l); }
}
$('#kopiraj-link').addEventListener('click', () => kopirajLink({ kljuc: urediKljuc }));

/* Na telefonu je forma sakrivena dok se gleda plakat — bez ovoga „Sačuvaj“
   s praznim obaveznim poljem ne bi uradio ništa vidljivo. */
$$('[data-sacuvaj]').forEach(b => b.addEventListener('click', e => {
  if (forma.checkValidity()) return;
  e.preventDefault();
  postaviDio('podaci');
  forma.reportValidity();
}));

forma.addEventListener('submit', async e => {
  e.preventDefault();
  const dugmad = $$('[data-sacuvaj]');
  dugmad.forEach(b => { b.disabled = true; });
  try {
    const { predavanje: p, obavijest: push } = await sacuvajPredavanje(izForme(), tajna);
    zapamtiGrad(p);
    const bilo = urediId;
    lista = lista.filter(x => x.id !== p.id).concat(p);
    crtajSve();
    modal.close();                                       // prvo zatvori — poruka onda ide preko liste
    const poslano = !push ? ''
      : push.kasnije === 'jutro' ? ' · obavijest kreće ujutro u 7 h'
      : push.kasnije ? ' · obavijest kreće u narednih 15 minuta'
      : ` · obavijest otišla na ${push.poslano} uređaja`;
    obavijest(`${bilo ? 'Izmjene su sačuvane' : 'Predavanje je objavljeno'}${poslano}`);
  } catch (err) {
    obavijest(err.message, true);
  } finally {
    dugmad.forEach(b => { b.disabled = false; });
  }
});

/* Sakrij / prikaži: predavanje ostaje u adminu (s oznakom „Skriveno“), a u
   aplikaciji i na rasporedu ga nema. Bez obavijesti. */
function osvjeziSakrij() {
  $('#sakrij span').textContent = urediObjavljeno ? 'Sakrij iz aplikacije' : 'Prikaži u aplikaciji';
}
$('#sakrij').addEventListener('click', async () => {
  if (!urediId || !forma.reportValidity()) return;
  const b = $('#sakrij');
  b.disabled = true;
  try {
    const { predavanje: p } = await sacuvajPredavanje({ ...izForme(), objavljeno: !urediObjavljeno, obavijest: false }, tajna);
    lista = lista.filter(x => x.id !== p.id).concat(p);
    crtajSve();
    modal.close();
    obavijest(p.objavljeno === false ? 'Predavanje je sakriveno — u aplikaciji se ne vidi' : 'Predavanje je opet vidljivo u aplikaciji');
  } catch (err) { obavijest(err.message, true); }
  finally { b.disabled = false; }
});
$('#obrisi-dole').addEventListener('click', () => $('#obrisi').click());

$('#obrisi').addEventListener('click', async () => {
  if (!urediId || !confirm('Obrisati ovo predavanje? Ovo se ne može vratiti.')) return;
  try {
    await obrisiPredavanjeId(urediId, tajna);
    lista = lista.filter(x => x.id !== urediId);
    crtajSve();
    modal.close();
    obavijest('Predavanje je obrisano');
  } catch (err) { obavijest(err.message, true); }
});

/* Samo na localhostu: primjeri za brzo punjenje forme. Prvi su van BiH, s
   organizatorom — da se odmah vide zastava, država i sarajevsko vrijeme. */
const PRIMJERI = [
  { dana: 9, naslov: 'Oni koje Allah voli', podnaslov: 'Predavanje za mlade', vrijeme: '18:30',
    drzava: 'AT', zona: 'Europe/Vienna', grad: 'Beč', mjesto: 'Bošnjački kulturni centar', adresa: 'Hasnerstraße 12',
    organizator: 'Džemat Bosna Beč',
    opis: 'Ko su ljudi koje Allah voli i kako im se približiti — kroz ajete, hadise i živote ashaba.', link: 'https://ammarbasic.ba', stil: 'zelena' },
  { dana: 23, naslov: 'Učvrsti svoje srce', podnaslov: 'Večer s hafizom Ammarom Bašićem', vrijeme: '19:30',
    drzava: 'DE', zona: 'Europe/Berlin', grad: 'München', mjesto: 'Islamski kulturni centar Bošnjaka', adresa: 'Rosenheimer Straße 145',
    organizator: 'IZ Bošnjaka u Njemačkoj',
    opis: 'Predavanje o tome kako sačuvati srce mirnim i postojanim u vremenu kad je sve oko nas užurbano.', stil: 'krem',
    opcije: { hidzri: true } },
  { dana: 40, naslov: 'Na putu ka milosti', podnaslov: '', vrijeme: '19:00',
    drzava: 'US', zona: 'America/Chicago', grad: 'St. Louis', mjesto: 'Islamski centar Bosne i Hercegovine', adresa: '4485 Lindenwood Pl',
    organizator: 'Islamska zajednica Bošnjaka Sjeverne Amerike',
    opis: 'Večer posvećena milosti — onoj koju tražimo i onoj koju dugujemo drugima.', stil: 'zelena' },
  { dana: 55, naslov: 'Probudi svoje srce', podnaslov: 'Ramazanska tribina', vrijeme: '20:00',
    drzava: 'BA', zona: 'Europe/Sarajevo', grad: 'Sarajevo', mjesto: 'Gazi Husrev-begova džamija', adresa: 'Sarači 18',
    opis: 'Tribina o buđenju srca i povratku sebi.', stil: 'krem' },
];
let primjer = 0;
if (jeLokalniHost) {
  $('#test').hidden = false;
  $('#test').addEventListener('click', () => {
    const { dana, ...p } = PRIMJERI[primjer++ % PRIMJERI.length];
    uFormu({ ...p, datum: kljucD(new Date(Date.now() + dana * 864e5)) });
  });
}

/* Samo u lokalnom režimu: pet test predavanja (BiH i dijaspora) za
   pokazivanje aplikacije. Datumi kreću od narednog četvrtka, pa su uvijek
   pred nama. Na pravom serveru to bi otišlo u bazu i ljudima kao obavijest,
   pa se dugme tamo i ne pokazuje. `dana`: koliko dana poslije tog četvrtka. */
const TEST_PREDAVANJA = [
  { dana: 0, naslov: 'Halka hadisa', vrijeme: '18:30', vrijeme_opis: 'poslije jacije namaza', zona: 'Europe/Sarajevo',
    mjesto: 'Tabački mesdžid', adresa: 'Tabaci', grad: 'Sarajevo', drzava: 'BA', stil: 'zelena', opcije: { hidzri: true },
    opis: 'Zajedničko čitanje i tumačenje hadisa Allahovog Poslanika, s.a.v.s.' },
  { dana: 2, naslov: 'Učvrstimo naša srca', vrijeme: '18:30', vrijeme_opis: 'poslije jacije namaza', zona: 'Europe/Sarajevo',
    mjesto: 'Džemat Blatuša', adresa: '6W67+6X8, Zije Dizdarevića', grad: 'Zenica', drzava: 'BA', stil: 'krem', opcije: { hidzri: false },
    opis: 'Kako sačuvati iman i smiraj srca u vremenu iskušenja.' },
  { dana: 9, naslov: 'Snaga dove', podnaslov: 'Predavanje za omladinu', vrijeme: '18:30', vrijeme_opis: 'poslije jacije namaza', zona: 'Europe/Vienna',
    mjesto: 'Bošnjački džemat Beč', adresa: 'Hasnerstraße 12', grad: 'Beč', drzava: 'AT', stil: 'zelena', opcije: { hidzri: false },
    opis: 'O dovi kao oružju vjernika — kada, kako i zašto se dova prima.' },
  { dana: 16, naslov: 'Sabur — pola imana', vrijeme: '19:00', vrijeme_opis: 'poslije jacije namaza', zona: 'Europe/Berlin',
    mjesto: 'Bošnjački kulturni centar', adresa: 'Landsberger Straße 20', grad: 'München', drzava: 'DE', stil: 'krem', opcije: { hidzri: true },
    opis: 'Strpljenje u ibadetu, u nedaći i u odnosu prema ljudima — kroz ajete, hadise i živote ashaba.' },
  { dana: 23, naslov: 'Porodica na putu Dženneta', podnaslov: 'Predavanje za porodice', organizator: 'Bošnjačko udruženje Frankfurt',
    vrijeme: '18:30', vrijeme_opis: 'poslije jacije namaza', zona: 'Europe/Berlin',
    mjesto: 'Džemat Frankfurt', adresa: 'Hanauer Landstraße 80', grad: 'Frankfurt', drzava: 'DE', stil: 'zelena', opcije: { hidzri: false },
    opis: 'Brak, roditeljstvo i odgoj djece u dijaspori — kako dom učiniti mjestom bereketa.' },
];
$('[data-popuni]').addEventListener('click', async e => {
  if (!radiLokalno()) return;
  const b = e.currentTarget, d = new Date();
  // naredni četvrtak; kad je danas četvrtak, onaj za sedmicu
  const cet = new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((11 - d.getDay()) % 7 || 7));
  b.disabled = true;
  try {
    let dodano = 0;
    for (const { dana, ...p } of TEST_PREDAVANJA) {
      const datum = kljucD(new Date(cet.getFullYear(), cet.getMonth(), cet.getDate() + dana));
      if (lista.some(x => x.naslov === p.naslov && x.datum === datum)) continue;   // drugi klik ne duplira
      const { predavanje } = await sacuvajPredavanje({
        podnaslov: '', organizator: '', link: '', ...p, datum, objavljeno: true,
      }, tajna);
      lista.push(predavanje);
      dodano++;
    }
    crtajSve();
    obavijest(dodano ? `Dodano ${dodano} test predavanja` : 'Test predavanja su već dodana');
  } catch (err) { obavijest(err.message, true); }
  finally { b.disabled = false; }
});

/* ---------- drawer na telefonu: ručka gore i spuštanje prstom ----------
   Kao drawer u aplikaciji: ručka i zaglavlje vuku uvijek, tijelo tek kad je
   skrolano do vrha i potez krene nadolje. Pušten dalje od četvrtine visine
   (ili bačen) drawer se zatvara, inače se vrati na mjesto. */
const jeDrawer = () => matchMedia('(max-width: 720px)').matches;
function povlacenje(d) {
  let y0 = 0, x0 = 0, dy = 0, odluka = null, skrol = null, tragovi = [];
  const pomjeri = y => {
    dy = Math.max(0, y - y0);
    d.style.translate = `0 ${dy}px`;
    d.style.setProperty('--povuceno', String(Math.min(1, dy / d.offsetHeight)));
    tragovi.push([performance.now(), y]);
    if (tragovi.length > 5) tragovi.shift();
  };
  d.addEventListener('touchstart', e => {
    odluka = null;
    if (!jeDrawer() || e.touches.length > 1 || e.target.closest('input, textarea, select')) { odluka = 'ne'; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0;
    tragovi = [[performance.now(), y0]];
    // najbliži element koji stvarno skrola — za ručku i zaglavlje nebitan
    skrol = null;
    if (!e.target.closest('.rucka, .um__glava, .dijalog__glava')) {
      for (let n = e.target; n; n = n === d ? null : n.parentElement) {
        if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) { skrol = n; break; }
      }
    }
  }, { passive: true });
  d.addEventListener('touchmove', e => {
    if (odluka === 'ne') return;
    const t = e.touches[0];
    if (odluka === null) {
      const ddy = t.clientY - y0, ddx = t.clientX - x0;
      if (Math.abs(ddy) < 6 && Math.abs(ddx) < 6) return;
      odluka = ddy > 0 && Math.abs(ddy) > Math.abs(ddx) && (!skrol || skrol.scrollTop <= 0) ? 'da' : 'ne';
      if (odluka === 'ne') return;
      y0 = t.clientY;                            // od ove tačke, da drawer ne skoči
      d.style.transition = 'none';
    }
    if (e.cancelable) e.preventDefault();
    pomjeri(t.clientY);
  }, { passive: false });
  const kraj = () => {
    const vuklo = odluka === 'da';
    odluka = null;
    if (!vuklo) return;
    const a = tragovi[0], b = tragovi.at(-1), v = b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0;
    if (dy > Math.min(160, d.offsetHeight * .25) || (dy > 20 && v > .45)) {
      d.style.transition = 'translate .22s cubic-bezier(.2, .6, .35, 1)';
      d.style.translate = '0 105%';
      d.style.setProperty('--povuceno', '1');
      setTimeout(() => { d.close(); d.style.transition = d.style.translate = ''; d.style.removeProperty('--povuceno'); }, 220);
    } else {
      d.style.transition = 'translate .4s cubic-bezier(.32, .72, 0, 1)';
      d.style.translate = '';
      d.style.removeProperty('--povuceno');
    }
  };
  d.addEventListener('touchend', kraj);
  d.addEventListener('touchcancel', kraj);
}
$$('dialog.dijalog').forEach(povlacenje);

/* ---------- uređivanje na telefonu: podaci ili plakat ---------- */
function postaviDio(dio) {
  $('#uredi').dataset.dio = dio;
  $$('#uredi-tabovi button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dio === dio)));
  if (dio === 'plakat') osvjezi();          // sad se vidi — nacrtaj ga po stvarnoj širini
}
$$('#uredi-tabovi button').forEach(b => b.addEventListener('click', () => { postaviDio(b.dataset.dio); $('.uredi', modal).scrollTop = 0; }));

/* ---------- izvoz: jedna slika s rasporedom za mjesec ili period ----------
   Raspored ide samo za mreže — story i objava; A3 ostaje za plakat jednog
   predavanja. */
const RASPORED_FORMATI = PLAKAT_FORMATI.filter(f => f.id !== 'a3');
const izvoz = $('#izvoz');
let izvozNacin = 'mjesec', izvozFormat = 'objava', izvozStil = 'zelena';

function izvozPostavi(nacin) {
  izvozNacin = nacin;
  $$('#izvoz-nacin button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.nacin === nacin)));
  $$('#izvoz [data-za]').forEach(el => { el.hidden = el.dataset.za !== nacin; });
  izvozOsvjezi();
}

/** Objavljena predavanja u izabranom mjesecu ili periodu, redom. */
function zaIzvoz() {
  let od, do_;
  if (izvozNacin === 'mjesec') {
    const m = $('#izvoz-mjesec').value;                 // 'YYYY-MM'
    if (!m) return [];
    od = `${m}-01`; do_ = `${m}-31`;
  } else {
    od = $('#izvoz-od').value || '0000-01-01';
    do_ = $('#izvoz-do').value || '9999-12-31';
  }
  return lista.filter(p => p.datum >= od && p.datum <= do_ && p.objavljeno !== false).sort(poRedu);
}

const opisPerioda = () => {
  if (izvozNacin === 'mjesec') {
    const [g, m] = ($('#izvoz-mjesec').value || '').split('-').map(Number);
    return g ? `${MJESECI[m - 1].replace(/^./, c => c.toUpperCase())} ${g}.` : '';
  }
  const f = v => (v ? punDatumP(v) : '…');
  return `${f($('#izvoz-od').value)} – ${f($('#izvoz-do').value)}`;
};

/** Naslov i podnaslov na slici: mjesec je sam naslov, period ide ispod. */
const naslovRasporeda = () => {
  if (izvozNacin === 'mjesec') return { naslov: opisPerioda(), podnaslov: '' };
  const od = $('#izvoz-od').value, do_ = $('#izvoz-do').value;
  return { naslov: 'Raspored predavanja', podnaslov: od || do_ ? opisPerioda() : '' };
};

/* Izbor mjeseca: svaki mjesec od prvog do zadnjeg objavljenog predavanja
   (i tekući). */
function crtajMjesece() {
  const sel = $('#izvoz-mjesec');
  const mjeseci = lista.filter(p => p.objavljeno !== false).map(p => p.datum.slice(0, 7));
  const kljucevi = [...mjeseci, kljucD(new Date()).slice(0, 7), sel.value].filter(Boolean).sort();
  let [g, m] = kljucevi[0].split('-').map(Number);
  const opcije = [];
  for (let k = kljucevi[0]; k <= kljucevi.at(-1); m === 12 ? (g++, m = 1) : m++, k = `${g}-${p2(m)}`) {
    opcije.push(`<option value="${k}">${MJESECI[m - 1].replace(/^./, c => c.toUpperCase())} ${g}.</option>`);
  }
  const bilo = sel.value;
  sel.innerHTML = opcije.join('');
  sel.value = bilo;
}

function izvozOsvjezi() {
  crtajMjesece();
  const sel = $('#izvoz-mjesec');
  $('[data-korak="-1"]').disabled = sel.selectedIndex <= 0;
  $('[data-korak="1"]').disabled = sel.selectedIndex >= sel.options.length - 1;
  $$('#izvoz [data-izvezi]').forEach(b => { b.disabled = !zaIzvoz().length; });
  osvjeziRaspored();
}

/* Pregled se crta u zasebno platno pa prepiše — brzo kucanje datuma ne
   miješa dva crtanja u istom platnu. */
let rasporedPotez = 0, rasporedTajmer = 0;
function osvjeziRaspored() {
  clearTimeout(rasporedTajmer);
  rasporedTajmer = setTimeout(async () => {
    const red = zaIzvoz(), potez = ++rasporedPotez, pr = $('#izvoz-platno');
    $('.izvoz__pregled').classList.toggle('prazno', !red.length);
    if (!red.length) return;
    const cv = document.createElement('canvas');
    await nacrtajRaspored(cv, red, { format: izvozFormat, stil: izvozStil, ...naslovRasporeda(), mjerilo: 1 });
    if (potez !== rasporedPotez) return;
    pr.width = cv.width; pr.height = cv.height;
    pr.getContext('2d').drawImage(cv, 0, 0);
  }, 140);
}

// iste sličice kao izbor formata u aplikaciji: uski telefon i objava 4:5
const IKONA_FORMATA = {
  prica: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/>',
  objava: '<rect x="5" y="3.5" width="14" height="17" rx="2"/>',
};
$('#izvoz-format').innerHTML = RASPORED_FORMATI.map(f => `<button type="button" data-format="${f.id}" aria-pressed="${f.id === izvozFormat}"><svg class="ik ik--okvir" viewBox="0 0 24 24" aria-hidden="true">${IKONA_FORMATA[f.id]}</svg>${f.naziv}</button>`).join('');
$$('#izvoz-format button').forEach(b => b.addEventListener('click', () => {
  izvozFormat = b.dataset.format;
  $$('#izvoz-format button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  osvjeziRaspored();
}));
$$('#izvoz-boje button').forEach(b => b.addEventListener('click', () => {
  izvozStil = b.dataset.stil;
  $$('#izvoz-boje button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  osvjeziRaspored();
}));

$$('[data-izvoz]').forEach(b => b.addEventListener('click', () => {
  // prvi put: mjesec najbližeg predavanja koje dolazi, inače tekući
  if (!$('#izvoz-mjesec').value) {
    const danas = kljucD(new Date()), sel = $('#izvoz-mjesec');
    sel.innerHTML = `<option>${(lista.filter(p => p.datum >= danas).sort(poRedu)[0]?.datum || danas).slice(0, 7)}</option>`;
  }
  izvozPostavi(izvozNacin);
  izvoz.showModal();
}));
$$('#izvoz-nacin button').forEach(b => b.addEventListener('click', () => izvozPostavi(b.dataset.nacin)));
// strelice oko mjeseca: mjesec naprijed ili nazad, bez otvaranja liste
$$('[data-korak]').forEach(b => b.addEventListener('click', () => {
  const sel = $('#izvoz-mjesec'), i = sel.selectedIndex + Number(b.dataset.korak);
  if (i < 0 || i >= sel.options.length) return;
  sel.selectedIndex = i;
  izvozOsvjezi();
}));
['#izvoz-mjesec', '#izvoz-od', '#izvoz-do'].forEach(id => $(id).addEventListener('input', izvozOsvjezi));
izvoz.addEventListener('click', e => { if (e.target === izvoz) izvoz.close(); });   // klik pored kartice zatvara

function spusti(blob, ime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ime;
  document.body.append(a);                              // Firefox preuzima samo link koji je u stranici
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const rasporedSlika = (red, format) => rasporedBlob(red, {
  format, stil: izvozStil, ...naslovRasporeda(),
});
const imeRasporeda = format => `raspored-${imeDat(opisPerioda())}-${RASPORED_FORMATI.find(f => f.id === format).naziv.toLowerCase()}.png`;

/** Slika rasporeda u izabranom formatu. */
async function izveziRaspored(red, dugme) {
  const natpis = $('span', dugme), staro = natpis.textContent;
  dugme.disabled = true;
  natpis.textContent = 'Pravim…';
  try {
    spusti(await rasporedSlika(red, izvozFormat), imeRasporeda(izvozFormat));
    obavijest('Raspored je preuzet');
  } catch (e) {
    obavijest(`Izvoz nije uspio: ${e.message}`, true);
  } finally {
    natpis.textContent = staro;
    dugme.disabled = false;
  }
}

$$('#izvoz [data-izvezi]').forEach(b => b.addEventListener('click', () => {
  const red = zaIzvoz();
  if (!red.length) return;
  izveziRaspored(red, b);
}));

/* ---------- poruke (citati) ---------- */
/* Za sada se čuvaju u ovom pregledniku — kako će ići na produkciji (baza
   ili fajl) odlučuje se kasnije. */
let izvor = null;          // poruke.json sa servera
let citati = [];
let urediCitat = null;

async function ucitajCitate() {
  if (!izvor) {
    izvor = await fetch('/data/poruke.json', { cache: 'no-cache' }).then(r => r.json());
    let lok = null;
    try { lok = JSON.parse(localStorage.getItem(CITATI)); } catch { /* nema */ }
    citati = lok || izvor.poruke.slice();
    const opcijeKnjiga = izvor.knjige.map(k => `<option value="${k.id}">${esc(k.naslov)}</option>`).join('');
    $('#citati-knjiga').innerHTML = `<option value="">Sve knjige</option>${opcijeKnjiga}`;
    $('#citat-knjiga').innerHTML = opcijeKnjiga;
    ucitajStatistikuPoruka();                    // ne čeka se — lista se vidi odmah, brojke stignu
  }
  crtajCitate();
}

/* Statistika po poruci (/api/analitika?poruke=1): koliko je puta bila poruka
   dana, zadnji put, dijeljenja. Lokalno servera nema — tada se vidi samo kad
   poruka sljedeći put dolazi, što se računa iz redoslijeda. */
let statPoruka = null;
async function ucitajStatistikuPoruka() {
  if (jeLokalniHost) return;
  try {
    const r = await fetch('/api/analitika?poruke=1', { cache: 'no-store', headers: { Authorization: `Bearer ${tajna}` } });
    if (r.ok) { statPoruka = (await r.json()).poruke || {}; crtajCitate(); }
  } catch { /* bez brojki — lista radi isto */ }
}

/* Poruka dana = dan % broj poruka (kao u aplikaciji), pa se iz mjesta u
   listi zna za koliko dana poruka dolazi: 0 je danas. */
function zaKolikoDana(i, n) {
  const d = new Date(), t = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  return (((i - t) % n) + n) % n;
}
const kratkiDatum = d => `${d.getDate()}. ${MJESECI_KRATKO[d.getMonth()]}`;

function statistikaCitata(c) {
  const k = zaKolikoDana(citati.indexOf(c), citati.length);
  const s = statPoruka?.[c.id];
  const dalje = new Date(); dalje.setDate(dalje.getDate() + k);
  const dijeljeno = s ? (s.dijeljenje || 0) + (s.preuzimanje || 0) + (s.kopiranje || 0) : 0;
  return [
    k === 0 ? '<b class="danas">Danas je poruka dana</b>' : `sljedeći put ${kratkiDatum(dalje)}`,
    s ? `${s.prikazano || 0}× poruka dana${s.zadnje && k !== 0 ? ` · zadnji put ${kratkiDatum(new Date(`${s.zadnje}T12:00:00`))}` : ''}` : '',
    dijeljeno ? `podijeljeno ${dijeljeno} (7 dana)` : '',
    s?.sacuvano ? `sačuvano ${s.sacuvano} (7 dana)` : '',
  ].filter(Boolean).map(t => `<span>${t}</span>`).join('');
}

const imeKnjige = id => izvor?.knjige.find(k => k.id === id)?.naslov || id || '';
const oznaci = (t, q) => (q ? esc(t).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>') : esc(t));

function crtajCitate() {
  const q = $('#citati-trazi').value.trim();
  const ql = q.toLowerCase();
  const knjiga = $('#citati-knjiga').value;
  const red = citati.filter(c => (!knjiga || c.knjiga === knjiga)
    && (!ql || [c.tekst, c.poglavlje, c.tema, imeKnjige(c.knjiga)].join(' ').toLowerCase().includes(ql)));
  $('#citati-broj').textContent = `${red.length} od ${citati.length}`;
  const lokalno = localStorage.getItem(CITATI) !== null;
  $('#citati-izmjene').textContent = lokalno ? 'Izmjene su samo u ovom pregledniku — izvezi ih za objavu' : '';
  $('#citati-ponisti').hidden = !lokalno;
  // redni broj je mjesto citata u redoslijedu kojim ih aplikacija prikazuje, dan za danom
  $('#citati').innerHTML = red.map(c => `<div class="citat" data-citat="${c.id}">
    <span class="citat__br">${citati.indexOf(c) + 1}.</span>
    <p>${oznaci(c.tekst, q)}</p>
    <span class="sitno">${oznaci(imeKnjige(c.knjiga), q)}${c.poglavlje || c.tema ? ` · ${oznaci(c.poglavlje || c.tema, q)}` : ''}</span>
    <span class="citat__stat">${statistikaCitata(c)}</span>
  </div>`).join('') || '<p class="prazno">Nijedan citat ne odgovara pretrazi.</p>';
}
$('#citati-trazi').addEventListener('input', crtajCitate);
$('#citati-knjiga').addEventListener('change', crtajCitate);

const citatModal = $('#citat-modal');
citatModal.addEventListener('click', e => { if (e.target === citatModal) citatModal.close(); });   // klik pored kartice zatvara

function otvoriCitat(c = null) {
  urediCitat = c;
  $('#citat-naslov').textContent = c ? 'Uredi poruku' : 'Nova poruka';
  $('#citat-tekst').value = c?.tekst || '';
  $('#citat-knjiga').value = c?.knjiga || izvor.knjige[0]?.id || '';
  $('#citat-poglavlje').value = c?.poglavlje || c?.tema || '';
  $('#citat-obrisi').hidden = !c;
  citatModal.showModal();
  // na telefonu tastatura ne iskače sama — prvo se vidi cijeli drawer
  if (!jeDrawer()) $('#citat-tekst').focus();
}
$('#citat-novi').addEventListener('click', async () => { await ucitajCitate(); otvoriCitat(); });
$('#citati').addEventListener('click', e => {
  const b = e.target.closest('[data-citat]');
  if (b) otvoriCitat(citati.find(c => String(c.id) === b.dataset.citat));
});
$('#citat-odustani').addEventListener('click', () => citatModal.close());

function pisiCitate() {
  try { localStorage.setItem(CITATI, JSON.stringify(citati)); } catch { obavijest('Preglednik ne da da se sačuva', true); }
  crtajCitate();
}
$('#citat-sacuvaj').addEventListener('click', () => {
  const tekst = $('#citat-tekst').value.trim();
  if (!tekst) return obavijest('Tekst poruke je prazan', true);
  const polja = { tekst, knjiga: $('#citat-knjiga').value, poglavlje: $('#citat-poglavlje').value.trim() || undefined };
  if (urediCitat) Object.assign(urediCitat, polja);
  else citati.push({ id: Math.max(0, ...citati.map(c => Number(c.id) || 0)) + 1, ...polja });
  citatModal.close();
  pisiCitate();
  obavijest(urediCitat ? 'Poruka je izmijenjena' : 'Poruka je dodana');
});
$('#citat-obrisi').addEventListener('click', () => {
  if (!urediCitat || !confirm('Obrisati ovu poruku?')) return;
  citati = citati.filter(c => c !== urediCitat);
  citatModal.close();
  pisiCitate();
});
$('#citati-ponisti').addEventListener('click', () => {
  if (!confirm('Vratiti poruke na verziju sa servera? Izmjene iz ovog preglednika se gube.')) return;
  localStorage.removeItem(CITATI);
  citati = izvor.poruke.slice();
  crtajCitate();
});

/* ---------- start ---------- */
if (await ucitaj()) uFormu();
