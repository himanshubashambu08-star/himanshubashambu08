"""Step 1: download the source video with yt-dlp (or accept a local file)."""
from pathlib import Path

from .config import env


def fetch_source(url_or_path: str, out_dir: Path, log=print) -> tuple[Path, dict]:
    local = Path(url_or_path).expanduser()
    if local.is_file():
        log(f"Using local file {local.name}")
        return local, {"title": local.stem, "uploader": "", "webpage_url": ""}

    from yt_dlp import YoutubeDL

    opts = {
        # best quality up to 1080p, merged into one mp4
        "format": "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
        "merge_output_format": "mp4",
        "outtmpl": str(out_dir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    browser = env("YTDLP_COOKIES_FROM_BROWSER")
    if browser:
        opts["cookiesfrombrowser"] = (browser,)

    log("Downloading video…")
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url_or_path, download=True)
    files = sorted(out_dir.glob("source.*"), key=lambda p: p.stat().st_size, reverse=True)
    if not files:
        raise RuntimeError("Download finished but no video file was written")
    log(f"Downloaded: {info.get('title')} ({int(info.get('duration') or 0)}s)")
    return files[0], {
        "title": info.get("title") or "",
        "uploader": info.get("uploader") or info.get("channel") or "",
        "webpage_url": info.get("webpage_url") or url_or_path,
    }
