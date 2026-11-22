"""Step 5: word-by-word "pop" captions as an .ass subtitle file (burned in by ffmpeg)."""
from pathlib import Path

from .config import env

YELLOW = r"{\c&H00E5FF&\fscx112\fscy112}"  # ASS colours are BGR
WHITE = r"{\c&HFFFFFF&\fscx100\fscy100}"


def _ts(t: float) -> str:
    t = max(t, 0)
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def _clean(text: str) -> str:
    return text.replace("{", "(").replace("}", ")").replace("\\", "/").upper()


def _words_in(transcript: list[dict], start: float, end: float) -> list[dict]:
    words = []
    for seg in transcript:
        if seg["end"] < start or seg["start"] > end:
            continue
        if seg.get("words"):
            words += [w for w in seg["words"] if start <= w["start"] < end]
        else:  # no word timings: spread the line evenly
            parts = seg["text"].split()
            span = (seg["end"] - seg["start"]) / max(len(parts), 1)
            for i, p in enumerate(parts):
                ws = seg["start"] + i * span
                if start <= ws < end:
                    words.append({"start": ws, "end": ws + span, "word": p})
    return words


def _chunks(words: list[dict], max_words: int = 3, max_gap: float = 0.6) -> list[list[dict]]:
    chunks, cur = [], []
    for w in words:
        if cur and (len(cur) >= max_words or w["start"] - cur[-1]["end"] > max_gap):
            chunks.append(cur)
            cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    return chunks


def write_ass(path: Path, transcript: list[dict], start: float, end: float, hook: str = "") -> None:
    font = env("CAPTION_FONT", "Arial Black")
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{font},86,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,2,60,60,470,1
Style: Hook,{font},74,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC8000000,-1,0,0,0,100,100,0,0,3,18,0,8,80,80,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    if hook:
        lines.append(f"Dialogue: 1,{_ts(0)},{_ts(min(3.0, end - start))},Hook,,0,0,0,,"
                     rf"{{\fad(150,250)}}{_clean(hook)}")

    for chunk in _chunks(_words_in(transcript, start, end)):
        for i, w in enumerate(chunk):
            on = w["start"] - start
            off = (chunk[i + 1]["start"] if i + 1 < len(chunk) else chunk[-1]["end"]) - start
            text = " ".join(
                (YELLOW if j == i else WHITE) + _clean(x["word"]) for j, x in enumerate(chunk)
            )
            lines.append(f"Dialogue: 0,{_ts(on)},{_ts(max(off, on + 0.05))},Cap,,0,0,0,,{text}")

    path.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
