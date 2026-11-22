#!/usr/bin/env python3
"""Reels iz hafizovog YouTube videa — lokalni alat za Mac, sve besplatno.

    ./reels                    otvori ekran na http://localhost:8765
    ./reels <link>             preuzmi, transkribuj i predloži isječke (u terminalu)
    ./reels <link> --napravi   ... i odmah napravi sve predložene reelse (--ponovo: AI bira iznova)

Tok: yt-dlp (preuzimanje) → mlx-whisper large-v3-turbo (transkript, bosanski, na
GPU-u Maca) → lokalni model u Ollami (izbor 5–6 cjelina) → ffmpeg + Pillow
(vertikalni 1080×1920 s titlovima). Sve ostaje u radno/<id videa>/.
"""
import difflib, json, mimetypes, os, re, shutil, subprocess, sys, threading, time, unicodedata, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")  # Hugging Face-ov xet zna puziti; klasično preuzimanje je brže
KORIJEN = Path(__file__).resolve().parent
RADNO = Path(os.environ.get("REELS_RADNO", KORIJEN / "radno"))
FONTOVI = KORIJEN / "fontovi"
PORT = int(os.environ.get("REELS_PORT", "8765"))
WHISPER = os.environ.get("REELS_WHISPER", "mlx-community/whisper-large-v3-turbo")
# Bilo koji model iz Ollame; ili besplatni API kompatibilan s OpenAI-jem (npr. Gemini/Groq) uz REELS_LLM_URL + REELS_LLM_KEY.
LLM_URL = os.environ.get("REELS_LLM_URL", "http://localhost:11434")
LLM_MODEL = os.environ.get("REELS_LLM_MODEL", "gemma4:12b-it-qat")
LLM_KEY = os.environ.get("REELS_LLM_KEY", "")

MIN_S, MAX_S = 30, 90           # željeno trajanje isječka
W, H = 1080, 1920               # Instagram reels
GOLD, GOLD_L = (198, 169, 104), (233, 199, 126)
KODIRANJE = ["-crf", "18"]      # x264; radnik (Docker) traži manje fajlove zbog limita Storagea

WHISPER_PROMPT = ("Predavanje hafiza Ammara Bašića. Allah, dželle šanuhu, Poslanik, sallallahu alejhi ve sellem, "
                  "Kur'an, ajet, hadis, sura, iman, namaz, dova, sabur, šukur, ahiret, Džennet, Džehennem, "
                  "subhanallah, elhamdulillah, inšallah, mašallah.")


# ───────────────────────────── pomoćno ─────────────────────────────

def ffmpeg(*args):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-y", *map(str, args)], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError("ffmpeg: " + r.stderr.strip()[-800:])


def slug(s, n=40):
    s = unicodedata.normalize("NFKD", s.replace("đ", "dj").replace("Đ", "Dj")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:n].strip("-") or "reel"


def mmss(t):
    return f"{int(t // 60):02d}:{int(t % 60):02d}"


def citaj(p, default=None):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return default


def pisi(p, data):
    tmp = Path(str(p) + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    tmp.replace(p)


def video_id(url):
    m = re.search(r"(?:v=|youtu\.be/|shorts/|live/|embed/)([\w-]{11})", url)
    if m:
        return m[1]
    if re.fullmatch(r"[\w-]{11}", url.strip()):
        return url.strip()
    raise ValueError("Ne prepoznajem YouTube link.")


def ytdlp():
    lokalni = KORIJEN / ".venv/bin/yt-dlp"
    return str(lokalni) if lokalni.exists() else "yt-dlp"


# ───────────────────────────── 1. preuzimanje ─────────────────────────────

def preuzmi(url, javi=print):
    vid = video_id(url)
    d = RADNO / vid
    d.mkdir(parents=True, exist_ok=True)
    if not (d / "izvor.mp4").exists():
        cmd = [ytdlp(), "--newline", "--no-playlist", "--no-update", "--write-info-json",
               "-f", "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
               "--merge-output-format", "mp4", "-o", str(d / "izvor.%(ext)s"), f"https://www.youtube.com/watch?v={vid}"]
        if not shutil.which("deno") and shutil.which("node"):
            cmd[1:1] = ["--js-runtimes", "node"]
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        zadnje = []
        for line in p.stdout:
            zadnje = (zadnje + [line.strip()])[-6:]
            m = re.search(r"\[download\]\s+([\d.]+)%", line)
            if m:
                javi("Preuzimam video…", float(m[1]))
        if p.wait() or not (d / "izvor.mp4").exists():
            raise RuntimeError("Preuzimanje nije uspjelo:\n" + "\n".join(zadnje))
    info = citaj(d / "izvor.info.json", {})
    pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                    "stream=width,height", "-of", "json", str(d / "izvor.mp4")],
                                   capture_output=True, text=True).stdout)["streams"][0]
    proj = citaj(d / "projekat.json", {})
    proj.update(id=vid, url=f"https://www.youtube.com/watch?v={vid}", naslov=info.get("title", vid),
                kanal=info.get("channel", ""), trajanje=info.get("duration"), sirina=pr["width"], visina=pr["height"])
    proj.setdefault("isjecci", [])
    pisi(d / "projekat.json", proj)
    return vid


# ───────────────────────────── 2. transkript ─────────────────────────────

def _transkribuj_ovdje(d):
    """Radi u zasebnom procesu (memorija GPU-a se oslobodi čim završi)."""
    import mlx_whisper
    d = Path(d)
    wav = d / "zvuk.wav"
    if not wav.exists():
        ffmpeg("-i", d / "izvor.mp4", "-vn", "-ac", "1", "-ar", "16000", wav)
    r = mlx_whisper.transcribe(str(wav), path_or_hf_repo=WHISPER, language="bs", word_timestamps=True,
                               initial_prompt=WHISPER_PROMPT, condition_on_previous_text=False,
                               hallucination_silence_threshold=2.0, verbose=False)
    rijeci = [{"w": w["word"].strip(), "t0": round(w["start"], 2), "t1": round(w["end"], 2)}
              for s in r["segments"] for w in s.get("words", []) if w["word"].strip()]
    pisi(d / "transkript.json", {"model": WHISPER, "rijeci": rijeci})
    wav.unlink(missing_ok=True)


def transkribuj(vid, javi=print):
    d = RADNO / vid
    if (d / "transkript.json").exists():
        return
    javi("Pravim transkript (Whisper)… prvi put se skida i model (~1,6 GB)", None)
    p = subprocess.Popen([sys.executable, __file__, "_transkribuj", str(d)], stderr=subprocess.PIPE, stdout=subprocess.DEVNULL)
    buf, rep = b"", []
    for chunk in iter(lambda: p.stderr.read(200), b""):
        buf = (buf + chunk)[-2000:]
        rep = (rep + [chunk])[-20:]
        m = re.findall(rb"(\d+)%\|", buf)
        if m:
            javi("Pravim transkript…", float(m[-1]))
    if p.wait():
        raise RuntimeError("Transkript nije uspio:\n" + b"".join(rep).decode(errors="ignore")[-800:])


# Česti vjerski izrazi koje Whisper piše na razne načine (po riječi, da vremena ostanu ista)
ISPRAVKE = [(re.compile(f"^(?:{p})$", re.I), z) for p, z in [
    (r"s[ae]l+[ae]l+ahu", "sallallahu"),
    (r"alaihi?|aleihi?|alejh", "alejhi"),
    (r"vselem|svelem|vis+alam|ves+el+em|vis+el+em|ves+alam", "ve sellem"),
    (r"alaihis+alama?|alejhis+elama?", "alejhis-selam"),
    (r"đ[oe]l?šanu(hu)?|dželešanu(hu)?|džel+ešanu(hu)?", "dželle šanuhu"),
]]


