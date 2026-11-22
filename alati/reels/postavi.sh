#!/bin/zsh
# Jednokratna priprema alata za reelse (sve besplatno). Pokreće je ./reels sam, ako treba.
set -e
cd "${0:A:h}"
for p in ffmpeg ollama node uv; do command -v $p >/dev/null || brew install $p; done
[[ -x .venv/bin/python ]] || uv venv -q --python 3.12 .venv
uv pip install -q --python .venv/bin/python -U mlx-whisper pillow "yt-dlp[default]" pyobjc-framework-Vision
touch .venv/.yt-osvjezeno

# fontovi brenda (OFL licenca, Google Fonts)
mkdir -p fontovi
B=https://raw.githubusercontent.com/google/fonts/main/ofl
[[ -f fontovi/IBMPlexSans.ttf ]] || curl -sfL -o fontovi/IBMPlexSans.ttf "$B/ibmplexsans/IBMPlexSans%5Bwdth,wght%5D.ttf"
[[ -f fontovi/EBGaramond-Italic.ttf ]] || curl -sfL -o fontovi/EBGaramond-Italic.ttf "$B/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf"
[[ -f fontovi/OFL.txt ]] || curl -sfL -o fontovi/OFL.txt "$B/ibmplexsans/OFL.txt"

# AI model za izbor isječaka (lokalno, ~7 GB)
pgrep -xq ollama || brew services start ollama
sleep 2
ollama pull "${REELS_LLM_MODEL:-gemma4:12b-it-qat}"
echo "Spremno. Pokreni: ./reels"
