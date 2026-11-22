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
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import reels as R

# reels.py učitava Pillow/numpy tek kad se pokrene sam
R.np, R.Image, R.ImageDraw, R.ImageFilter, R.ImageFont = np, Image, ImageDraw, ImageFilter, ImageFont
# Instagram ionako prekodira; ovako isječak od 90 s ostaje ispod 50 MB (limit besplatnog Storagea)
R.KODIRANJE = ["-preset", "faster", "-crf", "21", "-maxrate", "3M", "-bufsize", "6M"]

SB_URL = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_SECRET_KEY"]
GROQ = os.environ.get("GROQ_API_KEY", "").strip()
GEMINI = os.environ.get("GEMINI_API_KEY", "").strip()
GROQ_URL = "https://api.groq.com/openai/v1"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
GROQ_WHISPER = os.environ.get("REELS_GROQ_WHISPER", "whisper-large-v3")
OLLAMA = os.environ.get("REELS_OLLAMA", "http://host.docker.internal:11434").rstrip("/")
BUCKET = "reels"
VERZIJA = "1"
VIDEO_DANA, REELS_DANA = 7, 14          # lokalni video / reelsi u Storageu
KOMAD_S = 20 * 60                       # zvuk za Groq ide u komadima (limit 25 MB po fajlu)
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
        m = _prvi_koji_radi(GEMINI_URL, GEMINI, [*zeljeni, *flash, "gemini-flash-latest", *lite])
        if m:
            LLM.append(("Gemini", GEMINI_URL, GEMINI, m))
        else:
            log("Gemini: nijedan model ne odgovara (kvota?) — preskačem")
    if GROQ:
        ids = _modeli(GROQ_URL, GROQ)
        m = os.environ.get("REELS_GROQ_LLM") or next((z for z in ("openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b",
                                                                   "llama-3.3-70b-versatile") if z in ids), None)
        if m:
            LLM.append(("Groq", GROQ_URL, GROQ, m))
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
        if BLOKIRANO.get(ime, 0) > time.time():
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
        for pokusaj in range(3):
            try:
                r = requests.post(f"{url}/chat/completions", json=body, timeout=300,
                                  headers={"Authorization": f"Bearer {kljuc}"})
            except requests.RequestException as e:
                zadnja = f"{ime}: {e}"
                time.sleep(5)
                continue
            if r.status_code == 429 and "quota" in r.text.lower():   # dnevna kvota potrošena → 10 min preskačemo
                zadnja = f"{ime} 429: kvota potrošena"
                BLOKIRANO[ime] = time.time() + 600
                break
            if r.status_code in (429, 500, 502, 503, 504):      # limit u minuti ili preopterećenje
                zadnja = f"{ime} {r.status_code}: {r.text[:200]}"
                time.sleep(min(30, float(r.headers.get("retry-after") or 0) or 6 * (pokusaj + 1)))
                continue
            if r.status_code >= 400:
                zadnja = f"{ime} {r.status_code}: {r.text[:300]}"
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
    cmd = ["yt-dlp", "--newline", "--no-playlist", "--no-update", *args]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    zadnje = []
    for line in p.stdout:
        zadnje = (zadnje + [line.strip()])[-8:]
        m = re.search(r"\[download\]\s+([\d.]+)%", line)
        if m and javi:
            javi(opis, float(m[1]))
    if p.wait():
        greske = [z for z in zadnje if "ERROR" in z] or zadnje[-3:]
        raise RuntimeError("YouTube preuzimanje nije uspjelo: " + " ".join(greske)[-500:])


def skini_zvuk(d, url, javi):
    if not list(d.glob("zvuk.*")):
        yt(["-f", "ba[ext=m4a]/ba", "--write-info-json", "-o", str(d / "zvuk.%(ext)s"), url], javi, "Preuzimam zvuk…")


class SkiniVideo(threading.Thread):
    """Video ide u pozadini dok traju transkript i AI."""

    def __init__(self, d, url):
        super().__init__(daemon=True)
        self.d, self.url, self.greska = d, url, None

    def run(self):
        try:
            if not (self.d / "izvor.mp4").exists():
                yt(["-f", FORMAT, "--merge-output-format", "mp4", "-o", str(self.d / "izvor.%(ext)s"), self.url])
        except Exception as e:  # noqa: BLE001
            self.greska = e

    def sacekaj(self, javi):
        if self.is_alive():
            javi("Čekam da se video preuzme…", None)
        self.join()
        if self.greska:
            raise self.greska


