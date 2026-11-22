#!/usr/bin/env python3
"""Radnik za reelse — vrti se u Dockeru na laptopu (alati/reels: docker compose up -d).

Hafiz u adminu (tab „Reels“) zalijepi YouTube link → red u Supabase tabeli
`reels_poslovi` (sql/reels.sql). Radnik ga preuzme s kućnog interneta (YouTube
serverske adrese blokira), napravi transkript (Groq Whisper, besplatno), AI
izabere i uredi isječke (Gemini, besplatno; rezerva Groq), napravi reelse
(ffmpeg + Pillow, isto kao lokalni alat reels.py) i stavi ih u Storage bucket
`reels`. Hafiz ih u adminu pregleda, podesi i preuzme; izmijenjeni se prave iznova.

Logika izbora, ispravki, rezova, titlova i izgleda je u reels.py (ista kao
lokalni alat); ovdje su samo red poslova, Groq/Gemini, lice (OpenCV) i Storage.
Ključevi su u alati/reels/.env (vidi .env.example) i ne idu u git.
"""
import hashlib, json, os, re, shutil, subprocess, threading, time, traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import reels as R

# reels.py učitava Pillow/numpy tek kad se pokrene sam
R.np, R.Image, R.ImageDraw, R.ImageFilter, R.ImageFont = np, Image, ImageDraw, ImageFilter, ImageFont
# Instagram ionako prekodira; ovako i isječak od 2 min ostaje ispod 50 MB (limit besplatnog Storagea)
R.KODIRANJE = ["-preset", "veryfast", "-crf", "21", "-maxrate", "2500k", "-bufsize", "5M"]

SB_URL = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_SECRET_KEY"]
GROQ = os.environ.get("GROQ_API_KEY", "").strip()
GEMINI = os.environ.get("GEMINI_API_KEY", "").strip()
GROQ_URL = "https://api.groq.com/openai/v1"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
GROQ_WHISPER = os.environ.get("REELS_GROQ_WHISPER", "whisper-large-v3-turbo")
OLLAMA = os.environ.get("REELS_OLLAMA", "http://host.docker.internal:11434").rstrip("/")
BUCKET = "reels"
VERZIJA = "2"
VIDEO_DANA, REELS_DANA = 7, 14          # lokalni komadi videa / reelsi u Storageu
KOMAD_S = 10 * 60                       # zvuk za Groq ide u komadima od 10 min, svi istovremeno
FORMAT = "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b"

S = requests.Session()
S.headers.update({"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"})
TRENUTNI = {"id": None}


def sad():
    return datetime.now(timezone.utc).isoformat()


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ───────────────────────────── Supabase ─────────────────────────────

def ponovi(fn, puta=4):
    """Kućni internet zna kratko pući (SSL, DNS) — pokušaj ponovo prije nego posao padne."""
    for k in range(puta):
        try:
            return fn()
        except requests.ConnectionError as e:
            if k == puta - 1:
                raise
            log(f"veza: {str(e)[:120]} → ponovo za {10 * (k + 1)} s")
            time.sleep(10 * (k + 1))


def rest(metoda, putanja, **kw):
    r = ponovi(lambda: S.request(metoda, f"{SB_URL}/rest/v1/{putanja}", timeout=30, **kw))
    if r.status_code >= 400:
        raise RuntimeError(f"Supabase {r.status_code}: {r.text[:300]}")
    return r.json() if r.content else None


def izmijeni(pid, polja, uslov="", sadrzaj=True):
    """PATCH posla; `sadrzaj` = mijenja se sadržaj (ne samo faza), pa se pomjeri i `izmijenjeno`."""
    if sadrzaj:
        polja = {**polja, "izmijenjeno": sad()}
    return rest("PATCH", f"reels_poslovi?id=eq.{pid}{uslov}", json=polja, headers={"Prefer": "return=representation"})


def posalji(put, podaci, tip):
    """`podaci`: bajtovi ili putanja fajla (fajl se otvara iznova za svaki pokušaj)."""
    def jednom():
        tijelo = open(podaci, "rb") if isinstance(podaci, Path) else podaci
        try:
            return S.post(f"{SB_URL}/storage/v1/object/{BUCKET}/{put}", data=tijelo, timeout=900,
                          headers={"Content-Type": tip, "x-upsert": "true", "cache-control": "3600"})
        finally:
            if isinstance(podaci, Path):
                tijelo.close()
    r = ponovi(jednom)
    if r.status_code >= 400:
        raise RuntimeError(f"Storage {r.status_code}: {r.text[:300]}")


TUS_DIO = 6 * 1024 * 1024    # Supabase traži tačno 6 MB po dijelu (osim zadnjeg)


