"""The whole flow: link -> download -> transcript -> best moments -> vertical captioned clips -> post."""
import json
import re
import time
from pathlib import Path

from .captions import write_ass
from .config import OUTPUT_DIR, env
from .download import fetch_source
from .highlights import find_highlights
from .reframe import plan_reframe
from .render import probe, render_clip
from .transcribe import transcribe


def post_text(clip: dict, meta: dict) -> str:
    tags = clip.get("hashtags") or []
    default = env("DEFAULT_HASHTAGS").split()
    tags = list(dict.fromkeys([t if t.startswith("#") else f"#{t}" for t in tags] + default))
    parts = [clip.get("caption") or clip.get("title", "")]
    if meta.get("uploader"):
        parts.append(f"🎥 {meta['uploader']}")
    parts.append(" ".join(tags[:10]))
    return "\n\n".join(p for p in parts if p)


def run(source: str, post_to: list[str] | None = None, log=print) -> dict:
    post_to = post_to or []
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", source.split("v=")[-1].split("/")[-1])[:24].strip("-")
    job_dir = OUTPUT_DIR / f"{time.strftime('%Y%m%d-%H%M%S')}_{slug or 'video'}"
    job_dir.mkdir(parents=True, exist_ok=True)

    src, meta = fetch_source(source, job_dir, log)
    info = probe(src)
    transcript = transcribe(src, job_dir / "transcript.json", log)
    picks = find_highlights(src, transcript, meta, info["duration"], log)
    log(f"Picked {len(picks)} moment(s)")

    clips = []
    for n, pick in enumerate(picks, 1):
        name = f"clip_{n:02d}"
        log(f"Rendering {name} ({pick['start']:.0f}s → {pick['end']:.0f}s)…")
        plan = plan_reframe(src, pick["start"], pick["end"])
        ass = job_dir / f"{name}.ass"
        write_ass(ass, transcript, pick["start"], pick["end"], hook=pick.get("title", ""))
        out = job_dir / f"{name}.mp4"
        render_clip(src, out, pick["start"], pick["end"], plan, ass.name, info)
        clips.append({**pick, "file": str(out), "layout": plan["mode"],
                      "post_text": post_text(pick, meta), "posted": {}})
        log(f"✓ {name}.mp4 ready ({plan['mode']} layout)")

    for clip in clips:
        for platform in post_to:
            try:
                if platform == "instagram":
                    from .publish_instagram import post_reel
                    result = post_reel(Path(clip["file"]), clip["post_text"], log)
                elif platform == "tiktok":
                    from .publish_tiktok import post_video
                    result = post_video(Path(clip["file"]), clip["post_text"], log)
                else:
                    continue
                clip["posted"][platform] = result
                log(f"✓ {Path(clip['file']).name} → {platform}: {result}")
            except Exception as e:
                clip["posted"][platform] = f"FAILED: {e}"
                log(f"✗ {Path(clip['file']).name} → {platform}: {e}")

    summary = {"source": source, "meta": meta, "folder": str(job_dir), "clips": clips}
    (job_dir / "clips.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"Done. Files are in {job_dir}")
    return summary
