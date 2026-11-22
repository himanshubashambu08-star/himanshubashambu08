"""Step 3: find the best moments.

With ANTHROPIC_API_KEY set, Claude reads the timestamped transcript and picks the
moments most likely to go viral, plus a title, caption and hashtags for each.
Without it (or if that call fails) a heuristic scores windows by loudness,
speech speed and hype words.
"""
import json
import re
import subprocess
from pathlib import Path

import numpy as np

from .config import env, env_int

HYPE_WORDS = re.compile(
    r"\b(no way|oh my god|omg|what|bro|wait|insane|crazy|let'?s go|yo+|wow|bhai|kya|"
    r"pagal|mast|haha+|lol|dude|holy|run|go go)\b|[!?]",
    re.I,
)


def loudness_curve(video: Path, hop: float = 0.5) -> np.ndarray:
    """RMS loudness per `hop` seconds, decoded with ffmpeg at 8 kHz mono."""
    rate = 8000
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", str(rate),
         "-f", "s16le", "-"],
        capture_output=True, check=True,
    ).stdout
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    step = int(rate * hop)
    n = len(samples) // step
    if n == 0:
        return np.zeros(1)
    frames = samples[: n * step].reshape(n, step)
    return np.sqrt((frames ** 2).mean(axis=1) + 1e-9)


def _z(values: list[float]) -> np.ndarray:
    a = np.array(values, dtype=float)
    return (a - a.mean()) / (a.std() + 1e-9) if len(a) else a


def _pick_non_overlapping(cands: list[dict], n: int) -> list[dict]:
    chosen = []
    for c in sorted(cands, key=lambda c: c["score"], reverse=True):
        if all(c["end"] <= o["start"] or c["start"] >= o["end"] for o in chosen):
            chosen.append(c)
        if len(chosen) == n:
            break
    return sorted(chosen, key=lambda c: c["start"])


def heuristic(video: Path, transcript: list[dict], duration: float, n: int,
              min_len: float, max_len: float) -> list[dict]:
    loud = loudness_curve(video)
    hop = 0.5

    def mean_loud(a, b):
        seg = loud[int(a / hop): max(int(b / hop), int(a / hop) + 1)]
        return float(seg.mean()) if len(seg) else 0.0

    cands = []
    if transcript:
        # windows that start and end on sentence boundaries
        for i, first in enumerate(transcript):
            text, j = "", i
            while j < len(transcript) and transcript[j]["end"] - first["start"] <= max_len:
                text += " " + transcript[j]["text"]
                j += 1
                length = transcript[j - 1]["end"] - first["start"]
                if length >= min_len:
                    cands.append({"start": first["start"], "end": transcript[j - 1]["end"],
                                  "text": text.strip()})
    if not cands:
        # no speech: fixed windows every 5 s
        length = min(max_len, max(min_len, 30))
        t = 0.0
        while t + length <= duration:
            cands.append({"start": t, "end": t + length, "text": ""})
            t += 5

    loud_z = _z([mean_loud(c["start"], c["end"]) for c in cands])
    wps_z = _z([len(c["text"].split()) / (c["end"] - c["start"]) for c in cands])
    hype_z = _z([len(HYPE_WORDS.findall(c["text"])) for c in cands])
    for c, a, b, h in zip(cands, loud_z, wps_z, hype_z):
        c["score"] = 0.5 * a + 0.25 * b + 0.25 * h

    picks = _pick_non_overlapping(cands, n)
    for p in picks:
        words = p["text"].split()
        p["title"] = " ".join(words[:6]).strip(" ,.") or "Wait for it…"
        caption = p["text"]
        if len(caption) > 150:
            caption = caption[:150].rsplit(" ", 1)[0] + "…"
        p["caption"] = caption
        p["hashtags"] = []
    return picks


CLAUDE_SCHEMA = {
    "type": "object",
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start": {"type": "number"},
                    "end": {"type": "number"},
                    "title": {"type": "string"},
                    "caption": {"type": "string"},
                    "hashtags": {"type": "array", "items": {"type": "string"}},
                    "why": {"type": "string"},
                },
                "required": ["start", "end", "title", "caption", "hashtags", "why"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["clips"],
    "additionalProperties": False,
}


def with_claude(transcript: list[dict], meta: dict, n: int, min_len: float,
                max_len: float) -> list[dict]:
    import anthropic

    lines = "\n".join(f"[{s['start']:.1f}-{s['end']:.1f}] {s['text']}" for s in transcript)
    prompt = f"""You are a short-form video editor who cuts viral TikToks and Instagram Reels.

Video title: {meta.get('title', '')}
Channel: {meta.get('uploader', '')}

Below is the timestamped transcript (seconds). Pick the {n} best, non-overlapping moments
to post as vertical short clips. Each clip must be between {min_len:.0f} and {max_len:.0f} seconds,
start right at a strong hook (no slow intro) and end on a payoff or punchline, so it makes
sense without the rest of the video. Use the timestamps exactly as given.

For each clip write:
- title: a 2-6 word on-screen hook in the video's language, punchy, no hashtags
- caption: a 1-2 sentence post caption that makes people want to watch
- hashtags: 4-6 relevant hashtags including the '#'
- why: one short line on why it will perform

<transcript>
{lines}
</transcript>"""

    client = anthropic.Anthropic()
    response = client.beta.messages.create(
        model="claude-opus-5-5",
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": CLAUDE_SCHEMA}},
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("Claude declined this transcript")
    text = next(b.text for b in response.content if b.type == "text")
    clips = json.loads(text)["clips"]

    # snap to real sentence boundaries and clamp the length
    starts = [s["start"] for s in transcript]
    ends = [s["end"] for s in transcript]
    out = []
    for c in clips:
        start = min(starts, key=lambda t: abs(t - c["start"]))
        end = min(ends, key=lambda t: abs(t - c["end"]))
        if end - start < min_len * 0.6:
            end = start + min_len
        end = min(end, start + max_len)
        out.append({**c, "start": start, "end": end, "score": 1.0})
    return _pick_non_overlapping(out, n)


def find_highlights(video: Path, transcript: list[dict], meta: dict, duration: float,
                    log=print) -> list[dict]:
    n = env_int("CLIPS_PER_VIDEO", 3)
    min_len = float(env_int("CLIP_MIN_SECONDS", 20))
    max_len = float(env_int("CLIP_MAX_SECONDS", 55))
    if duration <= max_len:
        # short source: post it whole
        return [{"start": 0.0, "end": duration, "title": meta.get("title", "")[:40],
                 "caption": meta.get("title", ""), "hashtags": [], "score": 1.0}]

    if env("ANTHROPIC_API_KEY") and transcript:
        try:
            log("Claude is picking the best moments…")
            picks = with_claude(transcript, meta, n, min_len, max_len)
            if picks:
                return picks
        except Exception as e:  # fall back to the heuristic, never block the run
            log(f"Claude pick failed ({e}); using heuristic")
    log("Scoring moments by loudness and speech…")
    return heuristic(video, transcript, duration, n, min_len, max_len)
