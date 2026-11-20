/* ============================================================
   ADMIN — naredna predavanja, uređivanje s plakatom u modalu, poruke,
   dizajner poruke za mreže
   ============================================================ */
import {
  ZEMLJE, ZONE, SARAJEVO, OPCIJE, MJESECI, MJESECI_KRATKO,
  zemlja, imeZemlje, proslo, linkPlakata, danUSedmici, punDatumP,
  ucitajPredavanja, sacuvajPredavanje, obrisiPredavanjeId, radiLokalno,
} from '/js/predavanja-jezgro.js';
import {
  PLAKAT_FORMATI, nacrtajPlakat, plakatBlob, imePlakata, nacrtajRaspored, rasporedBlob, mjeriloEkrana,
  nacrtajPoruku, porukaBlob, imePoruke,
} from '/js/plakat.js';

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
  el.textContent = t; el.classList.toggle('greska', greska); el.classList.remove('sa-dugmetom'); el.classList.add('on');
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
    pogled(pogledIzAdrese());
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

/* ---------- pogledi ----------
   Otvoreni ekran stoji u adresi (#poruke, #statistika…), pa ga osvježavanje
   stranice ne vraća na predavanja. */
const ADRESE = { lista: 'predavanja', citati: 'poruke', dizajner: 'dizajner', statistika: 'statistika', grafike: 'grafike' };
const pogledIzAdrese = () => Object.keys(ADRESE).find(k => `#${ADRESE[k]}` === location.hash) || 'lista';

function pogled(ime) {
  $$('[data-pogled]').forEach(s => { s.hidden = s.dataset.pogled !== ime; });
  $$('[data-tab]').forEach(b => b.setAttribute('aria-current', String(b.dataset.tab === ime)));
  history.replaceState(null, '', `${location.pathname}${location.search}#${ADRESE[ime]}`);
  scrollTo({ top: 0 });
  if (ime === 'citati') ucitajCitate();
  if (ime === 'dizajner') dzOtvori();               // sad se vidi — crta se po stvarnoj širini
  if (ime === 'statistika') ucitajStatistiku();
  if (ime === 'grafike') ucitajGrafike();
}

/* Grafike su stranica /grafike, ugrađena tek kad se tab prvi put otvori.
   Okvir raste sa sadržajem, kao kod statistike — bez skrola unutar skrola. */
function ucitajGrafike() {
  const okvir = $('#grafike');
  if (okvir.src) return;
  okvir.addEventListener('load', () => {
    const dok = okvir.contentDocument;
    if (!dok) return;
    const visina = () => { okvir.style.height = `${dok.documentElement.scrollHeight}px`; };
    new ResizeObserver(visina).observe(dok.body);
    visina();
  });
  okvir.src = '/grafike/';
}

/* Statistika je stranica /analytics, ugrađena tek kad se tab prvi put otvori.
   Ista je adresa, pa šifru čita iz istog preglednika. Okvir raste s
   sadržajem, da se lista kao i ostali tabovi, bez skrola unutar skrola. */
