"""Build one AZ pre-trip memory video from a spec JSON.

Usage: python3 -I make.py specs/01_InCab_Part1.json [--render]

Voices (free, local Kokoro via the HyperFrames CLI):
  narrator  hm_omega  (Hindi phonemizer, Hinglish written in Devanagari)
  SAY lines am_michael at 0.85 speed (exact English script lines)
  examiner  bf_emma
"""
import hashlib, html, json, math, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HF = os.path.expanduser("~/studio-tools/hyperframes")
VOICE = {"narr": ("hm_omega", "hi", 1.0), "say": ("am_michael", "en-us", 0.9), "examiner": ("bf_emma", "en-gb", 0.95)}
W, H = 1080, 1920
Y = "#ffd21f"  # accent

# ---------- audio ----------

def tts(text, kind, cache):
    voice, lang, speed = VOICE[kind]
    key = hashlib.sha1(f"{voice}|{lang}|{speed}|{text}".encode()).hexdigest()[:16]
    out = os.path.join(cache, key + ".wav")
    if not os.path.exists(out):
        txt = out[:-4] + ".txt"
        open(txt, "w").write(text)
        subprocess.run(["npx", "--prefix", HF, "hyperframes", "tts", txt, "-v", voice, "--lang", lang,
                        "-s", str(speed), "-o", out], check=True, capture_output=True)
    return out


