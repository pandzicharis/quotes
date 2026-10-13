#!/usr/bin/env bash
# Grafike za mreže — objava 4:5 i story 9:16, zelena i bijela — iz pokrenutog
# lokalnog servera, u dvostrukoj rezoluciji, kroz Chrome bez prozora.
# Izvor je public/_promo/ (ne objavljuje se), slike idu u public/grafike/
# i objavljuju se na /grafike. Pokreni ponovo kad se promijeni izgled.
#   npm run dev   (u drugom terminalu)
#   bash scripts/promo.sh [http://localhost:8123]
set -euo pipefail
BASE="${1:-http://localhost:8123}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/grafike"
mkdir -p "$OUT"
# poseban profil: ne smeta otvorenom Chromeu
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
shot() { # ime  širina  visina  adresa
  rm -f "$OUT/$1.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --user-data-dir="$PROFILE" \
    --window-size="$2,$3" --virtual-time-budget=30000 --screenshot="$OUT/$1.png" "$BASE$4" 2>/dev/null || true
  [ -s "$OUT/$1.png" ] || { echo "✗ $1 — je li server pokrenut na $BASE?"; exit 1; }
  # pregled za stranicu /grafike — puna slika se samo preuzima
  sips -Z 900 -s format jpeg -s formatOptions 82 "$OUT/$1.png" --out "$OUT/$1.jpg" >/dev/null
  echo "✓ $1"
}
shot poruka-dana-objava-zelena 1080 1350 '/_promo/?f=objava'
shot poruka-dana-objava-bijela 1080 1350 '/_promo/?f=objava&t=bijela'
shot poruka-dana-story-zelena  1080 1920 '/_promo/?f=story'
shot poruka-dana-story-bijela  1080 1920 '/_promo/?f=story&t=bijela'
# nova oznaka na stranici /grafike — preglednik tako ne prikazuje stare slike iz keša
sed -i '' "s/const V = '[^']*';/const V = '$(date +%Y%m%d%H%M)';/" "$OUT/index.html"