def velicina_videa(d):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "json", str(d / "izvor.mp4")], capture_output=True, text=True).stdout
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
            r = requests.post(f"{GROQ_URL}/audio/transcriptions", headers={"Authorization": f"Bearer {GROQ}"}, timeout=600,
                              files={"file": (p.name, f, "audio/ogg")},
                              data=[("model", GROQ_WHISPER), ("language", "bs"), ("response_format", "verbose_json"),
                                    ("timestamp_granularities[]", "word"), ("timestamp_granularities[]", "segment"),
                                    ("prompt", R.WHISPER_PROMPT), ("temperature", "0")])
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(min(90, float(r.headers.get("retry-after") or 0) or 15 * (pokusaj + 1)))
            continue
        if r.status_code >= 400:
            raise RuntimeError(f"Groq {r.status_code}: {r.text[:300]}")
        return [{"w": w["word"].strip(), "t0": round(w["start"] + pomak, 2), "t1": round(w["end"] + pomak, 2)}
                for w in r.json().get("words", []) if w["word"].strip()]
    raise RuntimeError("Groq: previše zahtjeva, pokušaj kasnije")


def transkript_groq(d, zvuk, javi):
    dur = trajanje_fajla(zvuk)
    granice, t = [0.0], KOMAD_S
    tis = tisine(zvuk) if dur > KOMAD_S else []
    while t < dur - 60:
        blizu = [s for s in tis if abs(s - t) < 45]
        granice.append(min(blizu, key=lambda s: abs(s - t)) if blizu else t)
        t = granice[-1] + KOMAD_S
    granice.append(dur)
    rijeci = []
    for k, (a, b) in enumerate(zip(granice, granice[1:])):
        javi(f"Transkript (Groq) {k + 1}/{len(granice) - 1}…", 100 * k / (len(granice) - 1))
        komad = d / f"_komad{k}.ogg"
        R.ffmpeg("-ss", f"{a:.2f}", "-t", f"{b - a:.2f}", "-i", zvuk, "-vn", "-ac", "1", "-ar", "16000",
                 "-c:a", "libopus", "-b:a", "24k", komad)
        try:
            rijeci += groq_komad(komad, a)
        finally:
            komad.unlink(missing_ok=True)
    return {"model": f"groq:{GROQ_WHISPER}", "rijeci": rijeci}


def transkript_lokalno(d, zvuk, javi):
    from faster_whisper import WhisperModel
    javi("Transkript na procesoru (bez Groqa, sporije)…", None)
    m = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8", download_root=str(R.RADNO.parent / "modeli"))
    segs, info = m.transcribe(str(zvuk), language="bs", word_timestamps=True, initial_prompt=R.WHISPER_PROMPT,
                              condition_on_previous_text=False, vad_filter=True)
    rijeci = []
    for s in segs:
        javi("Transkript na procesoru…", 100 * s.end / max(1, info.duration))
        rijeci += [{"w": w.word.strip(), "t0": round(w.start, 2), "t1": round(w.end, 2)} for w in s.words or [] if w.word.strip()]
    return {"model": "faster-whisper large-v3-turbo", "rijeci": rijeci}


def transkribuj(vid, javi=print):
    d = R.RADNO / vid
    if (d / "transkript.json").exists():
        return
    zvuk = sorted(d.glob("zvuk.*[!n]"))[0]          # zvuk.m4a / .webm, ne zvuk.info.json
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

def pozicija_lica(vid, t0, t1, uzoraka=6):
    import cv2
    d = R.RADNO / vid
    lice = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    xs = []
    for k in range(uzoraka):
        t = t0 + (t1 - t0) * (k + 0.5) / uzoraka
        jpg = d / f"_lice{k}.jpg"
        try:
            R.ffmpeg("-ss", f"{t:.2f}", "-i", d / "izvor.mp4", "-frames:v", "1", "-vf", "scale=640:-2", jpg)
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