def ispravi(w):
    jezgro = w.rstrip(".,?!;:…")
    for uzorak, zamjena in ISPRAVKE:
        if uzorak.match(jezgro):
            return zamjena + w[len(jezgro):]
    return w


def osnovne_rijeci(d):
    """Whisperove riječi uz sitne ispravke (skraćenice, salavat) — na ovim indeksima stoje AI ispravke."""
    tr = citaj(Path(d) / "transkript.json")
    if not tr:
        return None
    out = []
    for w in tr["rijeci"]:
        if out and re.fullmatch(r"\.\w{0,3}\.?", w["w"]):          # „s .a .v.“ → „s.a.v.“
            out[-1] = {**out[-1], "w": out[-1]["w"] + w["w"], "t1": w["t1"]}
        else:
            out.append(dict(w))
    return [{**w, "w": ispravi(w["w"])} for w in out]


def _norm(w):
    return re.sub(r"[^\w]", "", w.lower())


def rasporedi(stare, tekst):
    """Ispravljen tekst rečenice → riječi s vremenima. Riječi koje su ostale iste
    zadrže svoje vrijeme, a nove dobiju vrijeme onih koje su zamijenile (po dužini)."""
    nove = tekst.split()
    sm = difflib.SequenceMatcher(a=[_norm(w["w"]) for w in stare], b=[_norm(w) for w in nove], autojunk=False)
    out = []
    for tag, a0, a1, b0, b1 in sm.get_opcodes():
        if tag == "equal":
            out += [{"w": nove[b0 + k], "t0": stare[a0 + k]["t0"], "t1": stare[a0 + k]["t1"]} for k in range(b1 - b0)]
        elif b1 > b0:
            if a1 > a0:
                T0, T1 = stare[a0]["t0"], stare[a1 - 1]["t1"]
            else:                                   # umetnuto: između susjednih riječi
                T0 = stare[a0 - 1]["t1"] if a0 else stare[0]["t0"]
                T1 = stare[a0]["t0"] if a0 < len(stare) else stare[-1]["t1"]
            duz = [len(w) + 1 for w in nove[b0:b1]]
            t = T0
            for w, n in zip(nove[b0:b1], duz):
                d = (T1 - T0) * n / sum(duz)
                out.append({"w": w, "t0": round(t, 2), "t1": round(t + d, 2)})
                t += d
    return out


def ucitaj_rijeci(d):
    """Riječi za titlove i AI: osnovne + rečenice koje je AI ispravio (radno/<id>/ispravke.json)."""
    rijeci = osnovne_rijeci(d)
    if rijeci is None:
        return None
    isp = citaj(Path(d) / "ispravke.json", {})
    for kljuc in sorted(isp, key=lambda k: -int(k.split("-")[0])):   # od kraja, da indeksi ostanu tačni
        i0, i1 = map(int, kljuc.split("-"))
        if i1 < len(rijeci) and isp[kljuc].strip():
            rijeci[i0:i1 + 1] = rasporedi(rijeci[i0:i1 + 1], isp[kljuc])
    return rijeci


SKRACENICA = re.compile(r"^\w{1,3}\.(\w{1,3}\.)+$")  # dž.š. a.s. s.a.v.s. r.a.


def recenice(rijeci, max_s=25):
    """Riječi → rečenice (granice isječaka uvijek padaju na kraj rečenice)."""
    out, cur = [], []
    for i, w in enumerate(rijeci):
        cur.append(i)
        nxt = rijeci[i + 1] if i + 1 < len(rijeci) else None
        dur = w["t1"] - rijeci[cur[0]]["t0"]
        kraj_r = w["w"][-1:] in ".?!…" and not SKRACENICA.match(w["w"])
        if (nxt is None or kraj_r or nxt["t0"] - w["t1"] > 1.5
                or (dur > max_s and w["w"][-1:] in ",;:") or dur > max_s + 12):
            out.append({"i0": cur[0], "i1": i, "t0": rijeci[cur[0]]["t0"], "t1": w["t1"],
                        "tekst": " ".join(rijeci[j]["w"] for j in cur)})
            cur = []
    return out


# ───────────────────────────── 3. AI izbor ─────────────────────────────

SHEMA = {"type": "object", "required": ["tema", "isjecci"], "properties": {"tema": {"type": "string"}, "isjecci": {"type": "array", "items": {
    "type": "object", "required": ["od", "do", "naslov", "tip", "poenta", "zasto"],
    "properties": {"od": {"type": "integer"}, "do": {"type": "integer"}, "naslov": {"type": "string"},
                   "tip": {"type": "string"}, "poenta": {"type": "string"}, "zasto": {"type": "string"}}}}}}


