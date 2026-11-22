"""Step 2: speech to text with word timings (faster-whisper, runs on your computer)."""
import json
from pathlib import Path

from .config import env


def transcribe(video: Path, cache: Path, log=print) -> list[dict]:
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))

    from faster_whisper import WhisperModel

    size = env("WHISPER_MODEL", "small")
    log(f"Transcribing with Whisper '{size}' (first run downloads the model)…")
    model = WhisperModel(size, device="auto", compute_type="int8")
    segments, info = model.transcribe(str(video), word_timestamps=True, vad_filter=True)
    out = []
    for seg in segments:
        out.append(
            {
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": seg.text.strip(),
                "words": [
                    {"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()}
                    for w in (seg.words or [])
                    if w.word.strip()
                ],
            }
        )
    log(f"Transcript: {len(out)} lines, language '{info.language}'")
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out