def posalji_veliki(put, fajl, tip):
    """Nastavljivo slanje (TUS): fajl ide u dijelovima od 6 MB; kad veza pukne, nastavlja od zadnjeg dijela."""
    import base64
    b64 = lambda v: base64.b64encode(v.encode()).decode()
    vel = fajl.stat().st_size
    zag = {"Tus-Resumable": "1.0.0", "x-upsert": "true"}
    r = ponovi(lambda: S.post(f"{SB_URL}/storage/v1/upload/resumable", timeout=60, headers={
        **zag, "Upload-Length": str(vel),
        "Upload-Metadata": f"bucketName {b64(BUCKET)},objectName {b64(put)},contentType {b64(tip)},cacheControl {b64('3600')}"}))
    if r.status_code >= 400:
        raise RuntimeError(f"Storage {r.status_code}: {r.text[:300]}")
    adresa = r.headers["Location"]
    pomak, greske = 0, 0
    with open(fajl, "rb") as f:
        while pomak < vel:
            f.seek(pomak)
            dio = f.read(TUS_DIO)
            try:
                r = S.patch(adresa, data=dio, timeout=300, headers={
                    **zag, "Upload-Offset": str(pomak), "Content-Type": "application/offset+octet-stream"})
                if r.status_code == 409:                 # server je dio već primio (odgovor se izgubio) — pitaj dokle
                    h = ponovi(lambda: S.head(adresa, timeout=30, headers=zag))
                    pomak = int(h.headers.get("Upload-Offset", pomak))
                    continue
                if r.status_code >= 400:
                    raise RuntimeError(f"Storage {r.status_code}: {r.text[:300]}")
                pomak = int(r.headers["Upload-Offset"])
            except (requests.ConnectionError, requests.Timeout) as e:
                greske += 1
                if greske > 8:
                    raise
                log(f"slanje prekinuto ({str(e)[:80]}) → nastavljam za {5 * greske} s")
                time.sleep(5 * greske)
                h = ponovi(lambda: S.head(adresa, timeout=30, headers=zag))       # koliko je server primio
                pomak = int(h.headers.get("Upload-Offset", pomak))


def posalji_json(put, data):
    posalji(put, json.dumps(data, ensure_ascii=False).encode(), "application/json")


def procitaj_json(put):
    r = S.get(f"{SB_URL}/storage/v1/object/authenticated/{BUCKET}/{put}", timeout=60)
    return r.json() if r.ok else None


def obrisi_fajlove(putevi):
    putevi = list(putevi)
    if putevi:
        S.delete(f"{SB_URL}/storage/v1/object/{BUCKET}", json={"prefixes": list(putevi)}, timeout=60)


class Javljac:
    """Faza i procenat za admin, najviše jednom u 2 s (zadnja vrijednost se ne gubi)."""

    def __init__(self, pid):
        self.pid, self.zadnje, self.na_cekanju = pid, 0.0, None

    def __call__(self, poruka, procenat=None):
        self.na_cekanju = {"faza": str(poruka)[:200], "procenat": None if procenat is None else round(float(procenat), 1)}
        if time.time() - self.zadnje > 2:
            self.posalji()

    def posalji(self):
        if self.na_cekanju:
            try:
                izmijeni(self.pid, self.na_cekanju, sadrzaj=False)
            except Exception as e:  # noqa: BLE001 — javljanje ne smije srušiti posao
                log("javljanje:", e)
            self.zadnje, self.na_cekanju = time.time(), None


def puls():
    """Svakih 20 s: „laptop je uključen“ u adminu."""
    while True:
        try:
            rest("POST", "reels_radnik?on_conflict=id", headers={"Prefer": "resolution=merge-duplicates"},
                 json={"id": 1, "vidjen": sad(), "posao": TRENUTNI["id"], "verzija": VERZIJA})
        except Exception as e:  # noqa: BLE001
            log("puls:", e)
        time.sleep(20)


# ───────────────────────────── AI (Gemini, rezerva Groq) ─────────────────────────────

def _modeli(url, kljuc):
    try:
        r = requests.get(f"{url}/models", headers={"Authorization": f"Bearer {kljuc}"}, timeout=20)
        return [m["id"].removeprefix("models/") for m in r.json().get("data", [])]
    except Exception:  # noqa: BLE001
        return []


def _radi(url, kljuc, model):
    """Kratka proba: neki modeli na besplatnom nivou imaju kvotu 0 (429) ili ih više nema (404)."""
    try:
        r = requests.post(f"{url}/chat/completions", headers={"Authorization": f"Bearer {kljuc}"}, timeout=60,
                          json={"model": model, "response_format": {"type": "json_object"},
                                "messages": [{"role": "user", "content": 'Vrati JSON {"ok": true}'}]})
        return r.status_code == 200
    except requests.RequestException:
        return False


def _verzija(i):
    m = re.search(r"(\d+(?:\.\d+)?)", i)
    return float(m[1]) if m else 0.0


def _prvi_koji_radi(url, kljuc, kandidati):
    for m in dict.fromkeys(kandidati):
        if _radi(url, kljuc, m):
            return m
    return None


LLM = []        # [(ime, url, ključ, model)] redom pokušaja
BLOKIRANO = {}  # ime → do kada se preskače (potrošena kvota)