def otisak(x, tema):
    """Sve što utiče na izgled reelsa — ako se ne promijeni, reel se ne pravi ponovo."""
    s = json.dumps({**{k: x.get(k) for k in POLJA_OTISKA}, "tema": tema, "v": VERZIJA}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(s.encode()).hexdigest()


def titlovi_za(vid, x):
    R.ispravi_raspon(vid, float(x["od"]), float(x["do"]), lambda *a: None)
    rijeci = R.ucitaj_rijeci(R.RADNO / vid)
    return R.titlovi(rijeci, R.dijelovi_isjecka(x, rijeci))


def pripremi(p, javi):
    """Lokalna kopija posla (radno/<yt_id>/) kakvu očekuje reels.py: transkript, ispravke, projekat."""
    vid = p["yt_id"]
    d = R.RADNO / vid
    d.mkdir(parents=True, exist_ok=True)
    (d / ".dodir").touch()
    video = SkiniVideo(d, p["url"])
    video.start()
    if not (d / "transkript.json").exists():
        tr = procitaj_json(f"{p['id']}/transkript.json")
        if tr:
            R.pisi(d / "transkript.json", tr)
        else:
            skini_zvuk(d, p["url"], javi)
            t = time.time()
            transkribuj(vid, javi)
            log(f"transkript {round(time.time() - t)} s")
            posalji_json(f"{p['id']}/transkript.json", R.citaj(d / "transkript.json"))
    if p.get("ispravke") and not (d / "ispravke.json").exists():
        R.pisi(d / "ispravke.json", p["ispravke"])
    info = R.citaj(d / "zvuk.info.json", {})
    proj = R.citaj(d / "projekat.json", {})
    proj.update(id=vid, url=p["url"], naslov=p.get("naslov") or info.get("title") or vid,
                kanal=p.get("kanal") or info.get("channel", ""), trajanje=p.get("trajanje") or info.get("duration"),
                isjecci=p.get("isjecci") or [], tema_rucno=bool(p.get("tema_rucno")))
    if p.get("tema"):
        proj["tema"] = p["tema"]
    R.pisi(d / "projekat.json", proj)
    izmijeni(p["id"], {k: proj[k] for k in ("naslov", "kanal", "trajanje")}, sadrzaj=False)
    return d, video


def posalji_recenice(p, d):
    rijeci = R.ucitaj_rijeci(d)
    posalji_json(f"{p['id']}/recenice.json", [{"t0": r["t0"], "t1": r["t1"], "tekst": r["tekst"]} for r in R.recenice(rijeci)])


def izbor(p, d, video, javi):
    """AI bira 5–6 cjelina, ispravlja riječi i reže (reels.predlozi), pa lice i titlovi."""
    vid = p["yt_id"]
    stvarno_lice, R.pozicija_lica = pozicija_lica, (lambda *a, **k: 0.5)   # video možda još nije stigao
    try:
        isjecci = R.predlozi(vid, javi=javi)
    finally:
        R.pozicija_lica = stvarno_lice
    video.sacekaj(javi)
    for k, x in enumerate(isjecci, 1):
        javi(f"Lice i titlovi {k}/{len(isjecci)}…", None)
        x["pozicija"] = pozicija_lica(vid, x["od"], x["do"])
        x["titlovi"] = titlovi_za(vid, x)
    proj = R.citaj(d / "projekat.json")
    proj["isjecci"] = isjecci
    R.pisi(d / "projekat.json", proj)
    sirina, visina = velicina_videa(d)
    obrisi_fajlove([g["put"] for g in p.get("gotovi") or []])                # stari reelsi su za stari izbor
    red = izmijeni(p["id"], {"isjecci": isjecci, "tema": proj.get("tema") or R.tema_iz_naslova(proj["naslov"]),
                             "ispravke": R.citaj(d / "ispravke.json", {}), "verzija": int(time.time()), "gotovi": [],
                             "sirina": sirina, "visina": visina})
    posalji_recenice(p, d)
    return red[0]


def napravi(p, d, video, javi):
    """Pravi reelse čiji se izgled promijenio od zadnje izrade; ostali ostaju kakvi jesu."""
    vid, pid = p["yt_id"], p["id"]
    video.sacekaj(javi)
    if not p.get("sirina"):
        sirina, visina = velicina_videa(d)
        izmijeni(pid, {"sirina": sirina, "visina": visina}, sadrzaj=False)
    proj = R.citaj(d / "projekat.json")
    proj["sirina"], proj["visina"] = velicina_videa(d)
    tema = p.get("tema") or R.tema_iz_naslova(proj.get("naslov"))
    proj["tema"] = tema
    isjecci = p.get("isjecci") or []
    proj["isjecci"] = isjecci
    R.pisi(d / "projekat.json", proj)

    novi_titlovi = {}
    for i, x in enumerate(isjecci):
        if x.get("ukljuci", True) and not x.get("titlovi"):               # novi raspon → AI ispravi pa titlovi
            javi(f"Isječak {i + 1}: AI ispravlja riječi…", None)
            x["titlovi"] = novi_titlovi[i] = titlovi_za(vid, x)

    stari = {g["otisak"]: g for g in p.get("gotovi") or []}      # po otisku: brisanje isječka ne pomjera ostale
    gotovi, za_izradu = [], []
    for br, x in enumerate(isjecci, 1):
        if not x.get("ukljuci", True):
            continue
        ot = otisak(x, tema)
        if ot in stari:
            gotovi.append({**stari[ot], "br": br, "ime": re.sub(r"^\d+", f"{br:02d}", stari[ot]["ime"])})
        else:
            za_izradu.append((br, x, ot))
    for k, (br, x, ot) in enumerate(za_izradu, 1):
        javi(f"Pravim reel {k}/{len(za_izradu)}…", 100 * (k - 1) / len(za_izradu))
        gotov = [f for f in (d / "reels").glob(f"{br:02d}-*.mp4")
                 if f.with_suffix(".otisak").exists() and f.with_suffix(".otisak").read_text() == ot]
        if gotov:                                   # već napravljen (npr. slanje je prije palo) — ne pravi iznova
            fajl, ime = gotov[0], gotov[0].name
        else:
            for star in (d / "reels").glob(f"{br:02d}-*"):
                star.unlink()
            ime = R.napravi_reel(vid, x, br, lambda *a: None)
            fajl = d / "reels" / ime
            fajl.with_suffix(".otisak").write_text(ot)
        put = f"{pid}/{br:02d}-{ot[:10]}.mp4"
        javi(f"Šaljem reel {k}/{len(za_izradu)}…", 100 * (k - 0.3) / len(za_izradu))
        posalji_veliki(put, fajl, "video/mp4")
        gotovi.append({"br": br, "put": put, "ime": ime, "otisak": ot, "velicina": fajl.stat().st_size,
                       "trajanje": round(trajanje_fajla(fajl), 1)})
        gotovi.sort(key=lambda g: g["br"])
        izmijeni(pid, {"gotovi": gotovi}, sadrzaj=False)                   # admin vidi reel čim je gotov
    zadrzani = {g["put"] for g in gotovi}
    obrisi_fajlove([g["put"] for g in stari.values() if g["put"] not in zadrzani])
    polja = {"gotovi": gotovi, "ispravke": R.citaj(d / "ispravke.json", {})}
    if novi_titlovi:                         # titlovi idu u admin samo ako hafiz u međuvremenu nije mijenjao isječke
        sada = rest("GET", f"reels_poslovi?id=eq.{pid}&select=isjecci,verzija")[0]
        if sada["verzija"] == p["verzija"] and len(sada["isjecci"]) == len(isjecci):
            for i, t in novi_titlovi.items():
                a, b = sada["isjecci"][i], isjecci[i]
                if not a.get("titlovi") and all(a.get(k) == b.get(k) for k in ("od", "do", "dijelovi", "zbij_pauze")):
                    a["titlovi"] = t
            polja["isjecci"] = sada["isjecci"]
    izmijeni(pid, polja, f"&verzija=eq.{p['verzija']}" if "isjecci" in polja else "", sadrzaj=False)
    posalji_recenice(p, d)


def obradi(p):
    pid, zahtjev = p["id"], p["zahtjev"]
    TRENUTNI["id"] = pid
    javi = Javljac(pid)
    t = time.time()
    log("posao", pid, p["zahtjev"], p["url"])
    try:
        d, video = pripremi(p, javi)
        if p["zahtjev"] == "predlozi" or not p.get("isjecci"):
            p = izbor(p, d, video, javi)
        napravi(p, d, video, javi)
        javi.posalji()
        izmijeni(pid, {"zahtjev": None}, f"&zahtjev=eq.{zahtjev}", sadrzaj=False)   # novi zahtjev iz admina ostaje
        izmijeni(pid, {"stanje": "gotovo", "faza": f"Gotovo za {round((time.time() - t) / 60, 1)} min", "procenat": 100,
                       "greska": None}, sadrzaj=False)
        log("gotovo", pid, f"{round(time.time() - t)} s")
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
