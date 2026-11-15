#!/usr/bin/env bash
# Simulacija jednog dana na TESTU — isti pozivi kao cron, ali s glumljenim
# vremenom (&sat=, &dan=; radi samo na test adresi, vidi api/send.js).
# Za par minuta provjeri: poruka dana ne ide prije 10 h, posao za predavanja
# je nikad ne šalje, nadoknada ne šalje ništa dvaput, podsjetnik ide u 20 h.
#
#   CRON_SECRET='…' bash scripts/simulacija-test.sh
#
# Poruka dana se glumi za izmišljen dan u 2099, da ne dira prave dane (sutrašnja
# prava poruka u 10 h stiže normalno). Tvoji test uređaji u koraku „10:00“ zaista
# dobiju obavijest. Podsjetnik se glumi za danas u 20 h — stiže samo ako postoji
# sutrašnje predavanje označeno sa „Planiram ići“, i samo jednom.
set -euo pipefail
BASE="${BASE:-https://quotes-git-test-pandzicharis-porfolio.vercel.app}"
case "$BASE" in *-git-test-*) ;; *) echo "✗ Simulacija je samo za test adresu, ne za produkciju"; exit 1 ;; esac
: "${CRON_SECRET:?Postavi CRON_SECRET (vrijednost iz Vercela) — npr. CRON_SECRET='…' bash scripts/simulacija-test.sh}"

DAN="2099-$(printf %02d $((RANDOM % 12 + 1)))-$(printf %02d $((RANDOM % 28 + 1)))"
DANAS="$(TZ=Europe/Sarajevo date +%Y-%m-%d)"
GRESKE=0

korak() { # opis · upit · provjera (Python izraz nad odgovorom `d`)
  local odg
  odg="$(curl -s -H "x-cron-secret: $CRON_SECRET" "$BASE/api/send?$2")"
  python3 -I - "$1" "$3" "$odg" <<'PY' || GRESKE=$((GRESKE + 1))
import json, sys
opis, provjera, sirovo = sys.argv[1:4]
try:
    d = json.loads(sirovo)
except Exception:
    print(f"✗ {opis}\n    nije JSON: {sirovo[:200]}"); sys.exit(1)
pred = d.get('predavanja') or []
pod = [x for x in pred if str(x.get('kljuc', '')).startswith('podsjetnik:')]
ok = eval(provjera, {}, {'d': d, 'pod': pod})
sazetak = {k: d[k] for k in ('nacin', 'porukaId', 'pretplata', 'vecDobilo', 'poslano', 'palo', 'greska', 'napomena') if k in d}
if pred:
    sazetak['predavanja'] = [{k: x.get(k) for k in ('kljuc', 'poslano', 'vec', 'greska') if k in x} for x in pred]
print(f"{'✓' if ok else '✗'} {opis}\n    {json.dumps(sazetak, ensure_ascii=False)}")
sys.exit(0 if ok else 1)
PY
}

echo "Simulacija na $BASE — izmišljen dan $DAN, podsjetnici za danas ($DANAS)"
echo
korak "07:00  poruka dana — ne smije poslati ništa" \
  "nadoknadi=1&dan=$DAN&sat=7"  "d.get('poslano', 0) == 0 and 'porukaId' not in d"
korak "09:00  poruka dana — ne smije poslati ništa" \
  "nadoknadi=1&dan=$DAN&sat=9"  "d.get('poslano', 0) == 0 and 'porukaId' not in d"
korak "10:00  posao za predavanja — NE smije poslati poruku dana" \
  "predavanja=1&dan=$DAN&sat=10" "d.get('nacin') == 'predavanja' and d.get('poslano', 0) == 0 and 'porukaId' not in d"
korak "10:00  poruka dana — šalje svima (stiže na test telefone)" \
  "nadoknadi=1&dan=$DAN&sat=10" "d.get('poslano', 0) > 0 and d.get('poslano', 0) + d.get('palo', 0) == d.get('pretplata', -1)"
korak "10:01  nadoknada — niko ne dobija dvaput" \
  "nadoknadi=1&dan=$DAN&sat=10" "d.get('poslano', 0) == 0 and d.get('vecDobilo', 0) > 0"
korak "10:03  nadoknada — opet ništa" \
  "nadoknadi=1&dan=$DAN&sat=10" "d.get('poslano', 0) == 0"
korak "19:00  predavanja — podsjetnik još ne ide, bez poruke dana" \
  "predavanja=1&dan=$DANAS&sat=19" "d.get('poslano', 0) == 0 and 'porukaId' not in d and not pod"
korak "20:00  predavanja — podsjetnik za sutrašnja (ako ih planiraš), bez poruke dana" \
  "predavanja=1&dan=$DANAS&sat=20" "d.get('poslano', 0) == 0 and 'porukaId' not in d"
korak "21:00  predavanja — podsjetnik ne ide dvaput" \
  "predavanja=1&dan=$DANAS&sat=21" "d.get('poslano', 0) == 0 and all(x.get('poslano', 0) == 0 for x in pod)"
echo
if [ "$GRESKE" -eq 0 ]; then echo "✓ Sve prošlo"; else echo "✗ Palo koraka: $GRESKE"; exit 1; fi