def pripremi_llm():
    if GEMINI:
        ids = _modeli(GEMINI_URL, GEMINI)
        flash = sorted((i for i in ids if re.fullmatch(r"gemini-\d+(?:\.\d+)?-flash(?:-preview)?", i)), key=_verzija, reverse=True)
        lite = sorted((i for i in ids if re.fullmatch(r"gemini-\d+(?:\.\d+)?-flash-lite(?:-preview)?", i)), key=_verzija, reverse=True)
        zeljeni = [os.environ["REELS_GEMINI_MODEL"]] if os.environ.get("REELS_GEMINI_MODEL") else []
        # Besplatna kvota je po modelu (flash ima malo zahtjeva dnevno, flash-lite mnogo više): uzmi
        # najbolji flash koji radi i do dva lite modela kao rezervu.
        m = _prvi_koji_radi(GEMINI_URL, GEMINI, [*zeljeni, *flash, "gemini-flash-latest"])
        if m:
            LLM.append(("Gemini", GEMINI_URL, GEMINI, m))
        for z in [z for z in lite if _radi(GEMINI_URL, GEMINI, z)][:2]:
            LLM.append(("Gemini", GEMINI_URL, GEMINI, z))
        if not any(i == "Gemini" for i, *_ in LLM):
            log("Gemini: nijedan model ne odgovara (kvota?) — preskačem")
    if GROQ:
        ids = _modeli(GROQ_URL, GROQ)
        zeljeni = [os.environ["REELS_GROQ_LLM"]] if os.environ.get("REELS_GROQ_LLM") else []
        for z in [z for z in dict.fromkeys([*zeljeni, "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b",
                                           "llama-3.3-70b-versatile"]) if z in ids][:3]:
            LLM.append(("Groq", GROQ_URL, GROQ, z))      # limit je po modelu — više modela, više prostora
    try:                                  # Ollama na Macu (lokalni alat je već ima): rezerva bez ključa, sporija
        modeli = [m["name"] for m in requests.get(f"{OLLAMA}/api/tags", timeout=5).json().get("models", [])]
        if modeli:
            LLM.append(("Ollama", OLLAMA, "", os.environ.get("REELS_OLLAMA_MODEL") or
                        (R.LLM_MODEL if R.LLM_MODEL in modeli else modeli[0])))
    except requests.RequestException:
        pass
    if not LLM:
        raise SystemExit("Nema AI-ja: upiši GEMINI_API_KEY ili GROQ_API_KEY u alati/reels/.env, ili pokreni Ollamu na Macu")
    R.LLM_MODEL = " → ".join(f"{i} {m}" for i, _, _, m in LLM)
    log("AI:", R.LLM_MODEL)


OLLAMA_LLM = R.llm                        # originalni poziv iz reels.py (Ollama)


def llm(sistem, poruka, shema=None):
    zadnja = None
    for ime, url, kljuc, model in LLM:
        if BLOKIRANO.get(f"{ime}:{model}", 0) > time.time():
            continue
        if zadnja:
            log(f"AI: {zadnja[:160]} → {ime}")
        if ime == "Ollama":                # isti poziv kao lokalni alat (JSON shema, bez ključa)
            R.LLM_URL, R.LLM_MODEL, R.LLM_KEY = url, model, ""
            try:
                return OLLAMA_LLM(sistem, poruka, shema)
            except (RuntimeError, ValueError) as e:
                zadnja = f"Ollama: {e}"
                continue
        body = {"model": model, "temperature": 0.4, "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": sistem}, {"role": "user", "content": poruka}]}
        if ime == "Gemini":
            body["reasoning_effort"] = "low"          # isti kvalitet za ove zadatke, ~3× brže
        for pokusaj in range(3):
            try:
                r = requests.post(f"{url}/chat/completions", json=body, timeout=90,
                                  headers={"Authorization": f"Bearer {kljuc}"})
            except requests.RequestException as e:
                zadnja = f"{ime}: {e}"
                time.sleep(5)
                continue
            if r.status_code == 429 and "quota" in r.text.lower():   # dnevna kvota potrošena → 10 min preskačemo
                zadnja = f"{ime} {model} 429: kvota potrošena"
                BLOKIRANO[f"{ime}:{model}"] = time.time() + 1800
                break
            if r.status_code in (429, 500, 502, 503, 504):      # limit u minuti ili preopterećenje
                zadnja = f"{ime} {model} {r.status_code}: {r.text[:120]}"
                if pokusaj:
                    break                                       # drugi put → sljedeći provajder, ne čekaj
                time.sleep(min(8, float(r.headers.get("retry-after") or 0) or 4))
                continue
            if r.status_code == 400 and "reasoning" in r.text.lower() and "reasoning_effort" in body:
                del body["reasoning_effort"]
                continue
            if r.status_code >= 400:                            # npr. 413: zahtjev prevelik za ovaj model
                zadnja = f"{ime} {model} {r.status_code}: {r.text[:200]}"
                break
            tekst = (r.json()["choices"][0]["message"].get("content") or "").strip()
            tekst = re.sub(r"^```(?:json)?|```$", "", tekst).strip()
            try:
                return json.loads(tekst)
            except ValueError:
                zadnja = f"{ime}: odgovor nije JSON"
                continue
    raise RuntimeError(f"AI ne odgovara ({zadnja})")


R.llm = llm


# ───────────────────────────── preuzimanje (kućni internet) ─────────────────────────────