def llm(sistem, poruka, shema=None):
    poruke = [{"role": "system", "content": sistem}, {"role": "user", "content": poruka}]
    if not LLM_KEY:  # Ollama, lokalno
        ctx = min(65536, max(8192, (len(sistem + poruka) // 3 + 3000) // 4096 * 4096 + 4096))
        body = {"model": LLM_MODEL, "messages": poruke, "stream": False, "think": False, "format": shema or SHEMA,
                "options": {"temperature": 0.4, "num_ctx": ctx}}
        url, hdr = LLM_URL.rstrip("/") + "/api/chat", {}
    else:  # besplatni API kompatibilan s OpenAI-jem
        body = {"model": LLM_MODEL, "messages": poruke, "temperature": 0.4, "response_format": {"type": "json_object"}}
        url, hdr = LLM_URL.rstrip("/") + "/chat/completions", {"Authorization": f"Bearer {LLM_KEY}"}
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", **hdr})
    try:
        with urllib.request.urlopen(req, timeout=1200) as r:
            odg = json.load(r)
    except OSError as e:
        raise RuntimeError(f"AI model ne odgovara ({LLM_URL}, {LLM_MODEL}): {e}. Je li Ollama pokrenuta?") from e
    tekst = odg["message"]["content"] if "message" in odg else odg["choices"][0]["message"]["content"]
    tekst = re.sub(r"^```(?:json)?|```$", "", (tekst or "").strip()).strip()
    if not tekst:
        raise RuntimeError(f"AI je vratio prazan odgovor ({odg.get('done_reason', '?')}).")
    return json.loads(tekst)


def predlozi(vid, n=6, javi=print):
    d = RADNO / vid
    proj = citaj(d / "projekat.json")
    rijeci = ucitaj_rijeci(d)
    rec = recenice(rijeci)
    sistem = ("Ti si iskusan urednik društvenih mreža za hafiza Ammara Bašića, koji drži islamska predavanja "
              "na bosanskom jeziku. Iz predavanja biraš najbolje dijelove za Instagram reels. Pišeš ispravnim bosanskim.")
    poruka = f"""Ispod je automatski transkript videa „{proj['naslov']}“, podijeljen u rečenice. Svaka ima broj i vrijeme (mm:ss). Transkript može imati pogrešno prepoznatih riječi.

Izaberi tačno {n} isječaka za Instagram reels. Pravila:
- Svaki isječak je zaokružena cjelina s jednom jasnom poentom: primjer ili priča, komentar ajeta ili hadisa, misao ili praktičan savjet. Gledalac koji nije vidio ostatak videa mora ga razumjeti.
- Trajanje {MIN_S}–{MAX_S} sekundi (najbolje 40–75). Računaj po vremenima rečenica.
- Prva rečenica uvodi misao (ne počinje nastavkom poput „i onda“, „kao što rekoh“, „dakle“), a zadnja zaokružuje poentu.
- Isječak ne smije završiti pitanjem, najavom ili pričom na koju odgovor dolazi kasnije: ako je u njemu pitanje ili priča, uključi i odgovor (npr. dovu ili pouku). Ako bi tako bio predug, izaberi drugi dio.
- Isječci se ne preklapaju i svaki ima drugačiju poentu. Preskoči uvod, pozdrave, najave i zahvale.
- Biraj najjače, najemotivnije i najkorisnije dijelove.

Za svaki isječak vrati:
- od: broj prve rečenice, do: broj zadnje rečenice
- naslov: do 6 riječi, kao udica za reels, bez navodnika
- tip: jedno od primjer, priča, komentar, hadis, ajet, misao, savjet
- poenta: jedna rečenica — šta gledalac nauči
- zasto: jedna rečenica — zašto je ovaj dio dobar za reels

Vrati i „tema“: naziv teme cijelog predavanja, 2–6 riječi (npr. „Rješenje za tugu i brige“).

Vrati JSON oblika {{"tema": "", "isjecci": [{{"od": 0, "do": 0, "naslov": "", "tip": "", "poenta": "", "zasto": ""}}]}}.

TRANSKRIPT:
""" + "\n".join(f"[{i}] ({mmss(r['t0'])}) {r['tekst']}" for i, r in enumerate(rec))
    javi(f"AI bira isječke ({LLM_MODEL})…", None)
    t = time.time()
    isjecci, sirovo = [], []
    greska = None
    for _ in range(2):                    # ako model vrati manje od 5 upotrebljivih, pitaj još jednom
        try:
            odg = llm(sistem, poruka)
        except (RuntimeError, ValueError) as e:
            greska = e
            continue
        if odg.get("tema") and not proj.get("tema_rucno"):
            proj["tema"] = str(odg["tema"]).strip(" \"'„“”.")
        s = odg.get("isjecci", [])
        novi = sredi(s, rec, rijeci)
        if len(novi) > len(isjecci):
            isjecci, sirovo = novi, s
        if len(isjecci) >= 5:
            break
    lektorisi_naslove(proj, isjecci)
    if not isjecci:
        raise RuntimeError(f"AI nije vratio nijedan upotrebljiv isječak ({greska or 'prazan izbor'}). Pokušaj „Ponovo predloži“.")
    for k, x in enumerate(isjecci, 1):
        javi(f"Isječak {k}/{len(isjecci)}: lice, AI ispravka riječi i montaža…", None)
        x["pozicija"] = pozicija_lica(vid, x["od"], x["do"])
        ispravi_raspon(vid, x["od"], x["do"], lambda *a: None)
        x["dijelovi"], x["rezovi"] = rezovi_ai(vid, x)
        x["od"], x["do"] = x["dijelovi"][0][0], x["dijelovi"][-1][1]
    proj["isjecci"] = isjecci
    proj["verzija"] = int(time.time())            # stari ekran ne smije prepisati novi izbor
    proj["ai"] = {"model": LLM_MODEL, "sekundi": round(time.time() - t), "sirovo": sirovo}
    pisi(d / "projekat.json", proj)
    return isjecci


SHEMA_ISPRAVKE = {"type": "object", "required": ["recenice"], "properties": {"recenice": {"type": "array", "items": {
    "type": "object", "required": ["i", "tekst"], "properties": {"i": {"type": "integer"}, "tekst": {"type": "string"}}}}}}


def ispravi_raspon(vid, t0, t1, javi=print):
    """AI ispravi greške prepoznavanja u rečenicama koje padaju u [t0, t1] (samo one još neispravljene)."""
    d = RADNO / vid
    osn = osnovne_rijeci(d)
    isp = citaj(d / "ispravke.json", {})
    rec = [r for r in recenice(osn) if r["t1"] > t0 + 0.2 and r["t0"] < t1 - 0.2 and f"{r['i0']}-{r['i1']}" not in isp]
    if not rec:
        return
    javi("AI ispravlja riječi u titlovima…", None)
    sistem = ("Ti si lektor za bosanski jezik. Ispravljaš automatski transkript predavanja hafiza Ammara Bašića "
              "(islamske teme) tako da može ići u titlove.")
    poruka = """Ispravi greške automatskog prepoznavanja govora u ovim rečenicama. Pravila:
- Ispravi pogrešno prepoznate, nepotpune ili spojene riječi u onu koju je govornik najvjerovatnije rekao (iz konteksta).
- Ispravi pravopis (bosanski standard, ijekavica), velika slova i interpunkciju.
- Vjerski izrazi i imena pišu se ispravno: Allah, dželle šanuhu, Poslanik, sallallahu alejhi ve sellem, Kur'an, hadis, ajet, ashab, ensarija, Medina, džamija, namaz, dova, sunnet, dunjaluk, ahiret. Ime ashaba piši tačno (npr. Ebu Umame).
- Obraćanje je u vokativu: „braćo i sestre“, „Allahov Poslaniče“, „o, Ebu Umame“.
- Ne dodaji riječi ni izraze kojih nema u transkriptu (npr. ne dopisuj „dželle šanuhu“ ili salavat ako ih nema). Ako je riječ nerazumljiva, ostavi je kakva jeste.
- Ne prepričavaj, ne skraćuj, ne dodaji nove misli i ne mijenjaj redoslijed. Zadrži govornikove riječi i stil; mijenjaj samo ono što je pogrešno.
- Vrati SVAKU rečenicu, s istim brojem i ispravljenim tekstom.

Vrati JSON {"recenice": [{"i": 0, "tekst": ""}]}.

REČENICE:
""" + "\n".join(f"[{k}] {r['tekst']}" for k, r in enumerate(rec))
    try:
        odg = llm(sistem, poruka, SHEMA_ISPRAVKE).get("recenice", [])
    except (RuntimeError, ValueError) as e:            # bez ispravke je i dalje upotrebljivo
        javi(f"AI ispravka nije uspjela: {e}", None)
        return
    for x in odg:
        try:
            r, tekst = rec[int(x["i"])], str(x["tekst"]).strip()
        except (KeyError, TypeError, ValueError, IndexError):
            continue
        stari = len(r["tekst"].split())
        if tekst and 0.6 * stari <= len(tekst.split()) <= 1.5 * stari + 2:   # odbij prepričavanje
            isp[f"{r['i0']}-{r['i1']}"] = tekst
    pisi(d / "ispravke.json", isp)


SHEMA_REZOVI = {"type": "object", "required": ["zadrzi", "razlog"], "properties": {
    "zadrzi": {"type": "array", "items": {"type": "integer"}}, "razlog": {"type": "string"}}}


def rezovi_ai(vid, x):
    dij, razlog = _rezovi_ai(vid, x)
    if sum(b - a for a, b in dij) > 80:                  # i dalje predugo → traži odlučnije skraćivanje
        dij2, razlog2 = _rezovi_ai(vid, x, strogo=True)
        if sum(b - a for a, b in dij2) < sum(b - a for a, b in dij):
            return dij2, razlog2
    return dij, razlog


def _rezovi_ai(vid, x, strogo=False):
    """AI montaža: koje rečenice isječka ostaju, da reel bude kraći i tečniji, a ostane jedna cjelina.
    Vraća (dijelovi, razlog); bez rezova je [[od, do]]."""
    cijeli = [[x["od"], x["do"]]]
    rijeci = ucitaj_rijeci(RADNO / vid)
    rec = [r for r in recenice(rijeci) if r["t1"] > x["od"] + 0.2 and r["t0"] < x["do"] - 0.2]
    if len(rec) < 3:
        return cijeli, ""
    sistem = "Ti si iskusan montažer kratkih videa (Instagram reels) za hafiza Ammara Bašića. Pišeš bosanski."
    poruka = f"""Ovo su rečenice jednog isječka za reels, redom, s trajanjem. Poenta isječka: „{x.get('poenta', '')}“.

Napravi montažu: odluči koje rečenice ostaju, tako da reels bude kraći, tečniji i jasniji, a da i dalje bude JEDNA smislena cjelina s tom poentom.
- Izbaci digresije koje ne vode poenti, ponavljanja iste misli, nedovršene rečenice, poštapalice i obraćanja koja ne nose sadržaj (npr. samo „znate“ ili „gledajte, braćo i sestre“).
- Zadrži rečenicu koja uvodi misao, sve što treba da se priča ili argument razumije, i završnu rečenicu s poentom. Reels ne smije završiti pitanjem ili najavom bez odgovora.
- Spoj mora zvučati prirodno: ne izbacuj rečenicu ako bez nje sljedeća gubi smisao (npr. počinje s „i onda on“, „zato“, „to“ koje upućuje na izbačeno).
- Isječak sada traje {x["do"] - x["od"]:.0f} s. Ako traje duže od 75 s, skrati ga na 45–75 s. Ako je kraći i već čist i tečan, zadrži sve rečenice.{chr(10) + "- OBAVEZNO: isječak je predug za reels. Izbaci rečenice tako da ostane najviše 70 s, a da priča i poenta ostanu cijele." if strogo else ""}

Vrati JSON {{"zadrzi": [brojevi rečenica koje ostaju], "razlog": "jedna rečenica: šta je izbačeno i zašto, opisano riječima, bez brojeva rečenica"}}.

REČENICE:
""" + "\n".join(f"[{k}] ({r['t1'] - r['t0']:.0f} s) {r['tekst']}" for k, r in enumerate(rec))
    try:
        odg = llm(sistem, poruka, SHEMA_REZOVI)
        zad = sorted({int(i) for i in odg.get("zadrzi", []) if 0 <= int(i) < len(rec)})
    except (RuntimeError, ValueError, TypeError):
        return cijeli, ""
    ukupno = x["do"] - x["od"]
    if not zad or sum(rec[i]["t1"] - rec[i]["t0"] for i in zad) < max(25, 0.35 * ukupno):
        return cijeli, ""                                   # previše izbačeno → ne vjeruj, ostavi cijelo
    nizovi = []
    for i in zad:
        if nizovi and i == nizovi[-1][1] + 1:
            nizovi[-1][1] = i
        else:
            nizovi.append([i, i])
    if nizovi == [[0, len(rec) - 1]]:
        return cijeli, ""
    dij = []
    for a, b in nizovi:
        t0, t1 = granice(rijeci, rec[a]["i0"], rec[b]["i1"])
        dij.append([max(t0, x["od"]) if a == 0 else t0, min(t1, x["do"]) if b == len(rec) - 1 else t1])
    return dij, str(odg.get("razlog", "")).strip()


SHEMA_NASLOVI = {"type": "object", "required": ["tema", "naslovi"], "properties": {
    "tema": {"type": "string"}, "naslovi": {"type": "array", "items": {"type": "string"}}}}


def lektorisi_naslove(proj, isjecci):
    """Naslovi i tema idu krupno na video — još jedna lektura (pravopis, gramatika, prave riječi)."""
    if not isjecci:
        return
    poruka = ("Ovo su tema i naslovi Instagram reelsa iz predavanja hafiza Ammara Bašića. Ispravi pravopis, gramatiku i "
              "riječi koje ne postoje ili su krivo napisane (bosanski standard, ijekavica). Smisao i dužina ostaju isti, "
              "naslov do 6 riječi, bez navodnika i bez tačke na kraju. Ako je sve ispravno, vrati isto.\n\n"
              f"tema: {proj.get('tema', '')}\n" + "\n".join(f"naslov {k}: {x['naslov']}" for k, x in enumerate(isjecci)) +
              '\n\nVrati JSON {"tema": "", "naslovi": ["", ...]} s istim brojem naslova, istim redom.')
    try:
        odg = llm("Ti si lektor za bosanski jezik.", poruka, SHEMA_NASLOVI)
    except (RuntimeError, ValueError):
        return
    nov = [str(n).strip(" \"'„“”.") for n in odg.get("naslovi", [])]
    if len(nov) == len(isjecci):
        for x, n in zip(isjecci, nov):
            if n and len(n.split()) <= 8:
                x["naslov"] = n
    if odg.get("tema") and not proj.get("tema_rucno"):
        proj["tema"] = str(odg["tema"]).strip(" \"'„“”.")


def granice(rijeci, i0, i1):
    """Vremena reza s malo zraka, ali bez ulaska u susjednu riječ."""
    a = rijeci[i0]["t0"] - 0.2
    if i0 > 0:
        a = max(a, rijeci[i0 - 1]["t1"] + 0.02)
    b = rijeci[i1]["t1"] + 0.45
    if i1 + 1 < len(rijeci):
        b = min(b, rijeci[i1 + 1]["t0"] - 0.03)
    return round(max(0, a), 2), round(b, 2)


def pozicija_lica(vid, t0, t1, uzoraka=6):
    """Gdje je hafizovo lice u isječku (sredina, 0 = lijevo, 1 = desno) — oko njega ide izrez.
    Appleov Vision (lokalno); ako ga nema ili lica nema, sredina."""
    try:
        import Vision
        from Foundation import NSURL
    except ImportError:
        return 0.5
    d = RADNO / vid
    xs = []
    for k in range(uzoraka):
        t = t0 + (t1 - t0) * (k + 0.5) / uzoraka
        jpg = d / f"_lice{k}.jpg"
        try:
            ffmpeg("-ss", f"{t:.2f}", "-i", d / "izvor.mp4", "-frames:v", "1", "-vf", "scale=640:-2", jpg)
            req = Vision.VNDetectFaceRectanglesRequest.alloc().init()
            Vision.VNImageRequestHandler.alloc().initWithURL_options_(NSURL.fileURLWithPath_(str(jpg)), None) \
                .performRequests_error_([req], None)
            lica = sorted(req.results() or [], key=lambda o: -o.boundingBox().size.width)
            if lica:
                b = lica[0].boundingBox()
                xs.append(b.origin.x + b.size.width / 2)
        except RuntimeError:
            pass
        finally:
            jpg.unlink(missing_ok=True)
    if not xs:
        return 0.5
    return round(sorted(xs)[len(xs) // 2], 3)


def sredi(sirovo, rec, rijeci):
    """Popravi ono što model zabrlja: opseg, trajanje, preklapanja."""
    n = len(rec)
    out = []
    for x in sirovo:
        try:
            a, b = sorted((max(0, min(n - 1, int(x["od"]))), max(0, min(n - 1, int(x["do"])))))
        except (KeyError, TypeError, ValueError):
            continue
        while rec[b]["t1"] - rec[a]["t0"] < MIN_S and b + 1 < n:      # prekratko → dodaj rečenice
            b += 1
        while rec[b]["t1"] - rec[a]["t0"] > MAX_S + 15 and b > a:     # predugo → skrati s kraja
            b -= 1
        while rec[b]["tekst"].rstrip().endswith("?") and b + 1 < n and rec[b + 1]["t1"] - rec[a]["t0"] < MAX_S + 45:
            b += 1                                                     # ne završavaj pitanjem: dodaj odgovor (AI montaža skrati)
        out.append((a, b, x))
    out.sort(key=lambda z: z[0])
    final, kraj = [], -1
    for a, b, x in out:
        if a <= kraj:                                                  # preklapanje
            a = kraj + 1
            if a > b or rec[b]["t1"] - rec[a]["t0"] < 20:
                continue
        kraj = b
        t0, t1 = granice(rijeci, rec[a]["i0"], rec[b]["i1"])
        final.append({"od": t0, "do": t1, "naslov": str(x.get("naslov", "")).strip(" \"'„“”"),
                      "tip": str(x.get("tip", "")).strip().lower(), "poenta": str(x.get("poenta", "")).strip(),
                      "zasto": str(x.get("zasto", "")).strip(), "ukljuci": True, "kadar": "traka", "pozicija": 0.5})
    return final


# ───────────────────────────── 4. titlovi ─────────────────────────────

NE_LOMI_ISPRED = {"alejhi", "ve sellem", "alejhis-selam", "šanuhu", "teala"}


def zbij(dijelovi, rijeci, max_pauza=0.6, ostavi=0.2):
    """Duge pauze unutar dijelova se izrežu (ostane kratak predah). → [(t0, t1, k)], k = redni broj dijela."""
    out = []
    for k, (a, b) in enumerate(dijelovi):
        ws = [w for w in rijeci if w["t0"] >= a - 0.05 and w["t0"] < b - 0.05]
        start = a
        for w, n in zip(ws, ws[1:]):
            if n["t0"] - w["t1"] > max_pauza:
                out.append((start, w["t1"] + ostavi / 2, k))
                start = n["t0"] - ostavi / 2
        out.append((start, b, k))
    return [(round(a, 3), round(b, 3), k) for a, b, k in out if b - a > 0.15]


def dijelovi_isjecka(isj, rijeci):
    """Stvarni komadi videa koji ulaze u reel, redom."""
    dij = isj.get("dijelovi") or [[isj["od"], isj["do"]]]
    if isj.get("zbij_pauze", True):
        return zbij(dij, rijeci)
    return [(float(a), float(b), k) for k, (a, b) in enumerate(dij)]


def titlovi(rijeci, komadi):
    """Riječi iz komada → kratki titlovi (do ~5 riječi); vremena su na spojenom videu."""
    ws, pomak = [], 0.0
    for j, (a, b, _) in enumerate(komadi):
        prvi = True
        for w in rijeci:
            if a - 0.05 <= w["t0"] < b - 0.05:
                ws.append({"w": w["w"], "t0": max(0, w["t0"] - a) + pomak, "t1": min(b, w["t1"]) - a + pomak,
                           "rez": prvi and j > 0})
                prvi = False
        pomak += b - a
    grupe, cur = [], []
    for k, w in enumerate(ws):
        cur.append(w)
        nxt = ws[k + 1] if k + 1 < len(ws) else None
        if nxt is None or nxt["rez"] or nxt["t0"] - w["t1"] > 0.6:
            grupe.append(cur)
            cur = []
            continue
        tekst = " ".join(x["w"] for x in cur)
        kraj = w["w"][-1:]
        sa_sljedecom = len(tekst) + 1 + len(nxt["w"])
        if nxt["w"].lower().rstrip(".,?!;:") in NE_LOMI_ISPRED:             # salavat ostaje zajedno
            continue
        if kraj in ".?!…":
            lomi = len(tekst) >= 8
        elif kraj in ",;:":
            lomi = len(tekst) >= 12
        else:                                                            # ne ostavljaj jednu riječ samu
            lomi = len(tekst) >= 22 and not (nxt["w"][-1:] in ".,?!;:…" and sa_sljedecom <= 34)
        if lomi or len(cur) >= 6 or w["t1"] - cur[0]["t0"] > 3.0:
            grupe.append(cur)
            cur = []
    return [{"t0": round(g[0]["t0"], 2), "t1": round(min(pomak, g[-1]["t1"]), 2), "tekst": " ".join(x["w"] for x in g),
             "rijeci": [[round(x["t0"], 2), round(x["t1"], 2)] for x in g]} for g in grupe]


# ───────────────────────────── 5. izrada reelsa ─────────────────────────────

_F = {}


def font(ime, vel, tezina):
    k = (ime, vel, tezina)
    if k not in _F:
        f = ImageFont.truetype(str(FONTOVI / ime), vel)
        f.set_variation_by_axes([tezina] if "Garamond" in ime else [tezina, 100])
        _F[k] = f
    return _F[k]


def _sjena(img, crtaj, radius=10, alfa=150, pomak=(0, 5)):
    """Mekana sjena ispod teksta: crtaj(draw, boja) nacrta tekst."""
    sloj = Image.new("RGBA", img.size, (0, 0, 0, 0))
    crtaj(ImageDraw.Draw(sloj), (0, 0, 0, alfa))
    bb = sloj.getbbox()
    if not bb:
        return
    p = radius * 3                                   # zamuti samo dio s tekstom (brže)
    box = (max(0, bb[0] - p), max(0, bb[1] - p), min(W, bb[2] + p), min(H - pomak[1], bb[3] + p))
    img.alpha_composite(sloj.crop(box).filter(ImageFilter.GaussianBlur(radius)), (box[0] + pomak[0], box[1] + pomak[1]))


def _prelomi(rijeci, f, max_w):
    razmak, linije, sir = f.getlength(" "), [[]], 0
    for i, w in enumerate(rijeci):
        lw = f.getlength(w)
        if linije[-1] and sir + razmak + lw > max_w:
            linije.append([])
            sir = 0
        sir += (razmak if linije[-1] else 0) + lw
        linije[-1].append((i, w, lw))
    return linije, razmak


VIDEO_H = 1500                   # „traka“: video gore (1080×1500); donji dio se pretopi u zelenu
FADE = (1110, 1475)              # gdje video prelazi u zelenu: od potpuno prozirne do pune zelene
DNO = H - 94                     # red s linkovima; brend se slaže od dna prema gore
PRELAZ, PRELAZ_PAUZA, PRELAZ_ZVUK = 0.22, 0.14, 0.08   # meki prelaz na rezu (video) i kratko pretapanje zvuka
ZELENA = (11, 23, 17)            # --bg iz aplikacije (zelena tema)
BREND_LOGO = KORIJEN.parent.parent / "public/assets/brand/ammar_basic_logo_w_1.png"
INSTAGRAM = os.environ.get("REELS_INSTAGRAM", "basic_ammar")
FACEBOOK = os.environ.get("REELS_FACEBOOK", "ammarbasic")
WEB = os.environ.get("REELS_WEB", "ammarbasic.ba")
RASPORED = {"traka": {"titl": 1040}, "izrez": {"titl": 1040}, "okvir": {"titl": 1012}}  # sredina titlova
OKVIR_Y = 300                    # „okvir“: gdje stoji cijeli kadar na zamućenoj pozadini


def tema_iz_naslova(n):
    """„Rješenje za tugu… - mr. hfz. Ammar Bašić“ → „Rješenje za tugu…“"""
    dij = [p.strip(" \"'„“”") for p in re.split(r"\s+[-–|]\s+|\s*\|\s*", n or "") if p.strip()]
    dobri = [p for p in dij if not re.search(r"ammar|ba[šs]i[ćc]|hfz|hafiz|džemat|dzemat|\d{1,2}\.\d{1,2}\.", p, re.I)]
    return (dobri or dij or [""])[0]


def _razmaknuto(d, tekst, y, boja, max_w=900):
    for vel, raz in ((28, 7), (26, 5), (24, 4), (22, 3)):
        f = font("IBMPlexSans.ttf", vel, 600)
        sir = sum(f.getlength(c) for c in tekst) + raz * (len(tekst) - 1)
        if sir <= max_w:
            break
    while sir > max_w and " " in tekst:                     # i dalje predugo → skrati
        tekst = tekst.rsplit(" ", 1)[0].rstrip(",;:") + "…"
        sir = sum(f.getlength(c) for c in tekst) + raz * (len(tekst) - 1)
    x = (W - sir) / 2
    for c in tekst:
        d.text((x, y), c, font=f, fill=boja)
        x += f.getlength(c) + raz


def _znak(d, vrsta, x, y, s, boja):
    """Mali znakovi uz linkove: Instagram, Facebook, web."""
    w = max(3, s // 11)
    if vrsta == "ig":
        d.rounded_rectangle([x, y, x + s, y + s], radius=s * 0.28, outline=boja, width=w)
        r, cx, cy = s * 0.23, x + s / 2, y + s / 2
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=boja, width=w)
        t = s * 0.065
        d.ellipse([x + s * 0.75 - t, y + s * 0.25 - t, x + s * 0.75 + t, y + s * 0.25 + t], fill=boja)
    elif vrsta == "fb":
        d.rounded_rectangle([x, y, x + s, y + s], radius=s * 0.22, outline=boja, width=w)
        d.text((x + s * 0.56, y + s * 1.02), "f", font=font("IBMPlexSans.ttf", int(s * 0.95), 700), fill=boja, anchor="ms")
    else:
        d.ellipse([x, y, x + s, y + s], outline=boja, width=w)
        d.ellipse([x + s * 0.3, y, x + s * 0.7, y + s], outline=boja, width=w)
        d.line([(x + w, y + s / 2), (x + s - w, y + s / 2)], fill=boja, width=w)


_LOGO = {}


def _blok_dole(img, tema, naslov, sjena):
    """Pri dnu, odozdo prema gore: linkovi, logo „Ammar Bašić“, naslov, tema."""
    d = ImageDraw.Draw(img)
    y = DNO
    f, s, raz = font("IBMPlexSans.ttf", 26, 500), 27, 40
    linkovi = [(v, t) for v, t in (("ig", f"@{INSTAGRAM}"), ("fb", FACEBOOK), ("web", WEB)) if t.strip("@")]
    sir = sum(s + 11 + f.getlength(t) for _, t in linkovi) + raz * (len(linkovi) - 1)
    x = (W - sir) / 2
    for v, t in linkovi:
        _znak(d, v, x, y + 3, s, GOLD + (235,))
        d.text((x + s + 11, y), t, font=f, fill=GOLD + (235,))
        x += s + 11 + f.getlength(t) + raz
    if BREND_LOGO.exists():
        if "l" not in _LOGO:
            l = Image.open(BREND_LOGO).convert("RGBA")
            _LOGO["l"] = l.resize((330, round(330 * l.height / l.width)), Image.Resampling.LANCZOS)
        logo = _LOGO["l"]
        y -= 32 + logo.height
        img.alpha_composite(logo, ((W - logo.width) // 2, int(y)))
    if naslov:                       # jedna linija do 72 px, dvije ujednačene do 62 px
        rw = naslov.split()
        tekstovi = []
        for vel in (72, 66):
            fn = font("EBGaramond-Italic.ttf", vel, 500)
            if fn.getlength(naslov) <= 940:
                tekstovi = [naslov]
                break
        else:
            for vel in (62, 56, 50):
                fn = font("EBGaramond-Italic.ttf", vel, 500)
                prelomi = [(" ".join(rw[:k]), " ".join(rw[k:])) for k in range(1, len(rw))]
                dobri = [p for p in prelomi if max(map(fn.getlength, p)) <= 940]
                if dobri:
                    tekstovi = list(min(dobri, key=lambda p: max(map(fn.getlength, p))))
                    break
            else:
                tekstovi = [naslov]
        lh = vel * 1.12
        y -= 40 + len(tekstovi) * lh
        y0 = y

        def crtaj(dr, boja):
            for k, t in enumerate(tekstovi):
                dr.text((W / 2, y0 + k * lh), t, font=fn, fill=boja, anchor="ma")
        if sjena:
            _sjena(img, crtaj, 12, 170)
        crtaj(d, (255, 255, 255, 255))
    if tema:
        y -= 26 + 28
        _razmaknuto(d, tema.upper(), y, GOLD + (255,))


def osnova(naslov, kadar, tema=""):
    """Sloj koji stoji cijelo vrijeme: donji dio videa se pretopi u zelenu, a na njoj tema, naslov i brend."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od, do = FADE                    # video se mekano pretopi u zelenu (smoothstep, s malo šuma protiv „stepenica“)
    t = np.clip((np.arange(H, dtype=np.float32) - od) / (do - od), 0, 1)
    maks = 255 if kadar == "traka" else 240
    alfa = np.repeat((maks * t * t * (3 - 2 * t))[:, None], W, 1)
    alfa = np.clip(alfa + np.random.default_rng(7).uniform(-1.2, 1.2, alfa.shape) * (alfa > 0) * (alfa < maks), 0, 255)
    sloj = Image.new("RGBA", (W, H), ZELENA + (255,))
    sloj.putalpha(Image.fromarray(alfa.astype(np.uint8), "L"))
    img.alpha_composite(sloj)
    _blok_dole(img, tema, naslov, sjena=kadar != "traka")
    return img


def kadar_titla(baza, rijeci, aktivna, kadar):
    """Osnova + titl; aktivna riječ zlatna (-1 = bez isticanja)."""
    img = baza.copy()
    f = font("IBMPlexSans.ttf", 68, 700)
    prikaz = list(rijeci)
    if prikaz and prikaz[-1][-1:] in ",.;:":
        prikaz[-1] = prikaz[-1][:-1]
    linije, razmak = _prelomi(prikaz, f, 880)
    lh = 68 * 1.2
    y0 = RASPORED[kadar]["titl"] - lh * len(linije) / 2
    poz = []
    for k, l in enumerate(linije):
        sir = sum(lw for _, _, lw in l) + razmak * (len(l) - 1)
        x = (W - sir) / 2
        for i, w, lw in l:
            poz.append((x, y0 + k * lh, i, w))
            x += lw + razmak

    def crtaj(dr, boja):
        for x, y, _, w in poz:
            dr.text((x, y), w, font=f, fill=boja, stroke_width=6, stroke_fill=boja)
    _sjena(img, crtaj, 9, 120, (0, 6))
    d = ImageDraw.Draw(img)
    for x, y, i, w in poz:
        boja = GOLD_L + (255,) if i == aktivna else (255, 255, 255, 255)
        d.text((x, y), w, font=f, fill=boja, stroke_width=4, stroke_fill=(5, 12, 8, 255))
    return img


def napravi_reel(vid, isj, br, javi=print):
    """Jedan isječak (može imati više dijelova) → radno/<id>/reels/NN-naslov.mp4"""
    d = RADNO / vid
    proj = citaj(d / "projekat.json")
    kadar = isj.get("kadar") if isj.get("kadar") in RASPORED else "traka"
    if not isj.get("titlovi"):
        ispravi_raspon(vid, float(isj["od"]), float(isj["do"]), javi)
    rijeci = ucitaj_rijeci(d)
    komadi = dijelovi_isjecka(isj, rijeci)
    dur = round(sum(b - a for a, b, _ in komadi), 3)
    tit = isj.get("titlovi") or titlovi(rijeci, komadi)
    tmp = d / f"_kadrovi_{br}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    baza = osnova(isj.get("naslov", ""), kadar, proj.get("tema") or tema_iz_naslova(proj.get("naslov")))
    baza.save(tmp / "baza.png", compress_level=1)
    dogadjaji = [(0.0, "baza.png")]
    if isj.get("titlovi_ukljuceni", True):
        for gi, g in enumerate(tit):
            nxt = tit[gi + 1]["t0"] if gi + 1 < len(tit) else dur
            kraj = nxt if nxt - g["t1"] < 0.8 else g["t1"] + 0.4
            rw = g["tekst"].split()
            vremena = g.get("rijeci") or []
            if len(vremena) == len(rw):       # riječ po riječ
                for k in range(len(rw)):
                    od = g["t0"] if k == 0 else vremena[k][0]
                    ime = f"t{gi:03d}_{k:02d}.png"
                    kadar_titla(baza, rw, k, kadar).save(tmp / ime, compress_level=1)
                    dogadjaji.append((od, ime))
            else:                              # ručno izmijenjen tekst → cijeli titl odjednom
                ime = f"t{gi:03d}.png"
                kadar_titla(baza, rw, -1, kadar).save(tmp / ime, compress_level=1)
                dogadjaji.append((g["t0"], ime))
            dogadjaji.append((min(kraj, dur), "baza.png"))
            javi(f"Reel {br}: titlovi {gi + 1}/{len(tit)}", None)
    dogadjaji.sort(key=lambda e: e[0])
    lista = ["ffconcat version 1.0"]
    for k, (od, ime) in enumerate(dogadjaji):
        do = dogadjaji[k + 1][0] if k + 1 < len(dogadjaji) else dur
        if do - od >= 0.01 or k == len(dogadjaji) - 1:
            lista += [f"file '{ime}'", f"duration {max(do - od, 0.04):.3f}"]
    lista.append(f"file '{dogadjaji[-1][1]}'")
    (tmp / "lista.ffconcat").write_text("\n".join(lista) + "\n")

    sw, sh = proj["sirina"], proj["visina"]
    poz = min(1, max(0, float(isj.get("pozicija", 0.5))))

    def slika(i, k):
        """Kadar jednog komada; svaki drugi dio je tek malo bliži, pa se rez s pretapanjem doživi kao pomak kamere."""
        if kadar == "okvir":
            return (f"split=2[p{i}a][p{i}b];[p{i}a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
                    f"scale=216:384,boxblur=6:2,scale=1080:1920,eq=brightness=-0.18:saturation=0.75[p{i}bg];"
                    f"[p{i}b]scale=1080:-2:flags=lanczos[p{i}fg];[p{i}bg][p{i}fg]overlay=0:{OKVIR_Y}")
        vis = VIDEO_H if kadar == "traka" else H
        zum = 1.05 if k % 2 else 1.0
        cw = int(min(sw, sh * W / vis) / zum) // 2 * 2
        ch = int(sh / zum) // 2 * 2
        x = int(min(sw - cw, max(0, poz * sw - cw / 2))) // 2 * 2
        y = int((sh - ch) * 0.35) // 2 * 2
        f = f"crop={cw}:{ch}:{x}:{y},scale={W}:{vis}:flags=lanczos"
        return f + (f",pad={W}:{H}:0:0:color=0x0B1711" if kadar == "traka" else "")

    pocetak = max(0.0, komadi[0][0] - 1)
    n = len(komadi)
    graf = (f"[0:v]split={n}" + "".join(f"[vs{i}]" for i in range(n)) +
            f";[0:a]asplit={n}" + "".join(f"[as{i}]" for i in range(n)) + ";")
    # Na rezu se slika pretopi (sadržajni rez duže, zbijena pauza kraće), a zvuk kratko pretopi.
    # Komad prije reza se produži za trajanje prelaza, pa svaki dio počinje tačno kad i prije (titlovi ostaju sinhroni).
    prelaz = [PRELAZ if komadi[i + 1][2] != komadi[i][2] else PRELAZ_PAUZA for i in range(n - 1)]
    for i, (a, b, k) in enumerate(komadi):
        ev = prelaz[i] + 0.1 if i < n - 1 else 0
        ea = PRELAZ_ZVUK if i < n - 1 else 0
        graf += (f"[vs{i}]trim=start={a - pocetak:.3f}:end={b - pocetak + ev:.3f},setpts=PTS-STARTPTS,{slika(i, k)},"
                 f"setsar=1,fps=30,format=yuv420p[v{i}];"
                 f"[as{i}]atrim=start={a - pocetak:.3f}:end={b - pocetak + ea:.3f},asetpts=PTS-STARTPTS[a{i}];")
    pv, pa, off = "v0", "a0", 0.0
    for i in range(1, n):
        off += komadi[i - 1][1] - komadi[i - 1][0]
        graf += (f"[{pv}][v{i}]xfade=transition=fade:duration={prelaz[i - 1]:.3f}:offset={off:.3f}[x{i}];"
                 f"[{pa}][a{i}]acrossfade=d={PRELAZ_ZVUK}:c1=qsin:c2=qsin[y{i}];")
        pv, pa = f"x{i}", f"y{i}"
    graf += (f"[{pv}]fade=t=out:st={max(0, dur - 0.5):.3f}:d=0.5:color=0x0B1711,setsar=1[osn];"
             "[1:v]format=rgba[tit];"
             "[osn][tit]overlay=0:0:eof_action=repeat:format=auto,format=yuv420p[v];"
             f"[{pa}]loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.08,"
             f"afade=t=out:st={max(0, dur - 0.35):.2f}:d=0.35,aresample=48000[a]")
    izlaz = d / "reels"
    izlaz.mkdir(exist_ok=True)
    ime = f"{br:02d}-{slug(isj.get('naslov', ''))}.mp4"
    javi(f"Reel {br}: kodiram video…", None)
    ffmpeg("-ss", f"{pocetak:.3f}", "-t", f"{komadi[-1][1] - pocetak + 0.5:.3f}", "-i", d / "izvor.mp4",
           "-f", "concat", "-safe", "0", "-i", tmp / "lista.ffconcat",
           "-filter_complex", graf, "-map", "[v]", "-map", "[a]", "-t", f"{dur:.3f}",
           "-c:v", "libx264", "-preset", "medium", *KODIRANJE, "-profile:v", "high", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", izlaz / ime)
    shutil.rmtree(tmp, ignore_errors=True)
    return ime


def napravi_sve(vid, isjecci, javi=print):
    d = RADNO / vid
    gotovi = []
    ukljuceni = [(br, x) for br, x in enumerate(isjecci, 1) if x.get("ukljuci", True)]
    for k, (br, isj) in enumerate(ukljuceni, 1):
        javi(f"Pravim reel {k}/{len(ukljuceni)}…", 100 * (k - 1) / len(ukljuceni))
        for star in (d / "reels").glob(f"{br:02d}-*.mp4"):      # stara verzija istog isječka
            star.unlink()
        gotovi.append(napravi_reel(vid, isj, br, javi))
    proj = citaj(d / "projekat.json")
    proj["napravljeno"] = gotovi
    pisi(d / "projekat.json", proj)
    return gotovi


# ───────────────────────────── server za ekran ─────────────────────────────

POSAO = {"radi": False, "faza": "", "procenat": None, "greska": None, "id": None, "pocetak": None}
_brava = threading.Lock()


def javi(poruka, procenat=None):
    POSAO.update(faza=poruka, procenat=procenat)


class budan:
    """Mac ne zaspi dok obrada traje (caffeinate -i), pa posao ne stoji satima."""
    def __enter__(self):
        self.p = subprocess.Popen(["caffeinate", "-i"]) if shutil.which("caffeinate") else None

    def __exit__(self, *a):
        if self.p:
            self.p.terminate()


def pokreni_posao(fn, vid=None):
    with _brava:
        if POSAO["radi"]:
            return False
        POSAO.update(radi=True, faza="Počinjem…", procenat=None, greska=None, id=vid, pocetak=time.time())

    def tok():
        try:
            with budan():
                fn()
            POSAO.update(faza="Gotovo", procenat=100)
        except Exception as e:  # noqa: BLE001 — poruka ide na ekran
            POSAO.update(greska=str(e))
        finally:
            POSAO["radi"] = False
    threading.Thread(target=tok, daemon=True).start()
    return True


def obradi_link(url):
    vid = preuzmi(url, javi)
    POSAO["id"] = vid
    transkribuj(vid, javi)
    if not citaj(RADNO / vid / "projekat.json")["isjecci"]:
        predlozi(vid, javi=javi)


class Ekran(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def json(self, data, kod=200):
        b = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(kod)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def tijelo(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def fajl(self, p):
        vel = p.stat().st_size
        a, b = 0, vel - 1
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if m and (m[1] or m[2]):
            if m[1]:
                a, b = int(m[1]), min(int(m[2]) if m[2] else vel - 1, vel - 1)
            else:
                a = max(0, vel - int(m[2]))
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {a}-{b}/{vel}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(p.name)[0] or "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(b - a + 1))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            with open(p, "rb") as fh:
                fh.seek(a)
                ostalo = b - a + 1
                while ostalo > 0:
                    blok = fh.read(min(1 << 20, ostalo))
                    if not blok:
                        break
                    self.wfile.write(blok)
                    ostalo -= len(blok)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        put, _, upit = self.path.partition("?")
        q = dict(x.split("=", 1) for x in upit.split("&") if "=" in x)
        if put in ("/", "/index.html"):
            return self.fajl(KORIJEN / "ekran.html")
        if put.startswith("/fontovi/") and (FONTOVI / Path(put).name).is_file():
            return self.fajl(FONTOVI / Path(put).name)
        if put.startswith("/radno/"):
            p = (RADNO / urllib.request.unquote(put[7:])).resolve()
            if p.is_file() and p.is_relative_to(RADNO.resolve()):
                return self.fajl(p)
            return self.json({"greska": "nema"}, 404)
        if put == "/api/stanje":
            return self.json({**POSAO, "traje": round(time.time() - POSAO["pocetak"]) if POSAO["pocetak"] else 0})
        if put == "/api/projekti":
            lista = [citaj(p) for p in sorted(RADNO.glob("*/projekat.json"), key=os.path.getmtime, reverse=True)]
            return self.json([{"id": p["id"], "naslov": p["naslov"]} for p in lista if p])
        if put == "/api/projekat":
            d = RADNO / re.sub(r"[^\w-]", "", q.get("id", ""))
            proj, rijeci = citaj(d / "projekat.json"), ucitaj_rijeci(d)
            if not proj:
                return self.json({"greska": "Nema projekta"}, 404)
            proj.setdefault("tema", tema_iz_naslova(proj.get("naslov")))
            proj["recenice"] = [{"t0": r["t0"], "t1": r["t1"], "tekst": r["tekst"]} for r in recenice(rijeci)] if rijeci else []
            proj["gotovi"] = sorted(p.name for p in (d / "reels").glob("*.mp4")) if (d / "reels").exists() else []
            return self.json(proj)
        self.json({"greska": "nema"}, 404)

    def do_POST(self):
        t = self.tijelo()
        vid = re.sub(r"[^\w-]", "", t.get("id", ""))
        d = RADNO / vid
        if self.path == "/api/obradi":
            try:
                video_id(t.get("url", ""))
            except ValueError as e:
                return self.json({"greska": str(e)}, 400)
            ok = pokreni_posao(lambda: obradi_link(t["url"]), video_id(t["url"]))
            return self.json({"ok": ok, "id": video_id(t["url"])}, 200 if ok else 409)
        if self.path == "/api/predlozi":
            ok = pokreni_posao(lambda: predlozi(vid, javi=javi), vid)
            return self.json({"ok": ok}, 200 if ok else 409)
        if self.path == "/api/titlovi":
            ispravi_raspon(vid, float(t["od"]), float(t["do"]), lambda *a: None)
            rijeci = ucitaj_rijeci(d)
            return self.json(titlovi(rijeci, dijelovi_isjecka(t, rijeci)))
        if self.path in ("/api/sacuvaj", "/api/napravi"):
            stara = citaj(d / "projekat.json") or {}
            if t.get("verzija") != stara.get("verzija"):
                return self.json({"greska": "AI je u međuvremenu napravio novi izbor. Osvježi stranicu."}, 409)
        if self.path == "/api/sacuvaj":
            proj = citaj(d / "projekat.json")
            proj["isjecci"] = t["isjecci"]
            if "tema" in t:
                proj["tema"], proj["tema_rucno"] = t["tema"], bool(t.get("tema_rucno"))
            pisi(d / "projekat.json", proj)
            return self.json({"ok": True})
        if self.path == "/api/napravi":
            proj = citaj(d / "projekat.json")
            proj["isjecci"] = t["isjecci"]
            if "tema" in t:
                proj["tema"] = t["tema"]
            pisi(d / "projekat.json", proj)
            ok = pokreni_posao(lambda: napravi_sve(vid, t["isjecci"], javi), vid)
            return self.json({"ok": ok}, 200 if ok else 409)
        if self.path == "/api/otvori":
            subprocess.run(["open", str(d / "reels" if (d / "reels").exists() else d)])
            return self.json({"ok": True})
        self.json({"greska": "nema"}, 404)


def ekran():
    RADNO.mkdir(parents=True, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Ekran)
    url = f"http://localhost:{PORT}"
    print(f"Reels ekran: {url}  (zaustavi s Ctrl+C)")
    if sys.stdout.isatty() and not os.environ.get("REELS_BEZ_PREGLEDNIKA"):
        threading.Timer(0.6, lambda: subprocess.run(["open", url])).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


def terminal(url, napravi, ponovo=False):
    def ispis(poruka, procenat=None):
        print(f"\r{poruka} {'' if procenat is None else f'{procenat:5.1f}%'}".ljust(70), end="", flush=True)
    with budan():
        _terminal(url, napravi, ponovo, ispis)


def _terminal(url, napravi, ponovo, ispis):
    vid = preuzmi(url, ispis)
    t = time.time()
    transkribuj(vid, ispis)
    print(f"\nTranskript: {round(time.time() - t)} s")
    isjecci = (not ponovo and citaj(RADNO / vid / "projekat.json")["isjecci"]) or predlozi(vid, javi=ispis)
    print()
    for k, x in enumerate(isjecci, 1):
        dij = x.get("dijelovi") or [[x["od"], x["do"]]]
        traje = sum(b - a for a, b in dij)
        print(f"{k}. {mmss(x['od'])}–{mmss(x['do'])} ({traje:.0f} s, dijelova: {len(dij)}) [{x['tip']}] {x['naslov']}\n   {x['poenta']}\n   Zašto: {x['zasto']}" + (f"\n   Rezovi: {x['rezovi']}" if x.get("rezovi") else ""))
    if napravi:
        t = time.time()
        for ime in napravi_sve(vid, isjecci, ispis):
            print("\n  ✓", RADNO / vid / "reels" / ime)
        print(f"Izrada: {round(time.time() - t)} s")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "_transkribuj":
        _transkribuj_ovdje(sys.argv[2])
    else:
        import numpy as np  # noqa: E402
        from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402
        if len(sys.argv) > 1:
            terminal(sys.argv[1], "--napravi" in sys.argv, "--ponovo" in sys.argv)
        else:
            ekran()
