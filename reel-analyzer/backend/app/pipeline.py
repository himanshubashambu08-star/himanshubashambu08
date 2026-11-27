"""Background job: download/accept -> frames -> audio -> transcript -> Claude analysis."""
import logging
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import db
from .analyze import analyze
from .config import REELS_DIR, env
from .media import UserFacingError, download, extract_audio, extract_frames, probe, require_tools
from .transcribe import transcribe

log = logging.getLogger("reel-analyzer")
_pool = ThreadPoolExecutor(max_workers=2)


def reel_dir(rid: str) -> Path:
    return REELS_DIR / rid


def submit(rid: str, url: str | None = None, uploaded: Path | None = None) -> None:
    _pool.submit(_run, rid, url, uploaded)


def _step(rid: str, progress: int, stage: str) -> None:
    db.update_reel(rid, status="processing", progress=progress, stage=stage)


def _run(rid: str, url: str | None, uploaded: Path | None) -> None:
    work = reel_dir(rid)
    work.mkdir(parents=True, exist_ok=True)
    reel = db.get_reel(rid) or {}
    options = reel.get("options") or {}
    warnings: list[str] = []
    try:
        require_tools()
        meta = {"platform": reel.get("platform"), "title": "", "uploader": "", "description": ""}
        if url:
            _step(rid, 5, "Downloading video")
            video, info = download(url, work)
            meta.update(info)
        else:
            video = uploaded
        _step(rid, 20, "Reading video")
        p = probe(video)
        locked = options.get("title_locked", False)
        db.update_reel(rid, duration=p["duration"], uploader=meta.get("uploader") or None,
                       title=reel.get("title") if locked else (meta.get("title") or reel.get("title") or None))

        _step(rid, 25, "Extracting key frames")
        frames = extract_frames(video, work / "frames", p["duration"])
        db.update_reel(rid, frames=frames)

        transcript, language = "", ""
        if p["has_audio"]:
            _step(rid, 35, "Extracting audio")
            audio = extract_audio(video, work / "audio.mp3")
            if audio:
                _step(rid, 40, "Transcribing speech")
                try:
                    t = transcribe(audio, options.get("language", "auto"))
                    transcript, language = t["timed"], t["language"]
                except UserFacingError as e:
                    if not env("OPENAI_API_KEY"):
                        warnings.append(str(e))
                    else:
                        raise
        db.update_reel(rid, transcript=transcript, language=language)

        _step(rid, 55, "Analyzing with Claude")
        last = [55]

        def on_progress(frac: float) -> None:
            pct = 55 + int(frac * 40)
            if pct > last[0]:
                last[0] = pct
                db.update_reel(rid, progress=pct, stage="Writing the analysis")

        analysis = analyze(work / "frames", frames, transcript, meta, p["duration"],
                           currency=options.get("currency", "auto"), on_progress=on_progress)
        if warnings:
            analysis["warnings"] = warnings
        current = db.get_reel(rid) or {}
        db.update_reel(
            rid,
            status="done",
            progress=100,
            stage="Done",
            analysis=analysis,
            title=current.get("title") if locked else (analysis.get("title") or current.get("title")),
            tags=[t.strip().lower() for t in analysis.get("tags", []) if t.strip()][:8],
            language=language or analysis.get("language") or None,
        )
        # The video itself is no longer needed; frames + transcript are what we keep.
        for f in work.glob("source.*"):
            f.unlink(missing_ok=True)
        if uploaded and uploaded.exists():
            uploaded.unlink(missing_ok=True)
        (work / "audio.mp3").unlink(missing_ok=True)
    except UserFacingError as e:
        db.update_reel(rid, status="error", error=str(e), stage="Failed")
    except Exception as e:  # noqa: BLE001 - surface anything unexpected to the UI
        log.error("Reel %s failed:\n%s", rid, traceback.format_exc())
        db.update_reel(rid, status="error", error=f"Something went wrong while processing: {e}", stage="Failed")