def yt(args, javi=None, opis=""):
    """yt-dlp; YouTube zna povremeno vratiti 403 na link — tada pokušaj ponovo (novi linkovi)."""
    cmd = ["yt-dlp", "--newline", "--no-playlist", "--no-update", *args]
    for pokusaj in range(3):
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        zadnje = []
        for line in p.stdout:
            zadnje = (zadnje + [line.strip()])[-8:]
            m = re.search(r"\[download\]\s+([\d.]+)%", line)
            if m and javi:
                javi(opis, float(m[1]))
        if not p.wait():
            return
        greske = [z for z in zadnje if "ERROR" in z] or zadnje[-3:]
        if pokusaj < 2 and any(k in " ".join(greske) for k in ("403", "HTTP Error", "timed out", "Connection")):
            log("yt-dlp:", " ".join(greske)[-160:], "→ ponovo")
            time.sleep(3 * (pokusaj + 1))
            continue
        raise RuntimeError("YouTube preuzimanje nije uspjelo: " + " ".join(greske)[-500:])


def skini_zvuk(d, url, javi):
    """Samo zvuk, u najmanjem formatu (za govor je dovoljan) — 30 min predavanja je ~10 MB."""
    if not [f for f in d.glob("zvuk.*") if not f.name.endswith((".json", ".part"))]:
        yt(["-f", "249/250/139/worstaudio[acodec!=none]/ba", "--write-info-json", "-o", str(d / "zvuk.%(ext)s"), url],
           javi, "Preuzimam zvuk")


_URLOVI = {}


def yt_urlovi(url, svjeze=False):
    """Direktni linkovi videa i zvuka (vrijede nekoliko sati) — iz njih se skida samo ono što treba."""
    k = _URLOVI.get(url)
    if k and not svjeze and time.time() - k[0] < 3 * 3600:
        return k[1]
    r = subprocess.run(["yt-dlp", "--no-update", "--no-playlist", "-q", "-g", "-f", FORMAT, url],
                       capture_output=True, text=True, timeout=180)
    linkovi = [x for x in r.stdout.split() if x.startswith("http")]
    if r.returncode or not linkovi:
        raise RuntimeError("YouTube preuzimanje nije uspjelo: " + r.stderr.strip()[-400:])
    _URLOVI[url] = (time.time(), linkovi)
    return linkovi


def segment(d, url, a, b):
    """Komad videa [a, b] (s malo zraka) kao lokalni mp4 s tačnim početkom; vraća (fajl, pomak).
    Skida se samo taj dio, ne cijelo predavanje. Postojeći komad koji pokriva raspon se ponovo koristi."""
    a, b = max(0.0, a - 1.5), b + 1.0
    for f in d.glob("seg_*.mp4"):
        m = re.fullmatch(r"seg_([\d.]+)_([\d.]+)\.mp4", f.name)
        if m and float(m[1]) <= a + 0.01 and float(m[2]) >= b - 0.01:
            return f, float(m[1])
    out = d / f"seg_{a:.2f}_{b:.2f}.mp4"
    tmp = d / f"_{out.name}"
    mreza = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
    for pokusaj in range(2):                       # link je možda istekao → novi
        linkovi = yt_urlovi(url, svjeze=pokusaj > 0)
        ulazi = []
        for l in linkovi[:2]:
            ulazi += [*mreza, "-ss", f"{a:.3f}", "-i", l]
        mapa = ["-map", "0:v:0", "-map", "1:a:0"] if len(linkovi) > 1 else ["-map", "0:v:0", "-map", "0:a:0"]
        try:
            R.ffmpeg(*ulazi, "-t", f"{b - a:.3f}", *mapa, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16",
                     "-c:a", "aac", "-b:a", "192k", tmp)
            tmp.rename(out)
            return out, a
        except RuntimeError:
            if pokusaj:
                raise
    raise RuntimeError("Dio videa nije preuzet")


def velicina_videa(fajl):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "json", str(fajl)], capture_output=True, text=True).stdout
    s = json.loads(out)["streams"][0]
    return s["width"], s["height"]


def trajanje_fajla(p):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                         capture_output=True, text=True).stdout
    return float(out.strip() or 0)


# ───────────────────────────── transkript (Groq, rezerva faster-whisper) ─────────────────────────────