def dur(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", path]).decode())

# ---------- text chunking ----------

def balanced_chunks(text, limit):
    words = text.split()
    n = max(1, math.ceil(len(text) / limit))
    while True:
        target = len(text) / n
        chunks, cur = [], []
        for w in words:
            if cur and len(" ".join(cur + [w])) > target + 6 and len(chunks) < n - 1:
                chunks.append(" ".join(cur)); cur = []
            cur.append(w)
        chunks.append(" ".join(cur))
        if all(len(c) <= limit for c in chunks) or n > 8:
            return chunks
        n += 1


def caption_chunks(text, limit=74):
    sents = [s.strip() for s in re.split(r"(?<=[.?!:])\s+", text) if s.strip()]
    out = []
    for s in sents:
        out += balanced_chunks(s, limit) if len(s) > limit else [s]
    return out


def spread(chunks, start, end):
    total = sum(len(c) + 4 for c in chunks)
    t, res = start, []
    for c in chunks:
        d = (end - start) * (len(c) + 4) / total
        res.append((c, t, t + d)); t += d
    return res

# ---------- drawings ----------

TRUCK = """
<svg id="truck" viewBox="0 0 1000 300" width="1000" height="300" style="position:absolute;left:40px;top:250px;overflow:visible">
  <defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <line x1="0" y1="262" x2="1000" y2="262" stroke="#2a3038" stroke-width="4"/>
  <rect id="p-trailer-body" x="10" y="40" width="640" height="170" rx="6" fill="#20262e" stroke="#3a434e" stroke-width="4"/>
  <rect id="p-doors" x="10" y="40" width="40" height="170" fill="#262d36" stroke="#3a434e" stroke-width="4"/>
  <rect id="p-landing" x="520" y="210" width="16" height="44" fill="#4a535e"/>
  <rect id="p-frame" x="60" y="210" width="900" height="14" fill="#3a434e"/>
  <rect id="p-fifth" x="640" y="196" width="80" height="16" rx="4" fill="#59636f"/>
  <path id="p-cab" d="M720 70 h120 l40 60 h80 q20 0 20 20 v60 h-260 z" fill="#2b333d" stroke="#4a535e" stroke-width="4"/>
  <path d="M745 82 h85 l30 46 h-115 z" fill="#14181d" stroke="#4a535e" stroke-width="3"/>
  <rect id="p-exhaust" x="700" y="20" width="14" height="180" rx="5" fill="#59636f"/>
  <rect id="p-fuel" x="770" y="214" width="110" height="36" rx="16" fill="#59636f"/>
  <g fill="#0d1014" stroke="#4a535e" stroke-width="6">
    <circle id="p-tire-t1" cx="110" cy="236" r="28"/><circle id="p-tire-t2" cx="180" cy="236" r="28"/>
    <circle id="p-tire-d1" cx="700" cy="236" r="28"/><circle id="p-tire-d2" cx="768" cy="236" r="28"/>
    <circle id="p-tire-s" cx="940" cy="236" r="28"/>
  </g>
  <text x="330" y="135" fill="#8a96a3" font-family="Montserrat" font-weight="900" font-size="34" text-anchor="middle">TRAILER</text>
  <g id="hl-truck-cab" opacity="0" filter="url(#glow)"><path d="M720 70 h120 l40 60 h80 q20 0 20 20 v60 h-260 z" fill="none" stroke="__Y__" stroke-width="8"/></g>
</svg>"""

def gauge(cx, cy, r, label, gid, vmax=150):
    ticks = "".join(
        f'<line x1="{cx + (r-8)*math.sin(math.radians(a)):.1f}" y1="{cy - (r-8)*math.cos(math.radians(a)):.1f}" '
        f'x2="{cx + (r-18)*math.sin(math.radians(a)):.1f}" y2="{cy - (r-18)*math.cos(math.radians(a)):.1f}" stroke="#7d8894" stroke-width="3"/>'
        for a in range(-120, 121, 30))
    return (f'<g><circle cx="{cx}" cy="{cy}" r="{r}" fill="#0f1317" stroke="#3a434e" stroke-width="5"/>{ticks}'
            f'<g id="n-{gid}"><line x1="{cx}" y1="{cy}" x2="{cx}" y2="{cy - r + 22}" stroke="#ff5a3c" stroke-width="5" stroke-linecap="round"/></g>'
            f'<circle cx="{cx}" cy="{cy}" r="7" fill="#c9d1d7"/>'
            + (f'<text x="{cx}" y="{cy + 52}" fill="#c9d1d7" font-family="Inter" font-weight="900" font-size="28" text-anchor="middle">{label}</text></g>' if r > 70 else
             f'<text x="{cx}" y="{cy + r + 32}" fill="#c9d1d7" font-family="Inter" font-weight="800" font-size="28" text-anchor="middle">{label.split("/")[0]}</text>'
             + (f'<text x="{cx}" y="{cy + r + 62}" fill="#c9d1d7" font-family="Inter" font-weight="800" font-size="28" text-anchor="middle">{label.split("/")[1]}</text>' if "/" in label else "") + '</g>'))


def ring(cx, cy, r, pid):
    return f'<circle id="hl-{pid}" cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="__Y__" stroke-width="8" opacity="0" filter="url(#glow2)"/>'

DASH_PARTS = {  # id: (cx, cy, r) in dash coords; screen = (40+x, 600+y)
    "wheel": (230, 330, 168), "horn-city": (230, 330, 46), "horn-hwy": (120, 48, 40),
    "dash-warn": (695, 135, 40), "dash-rpm": (560, 280, 108), "dash-speed": (820, 280, 108),
    "dash-oil": (450, 445, 62), "dash-fuel": (570, 445, 62), "dash-water": (690, 445, 62), "dash-air": (870, 445, 130),
}


def dash_svg():
    warn = "".join(f'<circle id="wl-{i}" cx="{470 + i*56}" cy="135" r="16" fill="{c}"/>' for i, c in
                   enumerate(["#ff3b30", "#ffb020", "#ffb020", "#ff3b30", "#ffb020", "#ff3b30", "#ffb020", "#ffb020", "#3aa0ff"]))
    g = [gauge(560, 280, 95, "RPM", "rpm", 3000), gauge(820, 280, 95, "SPEED", "speed"),
         gauge(450, 445, 50, "OIL", "oil"), gauge(570, 445, 50, "FUEL/DEF", "fuel"), gauge(690, 445, 50, "WATER", "water"),
         gauge(810, 445, 50, "AIR 1", "air1"), gauge(930, 445, 50, "AIR 2", "air2")]
    rings = "".join(ring(*v, k) for k, v in DASH_PARTS.items() if k not in ("dash-warn", "dash-air"))
    rings += '<rect id="hl-dash-warn" x="440" y="105" width="510" height="60" rx="30" fill="none" stroke="__Y__" stroke-width="8" opacity="0" filter="url(#glow2)"/>'
    rings += '<rect id="hl-dash-air" x="748" y="383" width="244" height="160" rx="30" fill="none" stroke="__Y__" stroke-width="8" opacity="0" filter="url(#glow2)"/>'
    return f"""
<svg id="dash" viewBox="0 0 1000 540" width="1000" height="540" style="position:absolute;left:40px;top:590px;overflow:visible">
  <defs><filter id="glow2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <rect x="0" y="0" width="1000" height="540" rx="36" fill="#161b21" stroke="#2a3038" stroke-width="4"/>
  <rect x="20" y="16" width="960" height="66" rx="20" fill="#1d2f42" opacity=".55"/>
  <text x="520" y="58" fill="#8fb0cf" font-family="Inter" font-weight="800" font-size="28" text-anchor="middle">WINDSHIELD</text>
  <path id="horn-cord" d="M120 10 v60" stroke="#c9d1d7" stroke-width="6"/><circle cx="120" cy="78" r="12" fill="#c9d1d7"/>
  <text x="240" y="86" fill="#c9d1d7" font-family="Inter" font-weight="800" font-size="28" text-anchor="middle">HWY HORN</text>
  <rect x="430" y="100" width="530" height="70" rx="35" fill="#0f1317" stroke="#3a434e" stroke-width="4"/>
  <g id="warn-lights" opacity=".25">{warn}</g>
  {''.join(g)}
  <g id="wheel-rot">
    <circle cx="230" cy="330" r="150" fill="none" stroke="#59636f" stroke-width="30"/>
    <line x1="230" y1="330" x2="95" y2="330" stroke="#59636f" stroke-width="24"/><line x1="230" y1="330" x2="365" y2="330" stroke="#59636f" stroke-width="24"/>
    <line x1="230" y1="330" x2="230" y2="475" stroke="#59636f" stroke-width="24"/>
    <circle cx="230" cy="330" r="46" fill="#2b333d" stroke="#7d8894" stroke-width="4"/>
    <text x="230" y="338" fill="#c9d1d7" font-family="Inter" font-weight="900" font-size="28" text-anchor="middle">HORN</text>
  </g>
  {rings}
</svg>"""


def screen_pos(cue):
    if cue == "truck-cab":
        return (40 + 820, 250 + 120)
    if cue in DASH_PARTS:
        cx, cy, r = DASH_PARTS[cue]
        return (40 + cx, 590 + cy)
    if cue in ("wheel-turn",):
        return screen_pos("wheel")
    return None

# ---------- build ----------

def build(spec_path):
    spec = json.load(open(spec_path))
    bdir = os.path.join(HERE, "build", spec["id"])
    cache = os.path.join(HERE, "build", "tts")
    os.makedirs(os.path.join(bdir, "assets"), exist_ok=True); os.makedirs(cache, exist_ok=True)

    t = 0.6
    parts, els, js, timeline = [], [], [], []
    marker_pos = None
    section = None
    gap = {"narr": 0.3, "say": 0.55, "do": 0.4, "examiner": 0.5, "flash": 0.5, "trick": 0.6, "practice": 0.3}
    n = 0

    def hl(cue, a, b):
        if not cue:
            return
        targets = {"dash-all": ["#hl-dash-warn", "#hl-dash-rpm", "#hl-dash-speed", "#hl-dash-oil", "#hl-dash-fuel", "#hl-dash-water", "#hl-dash-air"],
                   "wheel-turn": ["#hl-wheel"], "start": ["#hl-dash-warn"]}.get(cue, [f"#hl-{cue}"])
        for s in targets:
            js.append(f'tl.fromTo("{s}",{{opacity:0}},{{opacity:1,duration:.2,immediateRender:false}},{a:.2f});')
            js.append(f'tl.fromTo("{s}",{{opacity:1}},{{opacity:0,duration:.25,immediateRender:false}},{max(a + .2, b - .1):.2f});')

    def move_marker(cue, a):
        nonlocal marker_pos
        p = screen_pos(cue)
        if not p:
            return
        tx, ty = p[0] - 44, p[1] - 150
        if marker_pos is None:
            js.append(f'tl.fromTo("#marker",{{x:{tx},y:{ty},opacity:0}},{{x:{tx},y:{ty},opacity:1,duration:.3}},{a:.2f});')
        elif marker_pos != (tx, ty):
            js.append(f'tl.fromTo("#marker",{{x:{marker_pos[0]},y:{marker_pos[1]}}},{{x:{tx},y:{ty},duration:.45,ease:"power2.inOut",immediateRender:false}},{a:.2f});')
        marker_pos = (tx, ty)

    for seg in spec["segments"]:
        k = seg["t"]
        if k == "section":
            section = seg["name"]
            els.append(f'<div id="sec-{n}" class="clip sec" data-start="{t:.2f}" data-duration="1.4"><span>{html.escape(section)}</span></div>')
            js.append(f'tl.fromTo("#sec-{n} span",{{scale:1.3,opacity:0}},{{scale:1,opacity:1,duration:.25,ease:"back.out(2)"}},{t:.2f});')
            t += 1.1; n += 1
            continue
        if k in ("narr", "do", "flash", "trick", "practice"):
            wav = tts(seg["hi"], "narr", cache)
        elif k == "examiner":
            wav = tts(seg["text"], "examiner", cache)
        else:
            wav = tts(seg.get("speak", seg["text"]), "say", cache)
        d = dur(wav)
        a, b = t, t + d
        parts.append((a, wav))
        cue = seg.get("cue")
        hl(cue, a, b)
        move_marker(cue, a)

        if k in ("narr", "flash", "trick", "practice"):
            for i, (c, ca, cb) in enumerate(spread(caption_chunks(seg["cap"]), a, b)):
                els.append(f'<div id="cap-{n}-{i}" class="clip cap" data-start="{ca:.2f}" data-duration="{cb - ca:.2f}"><span>{html.escape(c)}</span></div>')
                js.append(f'tl.fromTo("#cap-{n}-{i} span",{{y:14,opacity:0}},{{y:0,opacity:1,duration:.15}},{ca:.2f});')
        if k == "do":
            dd = d + gap[k]
            els.append(f'<div id="do-{n}" class="clip card do" data-start="{a:.2f}" data-duration="{dd:.2f}"><b>DO</b><span>{html.escape(seg["text"])}</span></div>')
            js.append(f'tl.fromTo("#do-{n}",{{y:30,opacity:0}},{{y:0,opacity:1,duration:.2}},{a:.2f});')
            els.append(f'<div id="dcap-{n}" class="clip cap low" data-start="{a:.2f}" data-duration="{d:.2f}"><span>{html.escape(seg["cap"])}</span></div>')
        if k == "say":
            chunks = balanced_chunks(seg["text"], 72)
            sp = spread(chunks, a, b)
            for i, (c, ca, cb) in enumerate(sp):
                end = cb + (gap[k] if i == len(sp) - 1 else 0)
                els.append(f'<div id="say-{n}-{i}" class="clip card say{" final" if seg.get("final") else ""}{" long" if len(c) > 48 else ""}" data-start="{ca:.2f}" data-duration="{end - ca:.2f}"><b>SAY</b><span>{html.escape(c)}</span></div>')
                js.append(f'tl.fromTo("#say-{n}-{i}",{{scale:.94,opacity:0}},{{scale:1,opacity:1,duration:.18,ease:"back.out(2)"}},{ca:.2f});')
        if k == "examiner":
            els.append(f'<div id="ex-{n}" class="clip bubble" data-start="{a:.2f}" data-duration="{d + .5:.2f}"><b>EXAMINER</b><span>“{html.escape(seg["text"])}”</span></div>')
            js.append(f'tl.fromTo("#ex-{n}",{{y:30,opacity:0}},{{y:0,opacity:1,duration:.25}},{a:.2f});')
        if cue == "start":
            js.append(f'tl.fromTo("#warn-lights",{{opacity:.25}},{{opacity:1,duration:.2,immediateRender:false}},{a + .4:.2f});')
            js.append(f'tl.fromTo("#warn-lights circle:not(#wl-0):not(#wl-8)",{{opacity:1}},{{opacity:.12,duration:.4,stagger:.1,immediateRender:false}},{b - .6:.2f});')
            for g, v, vmax in (("rpm", 700, 3000), ("oil", 60, 100), ("fuel", 75, 100), ("water", 55, 100), ("air1", 120, 150), ("air2", 118, 150), ("speed", 0, 150)):
                ang = -120 + 240 * v / vmax
                c = {"rpm": (560, 280), "speed": (820, 280), "oil": (450, 445), "fuel": (570, 445), "water": (690, 445), "air1": (810, 445), "air2": (930, 445)}[g]
                js.append(f'tl.fromTo("#n-{g}",{{rotation:-120,svgOrigin:"{c[0]} {c[1]}"}},{{rotation:{ang:.0f},svgOrigin:"{c[0]} {c[1]}",duration:1.4,ease:"power2.out"}},{a + .6:.2f});')
        if cue == "wheel-turn":
            js.append(f'tl.fromTo("#wheel-rot",{{rotation:0,svgOrigin:"230 330"}},{{rotation:-45,svgOrigin:"230 330",duration:{d/3:.2f},ease:"power2.inOut",immediateRender:false}},{a:.2f});')
            js.append(f'tl.fromTo("#wheel-rot",{{rotation:-45,svgOrigin:"230 330"}},{{rotation:45,svgOrigin:"230 330",duration:{d/3:.2f},ease:"power2.inOut",immediateRender:false}},{a + d/3:.2f});')
            js.append(f'tl.fromTo("#wheel-rot",{{rotation:45,svgOrigin:"230 330"}},{{rotation:0,svgOrigin:"230 330",duration:{d/3:.2f},ease:"power2.inOut",immediateRender:false}},{a + 2*d/3:.2f});')
        if k == "flash":
            fd = max(d + .4, 3.0)
            lo, hi_ = seg["range"]
            a0 = -120 + 240 * lo / 150; a1 = -120 + 240 * hi_ / 150
            def arc(r, s, e):
                sx, sy = 300 + r * math.sin(math.radians(s)), 300 - r * math.cos(math.radians(s))
                ex, ey = 300 + r * math.sin(math.radians(e)), 300 - r * math.cos(math.radians(e))
                return f"M{sx:.1f} {sy:.1f} A{r} {r} 0 {1 if e - s > 180 else 0} 1 {ex:.1f} {ey:.1f}"
            labels = "".join(f'<text x="{300 + 205*math.sin(math.radians(-120 + 240*v/150)):.0f}" y="{312 - 205*math.cos(math.radians(-120 + 240*v/150)):.0f}" fill="#9aa6b2" font-family="Inter" font-weight="700" font-size="30" text-anchor="middle">{v}</text>' for v in range(0, 151, 30))
            els.append(f'''<div id="fl-{n}" class="clip flash" data-start="{a:.2f}" data-duration="{fd:.2f}">
  <svg viewBox="0 0 600 600" width="600" height="600" style="position:absolute;left:240px;top:330px">
    <circle cx="300" cy="300" r="270" fill="#0f1317" stroke="#3a434e" stroke-width="10"/>
    <path d="{arc(240, -120, 120)}" fill="none" stroke="#2a3038" stroke-width="34"/>
    <path d="{arc(240, a0, a1)}" fill="none" stroke="{Y}" stroke-width="34"/>
    {labels}
    <g id="fln-{n}"><line x1="300" y1="300" x2="300" y2="80" stroke="#ff5a3c" stroke-width="12" stroke-linecap="round"/></g>
    <circle cx="300" cy="300" r="22" fill="#c9d1d7"/>
    <text x="300" y="470" fill="#9aa6b2" font-family="Inter" font-weight="900" font-size="34" text-anchor="middle">AIR PSI</text>
  </svg>
  <div class="big">{html.escape(seg["big"])} <small>{html.escape(seg["unit"])}</small></div>
</div>''')
            js.append(f'tl.fromTo("#fl-{n} .big",{{scale:1.6,opacity:0}},{{scale:1,opacity:1,duration:.3,ease:"back.out(2)"}},{a:.2f});')
            js.append(f'tl.fromTo("#fln-{n}",{{rotation:-120,svgOrigin:"300 300"}},{{rotation:{a0:.0f},svgOrigin:"300 300",duration:.8,ease:"power2.out"}},{a + .2:.2f});')
            js.append(f'tl.fromTo("#fln-{n}",{{rotation:{a0:.0f},svgOrigin:"300 300"}},{{rotation:{a1:.0f},svgOrigin:"300 300",duration:.9,ease:"power2.inOut",immediateRender:false}},{a + 1.1:.2f});')
            nv = -120 + 240 * seg["needle"] / 150
            js.append(f'tl.fromTo("#fln-{n}",{{rotation:{a1:.0f},svgOrigin:"300 300"}},{{rotation:{nv:.0f},svgOrigin:"300 300",duration:.6,ease:"power2.out",immediateRender:false}},{a + 2.1:.2f});')
            b = a + fd - .4
        if k == "trick":
            td = d + .6
            phrase = seg.get("phrase")
            ph = (" ".join(f'<u>{html.escape(w[0])}</u>{html.escape(w[1:])}' for w in phrase.split()) if phrase else html.escape(seg["letters"]))
            els.append(f'<div id="tr-{n}" class="clip trick" data-start="{a:.2f}" data-duration="{td:.2f}"><b>MEMORY TRICK</b><div class="letters{" phrase" if phrase else ""}">{ph}</div><div class="words">{html.escape(seg["words"])}</div></div>')
            if marker_pos is not None:
                js.append(f'tl.fromTo("#marker",{{opacity:1}},{{opacity:0,duration:.2,immediateRender:false}},{a:.2f});')
                marker_pos = None
            js.append(f'tl.fromTo("#tr-{n}",{{y:40,opacity:0}},{{y:0,opacity:1,duration:.3}},{a:.2f});')
        if k == "practice":
            sil = seg["silence"]
            pd = d + sil + .4
            items = "".join(f'<li><b>{html.escape(h)}</b> {html.escape(x)}</li>' for h, x in seg["items"])
            els.append(f'<div id="pr-{n}" class="clip practice" data-start="{a:.2f}" data-duration="{pd:.2f}"><div class="ptitle">AB AAP BOLO</div><div class="psec">{html.escape(spec["practice_title"])}</div><ul>{items}</ul><div class="pbar"><i id="pbar-{n}"></i></div></div>')
            js.append(f'tl.fromTo("#pr-{n}",{{opacity:0}},{{opacity:1,duration:.3}},{a:.2f});')
            for i, num in enumerate(["3", "2", "1"]):
                step = d * 0.22
                ta = a + d * 0.3 + step * i
                els.append(f'<div id="cd-{n}-{i}" class="clip count" data-start="{ta:.2f}" data-duration="{step if i < 2 else step + .6:.2f}"><span>{num}</span></div>')
                js.append(f'tl.fromTo("#cd-{n}-{i} span",{{scale:2,opacity:0}},{{scale:1,opacity:1,duration:.25}},{ta:.2f});')
            js.append(f'tl.fromTo("#pbar-{n}",{{scaleX:1}},{{scaleX:0,duration:{sil:.2f},ease:"none"}},{b + .2:.2f});')
            b = b + sil
        t = b + gap.get(k, .4)
        n += 1

    total = round(t + 1.2, 2)

    # mix voice
    voice = os.path.join(bdir, "assets", "voice.wav")
    inputs, filt = [], []
    for i, (off, w) in enumerate(parts):
        inputs += ["-i", w]; ms = int(off * 1000)
        filt.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=mono,adelay={ms}|{ms}[a{i}]")
    filt.append("".join(f"[a{i}]" for i in range(len(parts))) + f"amix=inputs={len(parts)}:normalize=0,apad=whole_dur={total},loudnorm=I=-15:TP=-1.5[o]")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(filt), "-map", "[o]", "-ar", "48000", voice], check=True)

    page = TEMPLATE.replace("__TRUCK__", TRUCK).replace("__DASH__", dash_svg() if spec.get("view") == "dash" else "") \
        .replace("__ELS__", "\n".join(els)).replace("__JS__", "\n".join(js)).replace("__TOTAL__", str(total)) \
        .replace("__EP__", html.escape(spec["episode"])).replace("__TITLE__", html.escape(spec["title"].upper())) \
        .replace("__NEXT__", html.escape(spec.get("next", ""))).replace("__Y__", Y)
    open(os.path.join(bdir, "index.html"), "w").write(page)
    if not os.path.exists(os.path.join(bdir, "package.json")):
        json.dump({"name": spec["id"].lower(), "private": True, "type": "module"}, open(os.path.join(bdir, "package.json"), "w"))
        json.dump({"paths": {"blocks": "compositions", "assets": "assets"}}, open(os.path.join(bdir, "hyperframes.json"), "w"))
    print(f"built {spec['id']}: {total}s, {len(parts)} voice clips -> {bdir}")
    return bdir, total


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080, height=1920">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1920px;overflow:hidden;background:#0b0e12}
#root{position:absolute;inset:0;font-family:"Inter",sans-serif;color:#fff}
#bg{position:absolute;inset:0;background:radial-gradient(circle at 50% 30%,#18202a,#0b0e12 70%)}
#hdr{position:absolute;left:60px;right:60px;top:84px;height:120px}
#hdr .tag{display:inline-block;background:__Y__;color:#111;font-family:"Montserrat";font-weight:900;font-size:26px;letter-spacing:2px;padding:8px 18px;border-radius:10px}
#hdr .ttl{margin-top:14px;font-family:"Montserrat";font-weight:900;font-size:50px;letter-spacing:-1px}
#hdr .ttl i{font-style:normal;color:__Y__}
#marker{position:absolute;left:0;top:0;width:88px;height:120px;opacity:0;z-index:5}
#marker .head{width:88px;height:88px;border-radius:50%;background:__Y__;color:#111;font-family:"Montserrat";font-weight:900;font-size:46px;line-height:88px;text-align:center;box-shadow:0 0 30px rgba(255,210,31,.6)}
#marker .pin{width:0;height:0;margin:0 auto;border-left:16px solid transparent;border-right:16px solid transparent;border-top:28px solid __Y__}
.cap{position:absolute;left:70px;right:70px;top:1200px;text-align:center;z-index:6}
.cap span{display:inline-block;font-family:"Montserrat";font-weight:900;font-size:56px;line-height:68px;color:#fff;text-shadow:0 4px 0 #000,0 0 20px rgba(0,0,0,.9)}
.cap.low{top:1470px}
.card{position:absolute;left:60px;right:60px;top:1180px;min-height:200px;border-radius:30px;padding:70px 40px 34px;z-index:6}
.card b{position:absolute;left:34px;top:-26px;font-family:"Montserrat";font-weight:900;font-size:34px;padding:8px 22px;border-radius:12px;letter-spacing:3px}
.card span{display:block;font-family:"Montserrat";font-weight:900;font-size:54px;line-height:66px}
.say{background:#1c1806;border:6px solid __Y__;box-shadow:0 0 50px rgba(255,210,31,.25)}
.say b{background:__Y__;color:#111}
.say span{color:__Y__}
.say.long span{font-size:46px;line-height:58px}
.do{background:#141a20;border:5px solid #5b6672;top:1180px}
.do b{background:#5b6672;color:#fff}
.do span{color:#e6ebef}
.bubble{position:absolute;left:60px;right:60px;top:1180px;background:#fff;color:#111;border-radius:30px;padding:60px 40px 36px;z-index:6}
.bubble b{position:absolute;left:34px;top:-24px;background:#ff5a3c;color:#fff;font-family:"Montserrat";font-weight:900;font-size:30px;padding:8px 20px;border-radius:12px;letter-spacing:2px}
.bubble span{font-family:"Montserrat";font-weight:900;font-size:60px;line-height:72px}
.sec{position:absolute;left:0;right:0;top:1180px;text-align:center;z-index:6}
.sec span{display:inline-block;font-family:"Montserrat";font-weight:900;font-size:80px;color:#111;background:__Y__;padding:10px 40px;border-radius:20px}
.flash{position:absolute;inset:0;background:rgba(5,7,9,.94);z-index:8}
.flash .big{position:absolute;left:0;right:0;top:1000px;text-align:center;font-family:"Montserrat";font-weight:900;font-size:200px;color:__Y__;text-shadow:0 0 60px rgba(255,210,31,.4);letter-spacing:-6px}
.flash .big small{font-size:110px;letter-spacing:0}
.flash ~ .cap{z-index:9}
.trick{position:absolute;left:60px;right:60px;top:560px;height:620px;background:#141a20;border:6px solid __Y__;border-radius:36px;z-index:7;text-align:center;padding:90px 40px 0}
.trick b{position:absolute;left:0;right:0;top:34px;font-family:"Montserrat";font-weight:900;font-size:34px;letter-spacing:6px;color:__Y__}
.trick .letters{font-family:"Montserrat";font-weight:900;font-size:76px;line-height:96px;color:#fff;margin-top:40px}
.trick .letters.phrase{font-size:64px;line-height:80px}
.trick .letters u{text-decoration:none;color:__Y__}
.trick .words{font-family:"Inter";font-weight:700;font-size:38px;line-height:54px;color:#c9d1d7;margin-top:40px}
.practice{position:absolute;inset:0;background:#0b0e12;z-index:10;padding:200px 70px 0}
.practice .ptitle{font-family:"Montserrat";font-weight:900;font-size:110px;color:__Y__;letter-spacing:-2px}
.practice .psec{font-family:"Montserrat";font-weight:900;font-size:40px;color:#9aa6b2;letter-spacing:4px;margin-top:6px}
.practice ul{list-style:none;margin-top:56px}
.practice li{font-family:"Inter";font-weight:700;font-size:40px;line-height:54px;color:#e6ebef;margin-bottom:30px}
.practice li b{display:block;font-family:"Montserrat";font-weight:900;font-size:34px;color:__Y__;letter-spacing:3px}
.practice .pbar{position:absolute;left:70px;right:70px;top:1480px;height:22px;border-radius:11px;background:#222a33;overflow:hidden}
.practice .pbar i{display:block;height:100%;background:__Y__;transform-origin:left center}
.count{position:absolute;left:0;right:0;top:1540px;text-align:center;z-index:11}
.count span{display:inline-block;font-family:"Montserrat";font-weight:900;font-size:220px;line-height:240px;color:#fff;background:none}
.practice ~ .cap{z-index:12}
.final{z-index:13}
#next{position:absolute;left:0;right:0;top:1700px;text-align:center;font-family:"Montserrat";font-weight:900;font-size:34px;color:#7d8894;letter-spacing:3px}
</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="__TOTAL__" data-width="1080" data-height="1920">
  <div id="bg"></div>
  <div id="hdr"><span class="tag">HIMANSHU KA DRIVETEST DIN</span><div class="ttl"><i>__EP__</i> · __TITLE__</div></div>
  __TRUCK__
  __DASH__
  <div id="marker"><div class="head">H</div><div class="pin"></div></div>
  __ELS__
  <div id="next" class="clip" data-start="0" data-duration="__TOTAL__">NEXT → __NEXT__</div>
  <audio id="voice" class="clip" src="assets/voice.wav" data-start="0" data-duration="__TOTAL__" data-volume="1"></audio>
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
__JS__
window.__timelines["main"] = tl;
</script>
</body></html>
"""

if __name__ == "__main__":
    spec_path = sys.argv[1]
    bdir, total = build(spec_path)
    if "--render" in sys.argv:
        out = os.path.join(HERE, "out", os.path.basename(spec_path).replace(".json", ".mp4"))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        subprocess.run(["npx", "--prefix", HF, "hyperframes", "render", bdir, "-o", out, "-q", "delivery"], check=True)
        print("rendered", out)