function ucitajStatistiku() {
  const okvir = $('#statistika');
  if (okvir.src) return;
  /* Krug admina stoji dok stranica ne dobije podatke (ili ne zatraži šifru),
     pa se okvir pokaže gotov — bez drugog kruga u njemu. */
  const pokazi = () => { $('#statistika-ucitava').hidden = true; okvir.classList.add('spremno'); };
  setTimeout(pokazi, 15000);   // ako stranica zapne, bar se vidi šta je stalo
  okvir.addEventListener('load', () => {
    const dok = okvir.contentDocument;
    if (!dok) { pokazi(); return; }
    const visina = () => { okvir.style.height = `${dok.documentElement.scrollHeight}px`; };
    new ResizeObserver(visina).observe(dok.body);
    visina();
    const gotovo = () => !dok.querySelector('#sadrzaj .ucitava');
    if (gotovo()) { pokazi(); return; }
    const mo = new MutationObserver(() => { if (gotovo()) { mo.disconnect(); pokazi(); } });
    mo.observe(dok.body, { childList: true, subtree: true });
  });
  okvir.src = '/analytics/';
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
      <div><b>${esc(p.naslov)}</b><span class="sitno">${ikona('i-sat')}${esc(p.vrijeme)} ${ikona('i-mjesto')}<span>${esc([p.grad || p.mjesto, p.drzava !== 'BA' ? imeZemlje(p.drzava) : ''].filter(Boolean).join(', '))}</span>${(p.drzava || 'BA') !== 'BA' ? zastavica(p.drzava) : ''}</span></div>
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

/* „Poništi“ vraća formu kakva je bila pri otvaranju: novo — prazna, izmjena —
   podaci kakvi su sačuvani. Modal ostaje otvoren. */
let pocetno = {};
$('#ponisti-formu').addEventListener('click', () => { uFormu(pocetno); obavijest('Izmjene su poništene'); });

/** Lista ponovo sa servera — poslije čuvanja, sakrivanja i brisanja, da admin
    vidi tačno ono što je u bazi (i ono što je u međuvremenu dodao neko drugi). */
async function osvjeziListu() {
  try { lista = await ucitajPredavanja({ sve: true, tajna }); } catch { /* ostaje lokalno ažurirana */ }
  crtajSve();
}

function uFormu(p = {}) {
  pocetno = p;
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
      : push.kasnije ? ' · obavijest kreće najkasnije za sat'
      : ` · obavijest otišla na ${push.poslano} uređaja`;
    obavijest(`${bilo ? 'Izmjene su sačuvane' : 'Predavanje je objavljeno'}${poslano}`);
    osvjeziListu();
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
    osvjeziListu();
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
    osvjeziListu();
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

/* ---------- poruke (citati) i raspored ----------
   Poruke i raspored po datumima su u bazi (/api/poruke): „Sačuvaj“ upisuje
   odmah, a aplikacija i notifikacije vide izmjenu za minut-dva. Poruka dana
   = aktivne poruke po redoslijedu, broj dana % broj poruka — osim dana za
   koje je zakazana druga. Lokalno, bez /api, sve ide u ovaj preglednik. */
const RASPORED_LOK = 'pd.rasporedLokalno';
const PORUKE_POGLED = 'pd.adminPorukePogled';
let izvor = null;          // poruke.json sa servera: knjige (i rezervna lista)
let citati = [];           // sve poruke, i obrisane, po redoslijedu
let raspored = {};         // { 'YYYY-MM-DD': id }
let porukeLokalno = false;
let porukeNapomena = '';
let urediCitat = null;
let porukePogled = localStorage.getItem(PORUKE_POGLED) === 'kalendar' ? 'kalendar' : 'lista';

const aktivni = () => citati.filter(c => !c.obrisana);

async function ucitajCitate() {
  if (!izvor) {
    izvor = await fetch('/data/poruke.json', { cache: 'no-cache' }).then(r => r.json());
    const opcijeKnjiga = izvor.knjige.map(k => `<option value="${k.id}">${esc(k.naslov)}</option>`).join('');
    $('#citat-knjiga').innerHTML = opcijeKnjiga;
    await procitajPoruke();
    ucitajStatistikuPoruka();                    // ne čeka se — lista se vidi odmah, brojke stignu
  }
  crtajPoruke();
}

/* Poziv na /api/poruke. Lokalno (statični server, nema JSON-a) vraća null. */
async function apiPoruke(metoda = 'GET', upit = '', tijelo) {
  const r = await fetch(`/api/poruke${upit}`, {
    method: metoda,
    cache: 'no-store',
    headers: {
      ...(metoda !== 'GET' ? { Authorization: `Bearer ${tajna}` } : {}),
      ...(tijelo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: tijelo ? JSON.stringify(tijelo) : undefined,
  });
  if (!(r.headers.get('content-type') || '').includes('json')) {
    if (jeLokalniHost) return null;
    throw new Error(`Server je vratio ${r.status}`);
  }
  const d = await r.json();
  if (!r.ok) throw new Error(d.greska || `Greška ${r.status}`);
  return d;
}

async function procitajPoruke() {
  await procitajIzvor();
  oznaciKrug(citati);
}
async function procitajIzvor() {
  porukeNapomena = '';
  try {
    const d = await apiPoruke('GET', '?svjeze=1');
    if (d) {
      porukeLokalno = false;
      raspored = d.raspored || {};
      if (d.poruke.length) { citati = d.poruke; return; }
      porukeNapomena = 'Baza poruka je prazna — prikazane su poruke iz poruke.json. Pokreni sql/poruke-pocetne.sql.';
      citati = izvor.poruke.map((p, i) => ({ ...p, redoslijed: i + 1 }));
      return;
    }
  } catch (e) {
    porukeNapomena = `Poruke iz baze nisu stigle (${e.message}) — prikazane su iz poruke.json, čuvanje ne radi.`;
    citati = izvor.poruke.map((p, i) => ({ ...p, redoslijed: i + 1 }));
    return;
  }
  // lokalno: ovaj preglednik
  porukeLokalno = true;
  let lok = null;
  try { lok = JSON.parse(localStorage.getItem(CITATI)); } catch { /* nema */ }
  citati = lok || izvor.poruke.map((p, i) => ({ ...p, redoslijed: i + 1 }));
  try { raspored = JSON.parse(localStorage.getItem(RASPORED_LOK)) || {}; } catch { raspored = {}; }
}

function pisiLokalno() {
  oznaciKrug(citati);
  try {
    localStorage.setItem(CITATI, JSON.stringify(citati));
    localStorage.setItem(RASPORED_LOK, JSON.stringify(raspored));
  } catch { obavijest('Preglednik ne da da se sačuva', true); }
}

/* Statistika po poruci (/api/analitika?poruke=1): koliko je puta bila poruka
   dana, zadnji put, dijeljenja. Lokalno servera nema — tada se vidi samo kad
   poruka sljedeći put dolazi. */
let statPoruka = null;
async function ucitajStatistikuPoruka() {
  if (jeLokalniHost) return;
  try {
    const r = await fetch('/api/analitika?poruke=1', { cache: 'no-store', headers: { Authorization: `Bearer ${tajna}` } });
    if (r.ok) { statPoruka = (await r.json()).poruke || {}; crtajCitate(); }
  } catch { /* bez brojki — lista radi isto */ }
}

/* ---------- koja je poruka kojeg dana ----------
   Isto pravilo kao aplikacija i slanje (porukaZaDatum u api/_lib/push.js):
   poruka koju je admin izabrao za dan; inače krug se nastavlja od zadnjeg
   izabranog dana (dan poslije poruke X dobija poruku iza X); dok ništa nije
   izabrano — broj dana % broj poruka, kao ranije. */
const brojDanaK = k => { const [g, m, d] = k.split('-').map(Number); return Math.floor(Date.UTC(g, m - 1, d) / 864e5); };
const izKljucaD = k => { const [g, m, d] = k.split('-').map(Number); return new Date(g, m - 1, d); };
const pomakni = (k, n) => { const d = izKljucaD(k); d.setDate(d.getDate() + n); return kljucD(d); };
const danasK = () => kljucD(new Date());

/* Poruka dana kreće u 10 h po Sarajevu. Od tada se današnji dan (kao i svi
   prošli) više ne mijenja — ni ovdje, ni na serveru (/api/poruke to odbija). */
const SAT_PORUKE = 10;
const satSarajevo = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sarajevo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const zakljucan = k => k < danasK() || (k === danasK() && satSarajevo() >= SAT_PORUKE);

/* Krug na određeni dan čine poruke koje su tada postojale: početne oduvijek,
   nova od dana poslije dodavanja, obrisana do dana brisanja. Tako se
   prošlost ne preračunava kad se lista promijeni — nova poruka nikad ne
   ispadne „bila prije X dana“. Isto kao oznaciKrug u api/_lib/push.js. */
const DAN_SARAJEVO = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sarajevo', year: 'numeric', month: '2-digit', day: '2-digit' });
const danSarajevoT = t => {
  const x = Object.fromEntries(DAN_SARAJEVO.formatToParts(new Date(t)).map(p => [p.type, p.value]));
  return `${x.year}-${x.month}-${x.day}`;
};
function oznaciKrug(sve) {
  const t = p => Date.parse(p.napravljeno);
  // početne: upisane zajedno, prvim upisom — ili, kad neke nemaju vrijeme (poruke.json), baš te
  const prvi = sve.some(p => !Number.isFinite(t(p))) ? NaN : Math.min(...sve.map(t));
  for (const p of sve) {
    p._od = Number.isFinite(t(p)) && t(p) !== prvi ? danSarajevoT(t(p)) : '';
    p._do = !p.obrisana ? null : Number.isFinite(Date.parse(p.izmijenjeno)) ? danSarajevoT(p.izmijenjeno) : '';
  }
  return sve;
}
const uKrugu = (p, k) => (p._od ?? '') < k && (p._do == null || k < p._do);
const krugDana = k => { const krug = citati.filter(c => uKrugu(c, k)); return krug.length ? krug : aktivni(); };

/** Poruka izabrana za dan, ako je još aktivna. */
const izabrana = (k, lista = aktivni()) => (raspored[k] != null && lista.find(c => c.id === raspored[k])) || null;

/** Šta ide na dan bez izbora: nastavak kruga od zadnjeg izabranog dana. */
function nastavak(k) {
  const krug = krugDana(k), n = krug.length;
  if (!n) return null;
  for (const x of Object.keys(raspored).filter(y => y < k).sort().reverse()) {
    const j = krug.findIndex(c => c.id === raspored[x]);
    if (j >= 0) return krug[(j + brojDanaK(k) - brojDanaK(x)) % n];
  }
  return krug[((brojDanaK(k) % n) + n) % n];
}
const porukaNaDan = (k, lista = aktivni()) => izabrana(k, lista) || nastavak(k);

/** Poruke za `n` uzastopnih dana od `od`, u jednom prolazu: dan bez izbora je
    poruka iza one od prethodnog dana (u krugu tog dana) — isto što i
    nastavak kruga. */
function niz(od, n) {
  const lista = aktivni(), dani = [];
  if (!lista.length) return dani;
  let k = od, prije = null;
  for (let i = 0; i < n; i++, k = pomakni(k, 1)) {
    let p = izabrana(k, lista);
    if (!p) {
      const krug = prije ? krugDana(k) : null;
      const j = krug ? krug.indexOf(prije) : -1;
      p = j >= 0 ? krug[(j + 1) % krug.length] : nastavak(k);
    }
    dani.push(p);
    prije = p;
  }
  return dani;
}

const kratkiDatum = d => `${d.getDate()}. ${MJESECI_KRATKO[d.getMonth()]}`;
const zaDana = k => (k === 1 ? 'sutra' : `za ${k} dana`);
const prijeDana = k => (k === 1 ? 'jučer' : `prije ${k} dana`);
const imeKnjige = id => izvor?.knjige.find(k => k.id === id)?.naslov || id || '';
const oznaci = (t, q) => (q ? esc(t).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>') : esc(t));
// svaka knjiga svoja boja — u kalendaru, listi i izboru se vidi kako se smjenjuju
const BOJE_KNJIGA = ['#E9C77E', '#8FC9A8', '#E39C80', '#93B5E6', '#C6A2E0', '#E59AB4', '#B9C97A', '#7FC4C9'];
const bojaKnjige = id => BOJE_KNJIGA[Math.max(0, izvor.knjige.findIndex(k => k.id === id)) % BOJE_KNJIGA.length];

function crtajPoruke() {
  const kal = porukePogled === 'kalendar';
  $$('[data-poruke-pogled]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.porukePogled === porukePogled)));
  $('#poruke-lista').hidden = kal;
  $('#poruke-kalendar').hidden = !kal;
  $('#citati-izmjene').textContent = porukeLokalno ? 'Lokalni režim — poruke se čuvaju u ovom pregledniku' : porukeNapomena;
  if (kal) crtajKalendar(); else crtajCitate();
}

/* ---------- lista ----------
   Svaka poruka jednom, s bojom svoje knjige i tabovima po knjigama. Šta ide
   kojeg dana — to je kalendar. */
let filtKnjiga = '';

function statistikaCitata(c, naprijed) {
  const k = naprijed.indexOf(c);
  const s = statPoruka?.[c.id];
  const danas = danasK();
  const izabrano = Object.keys(raspored).filter(d => d > danas && raspored[d] === c.id).sort();
  const dijeljeno = s ? (s.dijeljenje || 0) + (s.preuzimanje || 0) + (s.kopiranje || 0) : 0;
  return [
    k === 0 ? '<b class="danas">Danas je poruka dana</b>'
      : k > 0 ? `sljedeći put ${kratkiDatum(izKljucaD(pomakni(danas, k)))}` : '',
    izabrano.length ? `<b class="zakazano">izabrana: ${izabrano.slice(0, 3).map(d => kratkiDatum(izKljucaD(d))).join(', ')}${izabrano.length > 3 ? ` +${izabrano.length - 3}` : ''}</b>` : '',
    s ? `${s.prikazano || 0}× poruka dana${s.zadnje && k !== 0 ? ` · zadnji put ${kratkiDatum(new Date(`${s.zadnje}T12:00:00`))}` : ''}` : '',
    dijeljeno ? `podijeljeno ${dijeljeno} (7 dana)` : '',
    s?.sacuvano ? `sačuvano ${s.sacuvano} (7 dana)` : '',
  ].filter(Boolean).map(t => `<span>${t}</span>`).join('');
}

/** Tabovi po knjigama (lista i izbor poruke za dan): tačka u boji knjige,
    naziv i broj poruka u bedžu; aktivan tab podvučen bojom knjige. */
function crtajTaboveKnjiga(el, lista, aktivna) {
  const broj = id => lista.filter(c => c.knjiga === id).length;
  el.innerHTML = [
    `<button type="button" role="tab" class="knjiga-tab" data-knjiga="" aria-selected="${!aktivna}">Sve <span class="bedz">${lista.length}</span></button>`,
    ...izvor.knjige.filter(k => broj(k.id)).map(k => `<button type="button" role="tab" class="knjiga-tab" data-knjiga="${k.id}"
      aria-selected="${aktivna === k.id}" style="--knjiga:${bojaKnjige(k.id)}"><i></i>${esc(k.naslov)} <span class="bedz">${broj(k.id)}</span></button>`),
  ].join('');
  // aktivan tab u vidno polje — skrola samo traka tabova, ne stranica
  const a = el.querySelector('[aria-selected="true"]');
  if (a && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, a.offsetLeft - (el.clientWidth - a.offsetWidth) / 2);
}
const crtajKnjigeFilter = lista => crtajTaboveKnjiga($('#citati-knjige'), lista, filtKnjiga);

function crtajCitate() {
  if (porukePogled === 'kalendar') return;
  const q = $('#citati-trazi').value.trim();
  const ql = q.toLowerCase();
  const lista = aktivni();
  const naprijed = niz(danasK(), 400);
  crtajKnjigeFilter(lista);
  const red = lista.filter(c => (!filtKnjiga || c.knjiga === filtKnjiga)
    && (!ql || [c.tekst, c.poglavlje, c.tema, imeKnjige(c.knjiga)].join(' ').toLowerCase().includes(ql)));
  $('#citati-broj').textContent = `${red.length} od ${lista.length}`;
  // redni broj je mjesto poruke u krugu kojim ih aplikacija prikazuje, dan za danom
  $('#citati').innerHTML = red.map(c => `<div class="citat" data-citat="${c.id}" style="--knjiga:${bojaKnjige(c.knjiga)}">
    <span class="citat__br">${lista.indexOf(c) + 1}.</span>
    <p>${oznaci(c.tekst, q)}</p>
    <span class="sitno"><b class="citat__knjiga">${oznaci(imeKnjige(c.knjiga), q)}</b>${c.poglavlje || c.tema ? ` · ${oznaci(c.poglavlje || c.tema, q)}` : ''}</span>
    <span class="citat__stat">${statistikaCitata(c, naprijed)}</span>
  </div>`).join('') || '<p class="prazno">Nijedna poruka ne odgovara pretrazi.</p>';
}
$('#citati-trazi').addEventListener('input', crtajCitate);
$('#citati-knjige').addEventListener('click', e => {
  const b = e.target.closest('[data-knjiga]');
  if (!b) return;
  filtKnjiga = filtKnjiga === b.dataset.knjiga ? '' : b.dataset.knjiga;
  crtajCitate();
});
$$('[data-poruke-pogled]').forEach(b => b.addEventListener('click', () => {
  porukePogled = b.dataset.porukePogled;
  try { localStorage.setItem(PORUKE_POGLED, porukePogled); } catch { /* tiho */ }
  crtajPoruke();
}));

/* ---------- kalendar ----------
   Mjesec po danima: knjiga, tekst i koliko je dana prošlo od prošlog puta
   iste poruke. Dan bez izbora je prazan, s „Izaberi“; ako ostane prazan, ide
   poruka po redoslijedu (nastavak kruga) — sitno piše koja.
   Na telefonu je mjesec lista dana. */
let kalMjesec = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
const DANI_KRATKO = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
const NAZAD = 400;   // koliko dana unazad se traži prethodno pojavljivanje

function crtajKalendar() {
  const lista = aktivni();
  const n = lista.length;
  const prvi = kljucD(kalMjesec);
  const dana = new Date(kalMjesec.getFullYear(), kalMjesec.getMonth() + 1, 0).getDate();
  const dani = niz(pomakni(prvi, -NAZAD), NAZAD + dana + NAZAD);    // i unaprijed, za „ponovo za“
  const danas = danasK();
  const mj = MJESECI[kalMjesec.getMonth()];
  $('#kal-naslov').textContent = `${mj[0].toUpperCase()}${mj.slice(1)} ${kalMjesec.getFullYear()}.`;
  $('#kal-danas').disabled = prvi === kljucD(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const celije = [];
  for (let i = 0; i < (kalMjesec.getDay() + 6) % 7; i++) celije.push('<span class="kal-dan kal-dan--prazno"></span>');
  for (let i = 0; i < dana; i++) {
    const k = pomakni(prvi, i);
    const j = NAZAD + i;
    const p = dani[j];
    if (!p) continue;
    const d = izKljucaD(k);
    const sedmica = (d.getDay() + 6) % 7;
    const zaklj = zakljucan(k);
    const iz = !!izabrana(k, lista);
    const br = lista.indexOf(p) + 1;
    const datum = `<span class="kal-dan__datum"><b>${d.getDate()}</b><small>${DANI_KRATKO[sedmica]}</small></span>`;
    const klase = `kal-dan${k === danas ? ' danas' : ''}${sedmica === 0 ? ' pon' : ''}`;

    // dan bez izbora, koji se još može mijenjati: prazan; ako ostane prazan,
    // ide poruka po redoslijedu (nastavak kruga) — sitno piše koja
    if (!iz && !zaklj) {
      celije.push(`<button type="button" class="${klase} kal-dan--bez" data-dan="${k}" data-poruka=""
          title="${esc(`${kratkiDatum(d)}: poruka nije izabrana — ako ostane tako, ide po redoslijedu: poruka ${br}`)}">
        ${datum}
        <span class="kal-dan__izaberi">+ Izaberi</span>
        <span class="kal-dan__inace">inače ${br} · ${esc(imeKnjige(p.knjiga))}</span>
      </button>`);
      continue;
    }

    let prije = 0, poslije = 0;
    for (let x = j - 1; x >= 0; x--) if (dani[x] === p) { prije = j - x; break; }
    for (let x = j + 1; x < dani.length; x++) if (dani[x] === p) { poslije = x - j; break; }
    const opis = [
      `${DANI_KRATKO[sedmica]}, ${kratkiDatum(d)}: poruka ${br}, ${imeKnjige(p.knjiga)}`,
      iz ? '' : 'nije bila izabrana — išla je po redoslijedu',
      prije ? `ista poruka ${prijeDana(prije)}` : 'ranije nije bila poruka dana',
      poslije ? `ponovo ${zaDana(poslije)}` : '',
      zaklj && k === danas ? `poslana u ${SAT_PORUKE} h — više se ne mijenja` : '',
    ].filter(Boolean).join(' · ');
    celije.push(`<button type="button" class="${klase}" data-dan="${k}" data-poruka="${p.id}"
        style="--knjiga:${bojaKnjige(p.knjiga)}" title="${esc(opis)}"${zaklj ? ' disabled' : ''}>
      ${datum}
      <span class="kal-dan__br">${br}</span>
      <span class="kal-dan__knjiga">${esc(imeKnjige(p.knjiga))}</span>
      <p>${esc(p.tekst)}</p>
      <span class="kal-dan__ponovo${prije && prije < n ? ' brzo' : ''}">${prije ? `↻ ${prije} d` : ''}</span>
    </button>`);
  }
  $('#kal').innerHTML = DANI_KRATKO.map(d => `<span class="kal__ime">${d}</span>`).join('') + celije.join('');
  $('#kal-legenda').innerHTML = izvor.knjige
    .map(k => `<span><i class="kal-knjiga" style="--knjiga:${bojaKnjige(k.id)}"></i>${esc(k.naslov)}</span>`).join('');
}
$('#kal-nazad').addEventListener('click', () => { kalMjesec.setMonth(kalMjesec.getMonth() - 1); crtajKalendar(); });
$('#kal-naprijed').addEventListener('click', () => { kalMjesec.setMonth(kalMjesec.getMonth() + 1); crtajKalendar(); });
$('#kal-danas').addEventListener('click', () => { const d = new Date(); kalMjesec = new Date(d.getFullYear(), d.getMonth(), 1); crtajKalendar(); });
$('#kal').addEventListener('click', e => {
  if (poslijeVuce) return;
  const b = e.target.closest('[data-dan]');
  if (b && !b.disabled) otvoriDan(b.dataset.dan);
});

/* Prelaz mišem preko dana istakne sve dane tog mjeseca s istom porukom —
   ponavljanje se vidi bez čitanja brojeva. */
$('#kal').addEventListener('mouseover', e => {
  if (vuca?.aktivno) return;
  const id = e.target.closest('[data-poruka]')?.dataset.poruka;
  $$('#kal [data-poruka]').forEach(c => c.classList.toggle('ista', !!id && c.dataset.poruka === id));
});
$('#kal').addEventListener('mouseleave', () => $$('#kal .ista').forEach(c => c.classList.remove('ista')));

/** Upisuje izbor za više dana odjednom: { 'YYYY-MM-DD': id ili null } (null
    briše izbor — dan tada nastavlja krug). Kalendar se mijenja odmah, ne
    čeka server; ako upis padne, raspored se ponovo čita iz baze. Vraća
    prethodno stanje tih dana — za „Poništi“. */
async function upisiDane(promjene) {
  const lista = aktivni();
  const prije = {}, cisto = {};
  for (const [k, id] of Object.entries(promjene)) {
    prije[k] = raspored[k] ?? null;
    cisto[k] = id != null && lista.some(c => c.id === id) ? id : null;   // obrisana poruka = bez izbora
    if (cisto[k] == null) delete raspored[k]; else raspored[k] = cisto[k];
  }
  if (porukeLokalno) { pisiLokalno(); return prije; }
  try {
    await apiPoruke('PUT', '?raspored=1', { dani: cisto });
  } catch (e) {
    await procitajPoruke();
    throw e;
  }
  return prije;
}

/* Obavijest s dugmetom „Poništi“ — svaka izmjena rasporeda se može vratiti.
   `poslije` osvježi ekran kad je vraćeno (zadano: poruke). */
function obavijestPonisti(tekst, ponisti, poslije = crtajPoruke) {
  const el = $('#poruka');
  document.body.append(el);
  el.classList.remove('greska');
  el.innerHTML = `<span>${esc(tekst)}</span><button type="button" class="tiho">Poništi</button>`;
  el.classList.add('on', 'sa-dugmetom');
  el.querySelector('button').addEventListener('click', async () => {
    el.classList.remove('on', 'sa-dugmetom');
    try { await ponisti(); poslije(); obavijest('Vraćeno kako je bilo'); } catch (e) { obavijest(e.message, true); }
  }, { once: true });
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on', 'sa-dugmetom'), 7000);
}

/* ---------- kalendar: prevlačenje ----------
   Dan se prevuče na drugi i poruke ta dva dana zamijene mjesta (oba dana
   time dobiju izbor). Mišem kreće čim se pomjeri par piksela; prstom tek
   poslije kratkog držanja, da obično povlačenje ostane skrolanje. Prošli
   dani, i danas od 10 h, se ne pomjeraju. */
const PRAG = 6;          // px — dotle je to klik
const DRZANJE = 320;     // ms — prst
let vuca = null;
let poslijeVuce = false; // klik koji završi prevlačenje ne otvara dan

const celijaIz = el => el?.closest?.('#kal .kal-dan[data-dan]:not(:disabled)') || null;

$('#kal').addEventListener('pointerdown', e => {
  const celija = celijaIz(e.target);
  if (!celija || e.button > 0 || !e.isPrimary) return;
  vuca = { celija, x: e.clientX, y: e.clientY, dodir: e.pointerType !== 'mouse', aktivno: false, cilj: null };
  if (vuca.dodir) vuca.timer = setTimeout(zapocniVucu, DRZANJE);
});
$('#kal').addEventListener('contextmenu', e => { if (celijaIz(e.target)) e.preventDefault(); });
// dok prst vuče dan, stranica ne smije skrolati ispod njega
addEventListener('touchmove', e => { if (vuca?.aktivno) e.preventDefault(); }, { passive: false });

function zapocniVucu() {
  const v = vuca;
  if (!v || v.aktivno) return;
  v.aktivno = true;
  const r = v.celija.getBoundingClientRect();
  const duh = v.celija.cloneNode(true);
  duh.classList.add('kal-duh');
  duh.removeAttribute('data-dan');
  Object.assign(duh.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.append(duh);
  v.duh = duh;
  v.celija.classList.add('kal-dan--izvor');
  document.documentElement.classList.add('vuce');
  $$('#kal .ista').forEach(c => c.classList.remove('ista'));
  if (v.dodir) navigator.vibrate?.(12);
  // podizanje ide preko `scale`/`rotate`, a praćenje kroz `transform` — bez kašnjenja
  requestAnimationFrame(() => duh.classList.add('podignut'));
}
const LETI = 'transform .34s cubic-bezier(.3, .7, .2, 1), scale .34s, rotate .34s';

addEventListener('pointermove', e => {
  const v = vuca;
  if (!v) return;
  const dx = e.clientX - v.x, dy = e.clientY - v.y;
  if (!v.aktivno) {
    if (Math.hypot(dx, dy) < PRAG) return;
    if (v.dodir) { clearTimeout(v.timer); vuca = null; return; }   // prst krenuo prije držanja — to je skrol
    zapocniVucu();
  }
  v.duh.style.transform = `translate(${dx}px, ${dy}px)`;
  const cilj = celijaIz(document.elementFromPoint(e.clientX, e.clientY));
  const novi = cilj && cilj !== v.celija ? cilj : null;
  if (novi !== v.cilj) {
    v.cilj?.classList.remove('kal-dan--cilj');
    v.cilj = novi;
    v.cilj?.classList.add('kal-dan--cilj');
    if (novi && v.dodir) navigator.vibrate?.(6);
  }
  // blizu ruba ekrana stranica skrola sama (na telefonu je mjesec duga lista)
  if (e.clientY < 80) scrollBy(0, -14);
  else if (e.clientY > innerHeight - 80) scrollBy(0, 14);
});
addEventListener('pointerup', () => zavrsiVucu(true));
addEventListener('pointercancel', () => zavrsiVucu(false));

function zavrsiVucu(spusti) {
  const v = vuca;
  if (!v) return;
  vuca = null;
  clearTimeout(v.timer);
  if (!v.aktivno) return;
  poslijeVuce = true;
  setTimeout(() => { poslijeVuce = false; }, 80);
  document.documentElement.classList.remove('vuce');
  v.cilj?.classList.remove('kal-dan--cilj');
  if (spusti && v.cilj) zamijeniDane(v); else vratiDuha(v);
}

function vratiDuha(v) {
  v.duh.style.transition = LETI;
  v.duh.classList.remove('podignut');
  v.duh.style.transform = '';
  setTimeout(() => { v.duh.remove(); v.celija.classList.remove('kal-dan--izvor'); }, 340);
}

/* Zamjena: prevučeni dan sleti na cilj, a cilj u isto vrijeme preleti na
   njegovo mjesto; tek onda se kalendar iscrta s novim rasporedom i oba dana
   kratko zasvijetle. */
async function zamijeniDane(v) {
  const a = v.celija.dataset.dan, b = v.cilj.dataset.dan;
  const pa = porukaNaDan(a), pb = porukaNaDan(b);
  if (pa === pb || zakljucan(a) || zakljucan(b)) return vratiDuha(v);
  const ra = v.celija.getBoundingClientRect(), rb = v.cilj.getBoundingClientRect();
  const duh2 = v.cilj.cloneNode(true);
  duh2.classList.add('kal-duh', 'kal-duh--drugi');
  duh2.removeAttribute('data-dan');
  Object.assign(duh2.style, { left: `${rb.left}px`, top: `${rb.top}px`, width: `${rb.width}px`, height: `${rb.height}px` });
  document.body.append(duh2);
  v.cilj.classList.add('kal-dan--izvor');
  v.duh.style.transition = duh2.style.transition = LETI;
  v.duh.classList.remove('podignut');
  requestAnimationFrame(() => {
    v.duh.style.transform = `translate(${rb.left - ra.left}px, ${rb.top - ra.top}px)`;
    duh2.style.transform = `translate(${ra.left - rb.left}px, ${ra.top - rb.top}px)`;
  });
  await new Promise(r => setTimeout(r, 340));

  const posao = upisiDane({ [a]: pb.id, [b]: pa.id });   // raspored se mijenja odmah, upis ide iza
  crtajKalendar();
  v.duh.remove();
  duh2.remove();
  for (const k of [a, b]) $(`#kal [data-dan="${k}"]`)?.classList.add('kal-dan--novo');
  try {
    const prije = await posao;
    obavijestPonisti(`${kratkiDatum(izKljucaD(a))} ↔ ${kratkiDatum(izKljucaD(b))} — poruke su zamijenile mjesta`, () => upisiDane(prije));
  } catch (e) {
    obavijest(e.message, true);
    crtajPoruke();
  }
}

/* ---------- poruka za dan ----------
   Izbor poruke iz liste (s tabovima po knjigama) za jedan dan, ili nova
   poruka napisana baš za taj dan — ona se sačuva u bazu kao i svaka druga
   i odmah izabere za taj dan. */
const danModal = $('#dan-modal');
danModal.addEventListener('click', e => { if (e.target === danModal) danModal.close(); });
let danKljuc = null, danIzbor = null, danKnjiga = '';
let novaZaDan = null;     // dan za koji se piše nova poruka (citat modal)

function otvoriDan(k) {
  if (zakljucan(k)) return obavijest('Poruka tog dana je već otišla — ne mijenja se', true);
  danKljuc = k;
  danIzbor = porukaNaDan(k).id;
  danKnjiga = '';
  const d = izKljucaD(k);
  const ime = danUSedmici(k);
  $('#dan-naslov').textContent = `${ime[0].toUpperCase()}${ime.slice(1)}, ${d.getDate()}. ${MJESECI[d.getMonth()]} ${d.getFullYear()}.`;
  $('#dan-trazi').value = '';
  $('#dan-vrati').hidden = !izabrana(k);
  crtajIzbor();
  danModal.showModal();
  // predložena (ili izabrana) poruka odmah u vidnom polju liste
  requestAnimationFrame(() => $('#dan-lista [aria-pressed="true"]')?.scrollIntoView({ block: 'center' }));
}

function crtajIzbor() {
  const lista = aktivni();
  const k = danKljuc;
  const sad = izabrana(k, lista);
  const inace = nastavak(k);
  $('#dan-napomena').innerHTML = [
    sad ? `Izabrana je poruka ${lista.indexOf(sad) + 1}.`
      : `Za ovaj dan još nije izabrana poruka. Ako ostane tako, ide po redoslijedu: poruka ${lista.indexOf(inace) + 1}.`,
    k === danasK() ? `Današnja poruka se može mijenjati do ${SAT_PORUKE} h.` : '',
  ].filter(Boolean).join(' ');
  crtajTaboveKnjiga($('#dan-knjige'), lista, danKnjiga);

  // za svaku poruku: kad je zadnji put bila i kad dolazi, gledano od ovog dana
  // (bez njega, jer se on upravo bira)
  const dani = niz(pomakni(k, -NAZAD), 2 * NAZAD + 1);
  dani[NAZAD] = null;
  const q = $('#dan-trazi').value.trim().toLowerCase();
  $('#dan-lista').innerHTML = lista
    .filter(c => (!danKnjiga || c.knjiga === danKnjiga)
      && (!q || [c.tekst, c.poglavlje, imeKnjige(c.knjiga)].join(' ').toLowerCase().includes(q)))
    .map(c => {
      const prije = dani.lastIndexOf(c, NAZAD - 1);
      const poslije = dani.indexOf(c, NAZAD + 1);
      const meta = [
        !sad && c === inace ? '<b>po redoslijedu</b>' : '',
        prije >= 0 ? `bila ${prijeDana(NAZAD - prije)}` : 'ranije nije bila',
        poslije >= 0 ? `dolazi ${zaDana(poslije - NAZAD)}` : '',
      ].filter(Boolean).join(' · ');
      return `<button type="button" class="dan-izbor" data-izbor="${c.id}" aria-pressed="${c.id === danIzbor}" style="--knjiga:${bojaKnjige(c.knjiga)}">
        <span class="citat__br">${lista.indexOf(c) + 1}.</span>
        <p>${esc(c.tekst)}</p>
        <span class="sitno"><b class="citat__knjiga">${esc(imeKnjige(c.knjiga))}</b> · ${meta}</span>
      </button>`;
    }).join('') || '<p class="prazno">Nijedna poruka ne odgovara pretrazi.</p>';
}
$('#dan-trazi').addEventListener('input', crtajIzbor);
$('#dan-knjige').addEventListener('click', e => {
  const b = e.target.closest('[data-knjiga]');
  if (!b) return;
  danKnjiga = danKnjiga === b.dataset.knjiga ? '' : b.dataset.knjiga;
  crtajIzbor();
});
$('#dan-lista').addEventListener('click', e => {
  const b = e.target.closest('[data-izbor]');
  if (!b) return;
  danIzbor = Number(b.dataset.izbor);
  $$('[data-izbor]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});
$('#dan-odustani').addEventListener('click', () => danModal.close());
// nova poruka baš za ovaj dan: otvara uređivanje poruke, a „Sačuvaj“ je i izabere
$('#dan-nova').addEventListener('click', () => {
  novaZaDan = danKljuc;
  otvoriCitat(null, danKnjiga);
});

async function sacuvajDan(id) {
  const dugmad = $$('#dan-sacuvaj, #dan-vrati');
  dugmad.forEach(b => { b.disabled = true; });
  try {
    const prije = await upisiDane({ [danKljuc]: id });
    danModal.close();
    crtajPoruke();
    const dan = kratkiDatum(izKljucaD(danKljuc));
    obavijestPonisti(id == null ? `${dan}: izbor je uklonjen — ide nastavak kruga` : `${dan}: poruka je izabrana`, () => upisiDane(prije));
  } catch (e) {
    crtajPoruke();
    obavijest(e.message, true);
  } finally {
    dugmad.forEach(b => { b.disabled = false; });
  }
}
$('#dan-sacuvaj').addEventListener('click', () => sacuvajDan(danIzbor));
$('#dan-vrati').addEventListener('click', () => sacuvajDan(null));

/* ---------- uređivanje poruke ---------- */
const citatModal = $('#citat-modal');
citatModal.addEventListener('click', e => { if (e.target === citatModal) citatModal.close(); });   // klik pored kartice zatvara
citatModal.addEventListener('close', () => { novaZaDan = null; });

function otvoriCitat(c = null, knjiga = '') {
  urediCitat = c;
  const d = novaZaDan && izKljucaD(novaZaDan);
  $('#citat-naslov').textContent = c ? 'Uredi poruku' : d ? `Nova poruka za ${kratkiDatum(d)}` : 'Nova poruka';
  $('#citat-tekst').value = c?.tekst || '';
  $('#citat-knjiga').value = c?.knjiga || knjiga || izvor.knjige[0]?.id || '';
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

/* Nova ili obrisana poruka mijenja broj poruka u krugu, a time i današnju.
   Ona je možda već otišla u notifikaciji, pa se prije promjene zakaže za
   danas — krug se pomjera tek od sutra. (Na serveru isto radi /api/poruke.) */
function zadrziDanasnjuLokalno() {
  const k = danasK();
  if (raspored[k] == null && aktivni().length) raspored[k] = porukaNaDan(k).id;
}

async function radiSPorukom(dugme, posao, poruka) {
  dugme.disabled = true;
  try {
    const tekst = await posao();
    citatModal.close();
    crtajPoruke();
    obavijest(tekst || poruka);
  } catch (e) {
    obavijest(e.message, true);
  } finally {
    dugme.disabled = false;
  }
}

$('#citat-sacuvaj').addEventListener('click', e => {
  const tekst = $('#citat-tekst').value.trim();
  if (!tekst) return obavijest('Tekst poruke je prazan', true);
  const polja = { tekst, knjiga: $('#citat-knjiga').value, poglavlje: $('#citat-poglavlje').value.trim() || null };
  const c = urediCitat, zaDan = c ? null : novaZaDan;
  radiSPorukom(e.currentTarget, async () => {
    let novaId = null;
    if (porukeLokalno) {
      if (c) Object.assign(c, polja);
      else {
        zadrziDanasnjuLokalno();
        novaId = Math.max(0, ...citati.map(x => Number(x.id) || 0)) + 1;
        citati.push({ id: novaId, redoslijed: Math.max(0, ...citati.map(x => x.redoslijed || 0)) + 1, napravljeno: new Date().toISOString(), ...polja });
      }
      pisiLokalno();
    } else {
      const d = await apiPoruke(c ? 'PUT' : 'POST', c ? `?id=${c.id}` : '', polja);
      novaId = d?.poruka?.id ?? null;
      await procitajPoruke();
    }
    // nova poruka napisana za određeni dan: odmah je i izabrana za taj dan
    if (zaDan && novaId != null) {
      await upisiDane({ [zaDan]: novaId });
      danModal.close();
      return `Nova poruka je sačuvana i izabrana za ${kratkiDatum(izKljucaD(zaDan))}`;
    }
    return null;
  }, c ? 'Poruka je sačuvana' : 'Poruka je dodana na kraj kruga');
});

$('#citat-obrisi').addEventListener('click', e => {
  const c = urediCitat;
  if (!c || !confirm('Obrisati ovu poruku? Više neće biti poruka dana; ko ju je sačuvao u aplikaciji, i dalje je ima.')) return;
  radiSPorukom(e.currentTarget, async () => {
    if (porukeLokalno) {
      if (aktivni().length <= 1) throw new Error('Mora ostati bar jedna poruka');
      zadrziDanasnjuLokalno();
      c.obrisana = true;
      c.izmijenjeno = new Date().toISOString();
      return pisiLokalno();
    }
    await apiPoruke('DELETE', `?id=${c.id}`);
    await procitajPoruke();
  }, 'Poruka je obrisana');
});

/* ---------- dizajner poruke ----------
   Tab je lista sačuvanih poruka van knjiga; „Nova poruka“ ili dodir na
   poruku otvara dizajner u draweru: tekst i boja, a objava i story crtaju
   se istom rukom kao plakat (nacrtajPoruku u js/plakat.js). „Sačuvaj“
   upisuje u bazu (/api/poruke?vlastite=1, tabela vlastite_poruke) —
   odvojeno od poruka dana: ne ide u krug i aplikacija je ne vidi. Lokalno,
   bez servera, sve ostaje u ovom pregledniku. */
const DZ = 'pd.adminDizajner';          // ono što se piše dok je drawer otvoren
const DZ_LOKALNO = 'pd.adminVlastite';  // sačuvane, kad nema servera
const DZ_FORMATI = ['objava', 'prica'].map(id => PLAKAT_FORMATI.find(f => f.id === id));
const dzMoze = !!(navigator.canShare && window.File &&
  navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] }));
// na telefonu je dijeljenje glavna radnja — u meniju je i „Sačuvaj sliku“
const dzTelefon = dzMoze && matchMedia('(pointer: coarse)').matches;
const dzModal = $('#dz-modal');
let dzStil = 'zelena';
let dzSacuvane = [];       // [{ id, tekst, stil, napravljeno, izmijenjeno }], zadnje mijenjane prve
let dzId = null;           // poruka otvorena u draweru; null = nova
let dzLokalno = false;     // bez servera: sačuvane su u ovom pregledniku

$('#dz-pregled').innerHTML = DZ_FORMATI.map(f => `
  <figure class="dz__karta" data-f="${f.id}">
    <canvas width="${f.w}" height="${f.h}" style="aspect-ratio: ${f.w} / ${f.h}" aria-label="${f.naziv}"></canvas>
    <figcaption>
      <span class="dz__ime"><b>${f.naziv}</b><small>${f.opis} · ${f.w * 2} × ${f.h * 2} px</small></span>
      ${dzMoze ? `<button type="button" class="${dzTelefon ? 'zlatno' : ''}" data-dz="dijeli">${ikona('i-dijeli')} Podijeli</button>` : ''}
      ${dzTelefon ? '' : `<button type="button" class="zlatno" data-dz="preuzmi">${ikona('i-preuzmi')} Preuzmi</button>`}
    </figcaption>
  </figure>`).join('');

const dzPoruka = () => ({ tekst: $('#dz-tekst').value.trim() });

function dzPostaviStil(s) {
  dzStil = s;
  $$('#dz-boje button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stil === s)));
}

/* Dok je drawer otvoren, ono što se piše stoji i u pregledniku: ako se
   stranica ugasi usred pisanja (telefon zna ugasiti karticu u pozadini),
   drawer se idući put sam otvori s tim. Zatvaranje i čuvanje to brišu. */
function dzPamti() {
  try { localStorage.setItem(DZ, JSON.stringify({ tekst: $('#dz-tekst').value, stil: dzStil, id: dzId })); } catch { /* tiho */ }
}
function dzZaboravi() {
  try { localStorage.removeItem(DZ); } catch { /* tiho */ }
}

/* Slika u punoj veličini, jednom po sadržaju. Na telefonu se pripremi čim
   se izađe iz teksta: iOS dijeli samo odmah po dodiru, a pravljenje velike
   slike traje — ovako je fajl već tu kad se dodirne „Podijeli“. Dok se
   kuca, ne pravi se ništa, da tipkanje ne zapinje. */
const dzKes = new Map();
function dzFajl(format) {
  const p = dzPoruka(), stil = dzStil, k = JSON.stringify([p, stil, format]);
  if (!dzKes.has(k)) {
    if (dzKes.size >= 4) dzKes.clear();
    dzKes.set(k, porukaBlob(p, { format, stil })
      .then(b => new File([b], imePoruke(p, format, stil), { type: 'image/png' }))
      .catch(e => { dzKes.delete(k); throw e; }));
  }
  return dzKes.get(k);
}
let dzPriprema = 0;
function dzPripremi() {
  clearTimeout(dzPriprema);
  if (!dzTelefon || !dzModal.open || !dzPoruka().tekst || document.activeElement === $('#dz-tekst')) return;
  dzPriprema = setTimeout(() => DZ_FORMATI.forEach(f => dzFajl(f.id).catch(() => {})), 400);
}

let dzPotez = 0, dzTajmer = 0;
function dzOsvjezi(odmah = false) {
  const prazno = !$('#dz-tekst').value.trim();
  $$('[data-dz]').forEach(b => { b.disabled = prazno; });
  dzStanjeDugmadi();
  clearTimeout(dzTajmer);
  dzTajmer = setTimeout(dzCrtaj, odmah ? 0 : 120);
}

/* Pregled tačno po ekranu, da je oštar. Crta se u zasebno platno pa
   prepiše — brzo kucanje ne miješa dva crtanja u istom platnu. */
async function dzCrtaj() {
  if (!dzModal.open) return;
  const potez = ++dzPotez, p = dzPoruka();
  let stalo = true;
  for (const f of DZ_FORMATI) {
    const pr = $(`.dz__karta[data-f="${f.id}"] canvas`), cv = document.createElement('canvas');
    const r = await nacrtajPoruku(cv, p, {
      format: f.id, stil: dzStil, zamjena: 'Napiši poruku…', mjerilo: mjeriloEkrana(f.id, pr.clientWidth || 300),
    });
    if (potez !== dzPotez) return;
    pr.width = cv.width; pr.height = cv.height;
    pr.getContext('2d').drawImage(cv, 0, 0);
    stalo &&= r.stalo;
  }
  const upoz = $('#dz-upozorenje');
  upoz.textContent = stalo ? '' : 'Poruka je preduga — skrati je.';
  upoz.classList.toggle('greska', !stalo);
  dzPripremi();
}

$('#dz-forma').addEventListener('submit', e => e.preventDefault());
$('#dz-forma').addEventListener('input', () => { dzOsvjezi(); dzPamti(); });
$('#dz-tekst').addEventListener('blur', dzPripremi);
$$('#dz-boje button').forEach(b => b.addEventListener('click', () => { dzPostaviStil(b.dataset.stil); dzOsvjezi(true); dzPamti(); }));

/* ---- sačuvane poruke ---- */

/** /api/poruke?vlastite=1, uvijek sa šifrom. Lokalno (statični server, nema JSON-a) vraća null. */
async function apiVlastite(metoda = 'GET', upit = '', tijelo) {
  const r = await fetch(`/api/poruke?vlastite=1${upit}`, {
    method: metoda,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${tajna}`, ...(tijelo ? { 'Content-Type': 'application/json' } : {}) },
    body: tijelo ? JSON.stringify(tijelo) : undefined,
  });
  if (!(r.headers.get('content-type') || '').includes('json')) {
    if (jeLokalniHost) return null;
    throw new Error(`Server je vratio ${r.status}`);
  }
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.greska || `Greška ${r.status}`), { status: r.status });
  return d;
}

function dzCitajLokalno() {
  try { return JSON.parse(localStorage.getItem(DZ_LOKALNO)) || []; } catch { return []; }
}
function dzPisiLokalno(lista) {
  try { localStorage.setItem(DZ_LOKALNO, JSON.stringify(lista)); }
  catch { throw new Error('Preglednik ne da da se sačuva'); }
}

const dzSacuvana = () => (dzId == null ? null : dzSacuvane.find(x => x.id === dzId) || null);
const dzStanje = () => ({ id: dzId, tekst: $('#dz-tekst').value, stil: dzStil });
/** Ima li u draweru nešto što nije sačuvano. */
function dzIzmijenjeno() {
  const s = dzSacuvana(), t = $('#dz-tekst').value.trim();
  return s ? s.tekst !== t || s.stil !== dzStil : !!t;
}

function dzStanjeDugmadi() {
  const s = dzSacuvana(), izmjene = dzIzmijenjeno(), b = $('#dz-sacuvaj');
  b.disabled = !$('#dz-tekst').value.trim() || !izmjene;
  $('span', b).textContent = !s ? 'Sačuvaj poruku' : izmjene ? 'Sačuvaj izmjene' : 'Sačuvano';
  $('#dz-obrisi').hidden = !s;
  $('#dz-naslov').textContent = s ? 'Sačuvana poruka' : 'Nova poruka';
}

const DZ_BOJE = { zelena: ['#204234', '#0D1C15', '#E3C489'], krem: ['#F7F1E2', '#E6D9BC', '#8E6C28'] };
const dzKad = iso => {
  const d = new Date(iso);
  return isNaN(d) ? '' : `${kratkiDatum(d)}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}.` : ''}`;
};

function dzCrtajListu() {
  $('#dz-lista').innerHTML = dzSacuvane.map(p => {
    const [a, b, z] = DZ_BOJE[p.stil] || DZ_BOJE.zelena;
    return `<div class="dz-red" data-dz-id="${p.id}">
      <i class="dz-red__boja" style="--a:${a};--b:${b};--z:${z}">“</i>
      <p>${esc(p.tekst)}</p>
      <span class="sitno">${dzKad(p.izmijenjeno)}</span>
    </div>`;
  }).join('') || '<p class="prazno">Još nema sačuvanih poruka.</p>';
}

async function dzUcitajSacuvane() {
  let napomena = '';
  try {
    const d = await apiVlastite();
    dzLokalno = !d;
    dzSacuvane = d ? d.poruke : dzCitajLokalno();
    if (!d) napomena = 'Lokalni režim — poruke se čuvaju u ovom pregledniku';
    // otvorena je u međuvremenu obrisana (npr. s drugog uređaja) — ostaje kao nova
    if (dzId != null && !dzSacuvane.some(x => x.id === dzId)) dzId = null;
  } catch (e) {
    napomena = `Sačuvane poruke nisu stigle: ${e.message}`;
  }
  $('#dz-napomena').textContent = napomena;
  dzCrtajListu();
  if (dzModal.open) dzStanjeDugmadi();
}

/** Drawer s porukom — novom (`id` null) ili sačuvanom. */
function dzOtvoriModal({ id = null, tekst = '', stil = dzStil } = {}) {
  dzId = id;
  $('#dz-tekst').value = tekst;
  dzPostaviStil(stil);
  if (!dzModal.open) dzModal.showModal();
  $('.dz-tijelo', dzModal).scrollTop = 0;
  dzOsvjezi(true);
  // nova: odmah se piše (na telefonu ne — tastatura bi prekrila pregled)
  if (!tekst && !matchMedia('(pointer: coarse)').matches) $('#dz-tekst').focus();
}

/** Tab se otvorio: lista se osvježi (možda je mijenjana drugdje), a ako se
    stranica ugasila usred pisanja, drawer se otvori s tim — jednom. */
let dzObnovljeno = false;
async function dzOtvori() {
  dzCrtajListu();
  await dzUcitajSacuvane();
  if (dzObnovljeno || dzModal.open) return;
  dzObnovljeno = true;
  let n = null;
  try { n = JSON.parse(localStorage.getItem(DZ)); } catch { /* nema */ }
  const tekst = typeof n?.tekst === 'string' ? n.tekst : '';
  if (!tekst.trim()) return;
  const s = dzSacuvane.find(x => x.id === n.id), stil = n.stil === 'krem' ? 'krem' : 'zelena';
  if (s && s.tekst === tekst.trim() && s.stil === stil) return;   // ništa nije ostalo nesačuvano
  dzOtvoriModal({ id: s ? s.id : null, tekst, stil });
}

$('#dz-nova').addEventListener('click', () => dzOtvoriModal({ id: null, tekst: '' }));
$('#dz-lista').addEventListener('click', e => {
  const p = dzSacuvane.find(x => String(x.id) === e.target.closest('[data-dz-id]')?.dataset.dzId);
  if (p) dzOtvoriModal({ id: p.id, tekst: p.tekst, stil: p.stil });
});

/* Zatvaranje (x, Esc, povlačenje nadolje) s nesačuvanim tekstom ne gubi ga
   bez traga: „Poništi“ vraća drawer kakav je bio. Poslije čuvanja i
   brisanja zatvara se tiho. */
let dzTiho = false;
$('#dz-zatvori').addEventListener('click', () => dzModal.close());
dzModal.addEventListener('close', () => {
  const bilo = dzStanje(), gubi = !dzTiho && dzIzmijenjeno();
  dzTiho = false;
  clearTimeout(dzPriprema);
  dzZaboravi();
  if (gubi) obavijestPonisti('Poruka nije sačuvana', () => dzOtvoriModal(bilo), () => {});
});

/** Upisuje poruku iz drawera — novu ili izmjenu otvorene — i vraća sačuvan red. */
async function dzUpisi(p) {
  if (!dzLokalno) {
    const d = await apiVlastite(dzId != null ? 'PUT' : 'POST', dzId != null ? `&id=${dzId}` : '', p);
    if (d) return d.poruka;
    dzLokalno = true;
  }
  // iz preglednika, ne iz liste na ekranu — ona možda još nije učitana
  const sada = new Date().toISOString(), lista = dzCitajLokalno(), staro = lista.find(x => x.id === dzId);
  const red = staro ? { ...staro, ...p, izmijenjeno: sada }
    : { id: Math.max(0, ...lista.map(x => x.id)) + 1, ...p, napravljeno: sada, izmijenjeno: sada };
  dzPisiLokalno([red, ...lista.filter(x => x.id !== red.id)]);
  return red;
}

$('#dz-sacuvaj').addEventListener('click', async e => {
  const b = e.currentTarget, p = { tekst: $('#dz-tekst').value.trim(), stil: dzStil };
  if (!p.tekst) return;
  const nova = dzId == null;
  b.disabled = true;
  try {
    const red = await dzUpisi(p);
    dzSacuvane = dzLokalno ? dzCitajLokalno() : [red, ...dzSacuvane.filter(x => x.id !== red.id)];
    dzId = red.id;
    dzZaboravi();
    dzCrtajListu();
    // sačuvano je — drawer se zatvara, poruka je na vrhu liste
    dzTiho = true;
    dzModal.close();
    obavijest(nova ? 'Poruka je sačuvana' : 'Izmjene su sačuvane');
  } catch (err) {
    // obrisana s drugog uređaja: tekst ostaje, sačuva se kao nova
    if (err.status === 404) { dzSacuvane = dzSacuvane.filter(x => x.id !== dzId); dzId = null; dzCrtajListu(); }
    obavijest(err.status === 404 ? 'Ta poruka je u međuvremenu obrisana — sačuvaj je kao novu' : err.message, true);
  } finally {
    dzStanjeDugmadi();
  }
});

$('#dz-obrisi').addEventListener('click', async e => {
  const id = dzId;
  if (id == null || !confirm('Obrisati ovu poruku iz sačuvanih?')) return;
  const b = e.currentTarget;
  b.disabled = true;
  try {
    let lokalno = dzLokalno;
    if (!lokalno) {
      try { lokalno = !(await apiVlastite('DELETE', `&id=${id}`)); }
      catch (err) { if (err.status !== 404) throw err; }      // već obrisana — isto
    }
    if (lokalno) { dzLokalno = true; dzPisiLokalno(dzCitajLokalno().filter(x => x.id !== id)); }
    dzSacuvane = lokalno ? dzCitajLokalno() : dzSacuvane.filter(x => x.id !== id);
    dzId = null;
    dzCrtajListu();
    dzTiho = true;
    dzModal.close();
    obavijest('Poruka je obrisana');
  } catch (err) {
    obavijest(err.message, true);
  } finally {
    b.disabled = false;
  }
});

$('#dz-pregled').addEventListener('click', async e => {
  const b = e.target.closest('[data-dz]');
  if (!b || b.disabled) return;
  const format = b.closest('.dz__karta').dataset.f, sadrzaj = b.innerHTML;
  b.disabled = true;
  b.textContent = 'Pravim…';
  try {
    const fajl = await dzFajl(format);
    if (b.dataset.dz === 'dijeli') {
      try { await navigator.share({ files: [fajl] }); }
      catch (err) {
        if (err.name === 'AbortError') return;          // odustao je u meniju
        spusti(fajl, fajl.name);
        obavijest('Dijeljenje nije uspjelo — slika je preuzeta');
      }
    } else {
      spusti(fajl, fajl.name);
      obavijest('Slika je preuzeta');
    }
  } catch (err) {
    obavijest(`Slika nije napravljena: ${err.message}`, true);
  } finally {
    b.innerHTML = sadrzaj;
    b.disabled = !$('#dz-tekst').value.trim();
  }
});

let dzSirina = 0;
addEventListener('resize', () => {
  if (innerWidth === dzSirina) return;                  // telefon: traka adrese mijenja samo visinu
  dzSirina = innerWidth;
  if (dzModal.open) dzOsvjezi();
});

/* ---------- start ---------- */
if (await ucitaj()) uFormu();