def tisine(zvuk):
    """Sredine tišina u zvuku — tu se reže na komade, da se riječ ne presiječe."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(zvuk), "-af", "silencedetect=n=-35dB:d=0.4", "-f", "null", "-"],
                       capture_output=True, text=True)
    pocetci = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    krajevi = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    return [(a + b) / 2 for a, b in zip(pocetci, krajevi)]


def groq_komad(p, pomak):
    for pokusaj in range(5):
        with open(p, "rb") as f:
            r = ponovi(lambda: requests.post(
                f"{GROQ_URL}/audio/transcriptions", headers={"Authorization": f"Bearer {GROQ}"}, timeout=600,
                files={"file": (p.name, f, "audio/ogg")},
                data=[("model", GROQ_WHISPER), ("language", "bs"), ("response_format", "verbose_json"),
                      ("timestamp_granularities[]", "word"), ("timestamp_granularities[]", "segment"),
                      ("prompt", R.WHISPER_PROMPT), ("temperature", "0")]))
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(min(60, float(r.headers.get("retry-after") or 0) or 10 * (pokusaj + 1)))
            continue
        if r.status_code >= 400:
            raise RuntimeError(f"Groq {r.status_code}: {r.text[:300]}")
        return [{"w": w["word"].strip(), "t0": round(w["start"] + pomak, 2), "t1": round(w["end"] + pomak, 2)}
                for w in r.json().get("words", []) if w["word"].strip()]
    raise RuntimeError("Groq: previše zahtjeva, pokušaj kasnije")


def transkript_groq(d, zvuk, javi):
    """Zvuk u komade od ~10 min (rez u tišini), 16 kbit/s Opus (govor je jasan, a fajl mali), komadi istovremeno."""
    dur = trajanje_fajla(zvuk)
    granice, t = [0.0], KOMAD_S
    tis = tisine(zvuk) if dur > KOMAD_S else []
    while t < dur - 60:
        blizu = [s for s in tis if abs(s - t) < 45]
        granice.append(min(blizu, key=lambda s: abs(s - t)) if blizu else t)
        t = granice[-1] + KOMAD_S
    granice.append(dur)
    dijelovi = list(zip(granice, granice[1:]))
    gotovo = [0]

    def jedan(k, a, b):
        komad = d / f"_komad{k}.ogg"
        R.ffmpeg("-ss", f"{a:.2f}", "-t", f"{b - a:.2f}", "-i", zvuk, "-vn", "-ac", "1", "-ar", "16000",
                 "-c:a", "libopus", "-b:a", "16k", "-application", "voip", komad)
        try:
            return groq_komad(komad, a)
        finally:
            komad.unlink(missing_ok=True)
            gotovo[0] += 1
            javi("Transkript (Groq)", 100 * gotovo[0] / len(dijelovi))

    with ThreadPoolExecutor(4) as pool:
        rezultati = list(pool.map(lambda z: jedan(z[0], *z[1]), enumerate(dijelovi)))
    return {"model": f"groq:{GROQ_WHISPER}", "rijeci": [w for r in rezultati for w in r]}


def transkript_lokalno(d, zvuk, javi):
    from faster_whisper import WhisperModel
    javi("Transkript na procesoru (bez Groqa, sporije)", None)
    m = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8", download_root=str(R.RADNO.parent / "modeli"))
    segs, info = m.transcribe(str(zvuk), language="bs", word_timestamps=True, initial_prompt=R.WHISPER_PROMPT,
                              condition_on_previous_text=False, vad_filter=True)
    rijeci = []
    for s in segs:
        javi("Transkript na procesoru", 100 * s.end / max(1, info.duration))
        rijeci += [{"w": w.word.strip(), "t0": round(w.start, 2), "t1": round(w.end, 2)} for w in s.words or [] if w.word.strip()]
    return {"model": "faster-whisper large-v3-turbo", "rijeci": rijeci}


def transkribuj(vid, javi=print):
    d = R.RADNO / vid
    if (d / "transkript.json").exists():
        return
    zvuk = [f for f in sorted(d.glob("zvuk.*")) if not f.name.endswith((".json", ".part"))][0]
    try:
        if not GROQ:
            raise RuntimeError("nema GROQ_API_KEY")
        tr = transkript_groq(d, zvuk, javi)
    except Exception as e:  # noqa: BLE001
        log("Groq transkript:", e, "→ faster-whisper")
        tr = transkript_lokalno(d, zvuk, javi)
    R.pisi(d / "transkript.json", tr)


R.transkribuj = transkribuj


# ───────────────────────────── lice za izrez (OpenCV umjesto Applovog Visiona) ─────────────────────────────

def pozicija_lica(fajl, t0, t1, uzoraka=6):
    """Gdje je lice u kadru (0 = lijevo, 1 = desno), iz komada videa; vremena su unutar komada."""
    import cv2
    lice = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    xs = []
    for k in range(uzoraka):
        t = max(0, t0 + (t1 - t0) * (k + 0.5) / uzoraka)
        jpg = fajl.parent / f"_lice_{fajl.stem}_{k}.jpg"
        try:
            R.ffmpeg("-ss", f"{t:.2f}", "-i", fajl, "-frames:v", "1", "-vf", "scale=640:-2", jpg)
            slika = cv2.imread(str(jpg), cv2.IMREAD_GRAYSCALE)
            nadjena = lice.detectMultiScale(slika, 1.1, 6, minSize=(36, 36))
            if len(nadjena):
                x, _, w, _ = max(nadjena, key=lambda f: f[2])
                xs.append((x + w / 2) / slika.shape[1])
        except Exception:  # noqa: BLE001
            pass
        finally:
            jpg.unlink(missing_ok=True)
    return round(sorted(xs)[len(xs) // 2], 3) if xs else 0.5


# ───────────────────────────── posao ─────────────────────────────

POLJA_OTISKA = ("od", "do", "dijelovi", "naslov", "kadar", "pozicija", "titlovi", "titlovi_ukljuceni", "zbij_pauze")
KORACI = 6     # 1 zvuk · 2 transkript · 3 AI bira · 4 AI doteruje · 5 reelsi · 6 gotovo


class Stanje:
    """Šta admin pokazuje: faza = „N/6 opis|kodovi“ — po jedan kod za svaki isječak:
    c čeka · a AI doteruje · v skida video · p pravi reel · s šalje · g gotov · x greška · - isključen."""

    def __init__(self, javi):
        self.javi, self.korak, self.opis, self.kodovi = javi, 1, "", []
        self.brava = threading.Lock()

    def _posalji(self, procenat=None):
        kod = f"|{''.join(self.kodovi)}" if self.kodovi else ""
        self.javi(f"{self.korak}/{KORACI} {self.opis}{kod}", procenat)

    def korak_(self, korak, opis, procenat=None):
        with self.brava:
            self.korak, self.opis = korak, opis
            self._posalji(procenat)

    def procenat(self, opis, p):
        with self.brava:
            self.opis = opis
            self._posalji(p)

    def isjecak(self, i, kod):
        with self.brava:
            self.kodovi[i] = kod
            gotovih = sum(k in "g-" for k in self.kodovi)
            if self.korak >= 4:
                rade = sum(k in "pvs" for k in self.kodovi)
                self.korak = 5 if rade or gotovih else self.korak
                self.opis = f"Reelsi: {sum(k == 'g' for k in self.kodovi)} od {sum(k != '-' for k in self.kodovi)} gotovo"
            self._posalji(100 * gotovih / max(1, len(self.kodovi)))


def otisak(x, tema):
    """Sve što utiče na izgled reelsa — ako se ne promijeni, reel se ne pravi ponovo."""
    s = json.dumps({**{k: x.get(k) for k in POLJA_OTISKA}, "tema": tema, "v": VERZIJA}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(s.encode()).hexdigest()


def titlovi_i_komadi(vid, x):
    """Titlovi riječ po riječ i komadi videa (za pregled u adminu) za trenutni raspon isječka."""
    rijeci = R.ucitaj_rijeci(R.RADNO / vid)
    komadi = R.dijelovi_isjecka(x, rijeci)
    return R.titlovi(rijeci, komadi), [[round(a, 3), round(b, 3), k] for a, b, k in komadi]


def pripremi(p, st):
    """Koraci 1–2: zvuk i transkript (ili iz Storagea, ako je već rađen) i lokalni projekat za reels.py."""
    vid = p["yt_id"]
    d = R.RADNO / vid
    d.mkdir(parents=True, exist_ok=True)
    (d / ".dodir").touch()
    if not (d / "transkript.json").exists():
        tr = procitaj_json(f"{p['id']}/transkript.json")
        if tr:
            R.pisi(d / "transkript.json", tr)
        else:
            st.korak_(1, "Preuzimam zvuk")
            skini_zvuk(d, p["url"], lambda o, pr=None: st.procenat(o, pr))
            st.korak_(2, "Transkript (Groq)")
            t = time.time()
            transkribuj(vid, lambda o, pr=None: st.procenat(o, pr))
            log(f"transkript {round(time.time() - t)} s")
            posalji_json(f"{p['id']}/transkript.json", R.citaj(d / "transkript.json"))
    if p.get("ispravke") and not (d / "ispravke.json").exists():
        R.pisi(d / "ispravke.json", p["ispravke"])
    info = R.citaj(d / "zvuk.info.json", {})
    proj = R.citaj(d / "projekat.json", {})
    proj.update(id=vid, url=p["url"], naslov=p.get("naslov") or info.get("title") or vid,
                kanal=p.get("kanal") or info.get("channel", ""), trajanje=p.get("trajanje") or info.get("duration"),
                isjecci=p.get("isjecci") or [], tema_rucno=bool(p.get("tema_rucno")),
                sirina=p.get("sirina") or proj.get("sirina"), visina=p.get("visina") or proj.get("visina"))
    if p.get("tema"):
        proj["tema"] = p["tema"]
    R.pisi(d / "projekat.json", proj)
    izmijeni(p["id"], {k: proj[k] for k in ("naslov", "kanal", "trajanje")}, sadrzaj=False)
    return d


def posalji_recenice(p, d):
    rijeci = R.ucitaj_rijeci(d)
    posalji_json(f"{p['id']}/recenice.json", [{"t0": r["t0"], "t1": r["t1"], "tekst": r["tekst"]} for r in R.recenice(rijeci)])


def izbor(p, d, st):
    """Korak 3: AI bira cjeline i temu. Sirovi izbor odmah ide u admin (hafiz vidi listu dok se doteruje)."""
    st.korak_(3, "AI bira isječke")
    isjecci, _ = R.izaberi(p["yt_id"], javi=lambda *a: None)
    proj = R.citaj(d / "projekat.json")
    obrisi_fajlove([g["put"] for g in p.get("gotovi") or []])               # stari reelsi su za stari izbor
    red = izmijeni(p["id"], {"isjecci": isjecci, "tema": proj.get("tema") or R.tema_iz_naslova(proj["naslov"]),
                             "verzija": int(time.time()), "gotovi": []})
    posalji_recenice(p, d)
    return red[0]


def napravi(p, d, st, dorada):
    """Koraci 4–5, za svaki isječak zasebno i tri istovremeno: komad videa ∥ AI doteruje (ispravke, montaža)
    → lice i titlovi → reel → slanje. Reel čiji se izgled nije promijenio se ne pravi ponovo."""
    vid, pid = p["yt_id"], p["id"]
    isjecci = [dict(x) for x in p.get("isjecci") or []]
    pocetni = json.dumps(p.get("isjecci") or [], sort_keys=True)
    tema = p.get("tema") or R.tema_iz_naslova(R.citaj(d / "projekat.json").get("naslov"))
    stari = {g["otisak"]: g for g in p.get("gotovi") or []}           # po otisku: brisanje isječka ne pomjera ostale
    st.kodovi = ["c" if x.get("ukljuci", True) else "-" for x in isjecci]
    st.korak_(4 if dorada else 5, "AI doteruje isječke" if dorada else "Reelsi")
    gotovi, brava, velicina = [], threading.Lock(), {}
    salje = threading.Lock()                     # šalje se jedan po jedan: upload je usko grlo, pa prvi stigne prije
    video_pool = ThreadPoolExecutor(2)

    def jedan(i, x):
        br = i + 1
        try:
            fut = video_pool.submit(segment, d, p["url"], float(x["od"]), float(x["do"]))
            if dorada:                                   # AI radi dok se video skida
                st.isjecak(i, "a")
                R.ispravi_raspon(vid, float(x["od"]), float(x["do"]), lambda *a: None)
                x["dijelovi"], x["rezovi"] = R.rezovi_ai(vid, x)
                x["od"], x["do"] = x["dijelovi"][0][0], x["dijelovi"][-1][1]
            elif not x.get("titlovi"):                   # hafiz je pomjerio raspon → AI ispravi novi dio
                st.isjecak(i, "a")
                R.ispravi_raspon(vid, float(x["od"]), float(x["do"]), lambda *a: None)
            st.isjecak(i, "v")
            seg, pomak = fut.result()
            with brava:
                if not velicina:                         # svi komadi su iste rezolucije kao izvor
                    velicina["s"], velicina["v"] = velicina_videa(seg)
                    proj = R.citaj(d / "projekat.json")
                    proj["sirina"], proj["visina"] = velicina["s"], velicina["v"]
                    proj["tema"] = tema
                    R.pisi(d / "projekat.json", proj)
            if dorada:
                x["pozicija"] = pozicija_lica(seg, x["od"] - pomak, x["do"] - pomak)
            if not x.get("titlovi"):
                x["titlovi"], x["komadi"] = titlovi_i_komadi(vid, x)
            elif not x.get("komadi"):
                x["komadi"] = titlovi_i_komadi(vid, x)[1]
            ot = otisak(x, tema)
            if ot in stari:
                g = {**stari[ot], "br": br, "ime": re.sub(r"^\d+", f"{br:02d}", stari[ot]["ime"])}
            else:
                st.isjecak(i, "p")
                fajl = (d / "reels").joinpath(f"{br:02d}.otisak")
                gotov = [f for f in (d / "reels").glob(f"{br:02d}-*.mp4")
                         if f.with_suffix(".otisak").exists() and f.with_suffix(".otisak").read_text() == ot]
                if gotov:                                # napravljen ranije, slanje je palo — ne pravi iznova
                    fajl, ime = gotov[0], gotov[0].name
                else:
                    for star in (d / "reels").glob(f"{br:02d}-*"):
                        star.unlink()
                    ime = R.napravi_reel(vid, x, br, lambda *a: None, izvor=seg, pomak=pomak)
                    fajl = d / "reels" / ime
                    fajl.with_suffix(".otisak").write_text(ot)
                put = f"{pid}/{br:02d}-{ot[:10]}.mp4"
                with salje:
                    st.isjecak(i, "s")
                    posalji_veliki(put, fajl, "video/mp4")
                g = {"br": br, "put": put, "ime": ime, "otisak": ot, "velicina": fajl.stat().st_size,
                     "trajanje": round(trajanje_fajla(fajl), 1)}
            with brava:
                gotovi.append(g)
                gotovi.sort(key=lambda z: z["br"])
                izmijeni(pid, {"gotovi": gotovi, **({"sirina": velicina["s"], "visina": velicina["v"]} if velicina else {})},
                         sadrzaj=False)                  # admin vidi reel čim je gotov
            st.isjecak(i, "g")
        except Exception:
            st.isjecak(i, "x")
            raise

    try:
        with ThreadPoolExecutor(3) as pool:
            poslovi = [pool.submit(jedan, i, x) for i, x in enumerate(isjecci) if x.get("ukljuci", True)]
            greske = [f.exception() for f in poslovi if f.exception()]
    finally:
        video_pool.shutdown(wait=False)
    zadrzani = {g["put"] for g in gotovi}
    if not greske:
        obrisi_fajlove([g["put"] for g in stari.values() if g["put"] not in zadrzani])
    # Isječci (doterani, s titlovima) idu nazad u admin; hafizove izmjene iz međuvremena ostaju.
    sada = rest("GET", f"reels_poslovi?id=eq.{pid}&select=isjecci,verzija")[0]
    if sada["verzija"] == p["verzija"]:
        if json.dumps(sada["isjecci"], sort_keys=True) == pocetni:
            novi = isjecci
        else:
            pocetak = json.loads(pocetni)
            novi = [isjecci[i] if i < len(pocetak) and a == pocetak[i] and i < len(isjecci) else a
                    for i, a in enumerate(sada["isjecci"])]
        izmijeni(pid, {"isjecci": novi, "ispravke": R.citaj(d / "ispravke.json", {})}, f"&verzija=eq.{p['verzija']}",
                 sadrzaj=False)
    posalji_recenice(p, d)
    if greske:
        raise greske[0]


def obradi(p):
    pid, zahtjev = p["id"], p["zahtjev"]
    TRENUTNI["id"] = pid
    javi = Javljac(pid)
    st = Stanje(javi)
    t = time.time()
    log("posao", pid, p["zahtjev"], p["url"])
    try:
        d = pripremi(p, st)
        dorada = p["zahtjev"] == "predlozi" or not p.get("isjecci")
        if dorada:
            p = izbor(p, d, st)
        napravi(p, d, st, dorada)
        javi.posalji()
        izmijeni(pid, {"zahtjev": None}, f"&zahtjev=eq.{zahtjev}", sadrzaj=False)   # novi zahtjev iz admina ostaje
        trajalo = round(time.time() - t)
        izmijeni(pid, {"stanje": "gotovo", "faza": f"{KORACI}/{KORACI} Gotovo za {trajalo // 60} min {trajalo % 60} s",
                       "procenat": 100, "greska": None}, sadrzaj=False)
        log("gotovo", pid, f"{trajalo} s")
    except (requests.ConnectionError, requests.Timeout) as e:   # slaba veza: posao ostaje u redu, nastavlja se sam
        log("veza puca, posao čeka:", str(e)[:160])
        javi.na_cekanju = None
        try:
            izmijeni(pid, {"faza": "Internet na laptopu je spor ili puca — nastavljam za 2 min"}, sadrzaj=False)
        except Exception:  # noqa: BLE001
            pass
        time.sleep(120)
    except Exception as e:  # noqa: BLE001 — poruka ide u admin
        traceback.print_exc()
        javi.na_cekanju = None
        try:
            izmijeni(pid, {"zahtjev": None}, f"&zahtjev=eq.{zahtjev}", sadrzaj=False)   # ne ponavljaj u krug
            izmijeni(pid, {"stanje": "greska", "greska": str(e)[:600], "faza": None, "procenat": None}, sadrzaj=False)
        except Exception as e2:  # noqa: BLE001
            log("upis greške:", e2)
    finally:
        TRENUTNI["id"] = None


def sljedeci():
    """Najstariji posao koji nešto traži. Zahtjev ostaje upisan dok posao ne završi, pa posao prekinut
    restartom ili gašenjem laptopa krene ispočetka kad se radnik vrati."""
    for p in rest("GET", "reels_poslovi?zahtjev=not.is.null&order=izmijenjeno.asc&limit=3&select=*") or []:
        red = izmijeni(p["id"], {"stanje": "radi", "faza": "Počinjem…", "procenat": None, "greska": None},
                       f"&zahtjev=eq.{p['zahtjev']}", sadrzaj=False)
        if red:
            return {**red[0], "zahtjev": p["zahtjev"]}
    return None


def pocisti():
    """Lokalni video poslije 7 dana; reelsi u Storageu poslije 14 dana bez izmjena (transkript i isječci ostaju)."""
    granica = time.time() - VIDEO_DANA * 86400
    for d in R.RADNO.glob("*/"):
        dodir = d / ".dodir"
        if dodir.exists() and dodir.stat().st_mtime < granica:
            shutil.rmtree(d, ignore_errors=True)
            log("obrisan lokalni", d.name)
    staro = (datetime.now(timezone.utc) - timedelta(days=REELS_DANA)).strftime("%Y-%m-%dT%H:%M:%SZ")
    for p in rest("GET", f"reels_poslovi?izmijenjeno=lt.{staro}&gotovi=neq.[]&select=id,gotovi") or []:
        obrisi_fajlove([g["put"] for g in p["gotovi"]])
        izmijeni(p["id"], {"gotovi": [], "faza": f"Reelsi obrisani nakon {REELS_DANA} dana — „Napravi ponovo“ ih vraća"},
                 sadrzaj=False)
        log("obrisani reelsi", p["id"])


def osvjezi_ytdlp():
    subprocess.run(["pip", "install", "-q", "-U", "yt-dlp[default]"], capture_output=True)


def main():
    R.RADNO.mkdir(parents=True, exist_ok=True)
    pripremi_llm()
    threading.Thread(target=puls, daemon=True).start()
    log(f"Radnik spreman ({SB_URL}). Čekam poslove iz admina…")
    zadnje_ciscenje = zadnje_osvjezavanje = time.time()
    while True:
        try:
            p = sljedeci()
            if p:
                obradi(p)
                continue
            if time.time() - zadnje_ciscenje > 3600:
                zadnje_ciscenje = time.time()
                pocisti()
            if time.time() - zadnje_osvjezavanje > 86400:          # YouTube se mijenja — yt-dlp jednom dnevno
                zadnje_osvjezavanje = time.time()
                osvjezi_ytdlp()
        except Exception as e:  # noqa: BLE001 — mreža ili baza: pokušaj opet
            log("greška:", e)
            time.sleep(20)
        time.sleep(5)


if __name__ == "__main__":
    main()
