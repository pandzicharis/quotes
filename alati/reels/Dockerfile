# Radnik za reelse (radnik.py). Gradi se iz korijena repoa jer treba logo iz public/:
#   cd alati/reels && docker compose up -d --build
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/alati/reels
COPY alati/reels/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# fontovi brenda (OFL licenca, Google Fonts) — isti kao u postavi.sh
RUN mkdir fontovi && B=https://raw.githubusercontent.com/google/fonts/main/ofl \
 && curl -sfL -o fontovi/IBMPlexSans.ttf "$B/ibmplexsans/IBMPlexSans%5Bwdth,wght%5D.ttf" \
 && curl -sfL -o fontovi/EBGaramond-Italic.ttf "$B/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf" \
 && curl -sfL -o fontovi/OFL.txt "$B/ibmplexsans/OFL.txt"

COPY public/assets/brand/ammar_basic_logo_w_1.png public/assets/brand/ammar_basic_logo_w_m_1.png /app/public/assets/brand/
COPY alati/reels/reels.py alati/reels/radnik.py ./

ENV REELS_RADNO=/podaci/radno PYTHONUNBUFFERED=1 HF_HUB_DISABLE_XET=1
CMD ["sh", "-c", "pip install -q -U 'yt-dlp[default]' || true; exec python radnik.py"]
