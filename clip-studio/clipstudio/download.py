"""Step 1: download the source video with yt-dlp (or accept a local file)."""
import shutil
import threading
from pathlib import Path

from .config import env, env_int


def fetch_source(url_or_path: str, out_dir: Path, log=print, on_progress=lambda f: None) -> tuple[Path, dict]:
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
        "noprogress": True,
        # ponytail: video and audio download separately, so the bar runs twice; fine for a rough bar
        "progress_hooks": [lambda d: d.get("status") == "downloading" and (
            d.get("total_bytes") or d.get("total_bytes_estimate")) and on_progress(
            d.get("downloaded_bytes", 0) / (d.get("total_bytes") or d["total_bytes_estimate"]))],
    }
    # Without a JS runtime YouTube hands yt-dlp formats that can stall at 0 bytes.
    if shutil.which("node"):
        opts["js_runtimes"] = {"node": {"path": None}}
    browser = env("YTDLP_COOKIES_FROM_BROWSER")
    if browser:
        opts["cookiesfrombrowser"] = (browser,)

    log("Downloading video…")
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url_or_path, download=False)
        duration = info.get("duration") or 0
        cap = env_int("MAX_SOURCE_MINUTES", 20) * 60
        done = threading.Event()
        if cap and duration > cap:
            log(f"Video is {duration // 60} min long; using only the first {cap // 60} min "
                f"(change MAX_SOURCE_MINUTES in .env)")
            ydl.params["download_ranges"] = lambda *_: [{"start_time": 0, "end_time": cap}]
            # ranged downloads go through ffmpeg and report no progress, so watch the file grow
            full = sum(f.get("filesize") or f.get("filesize_approx") or 0
                       for f in info.get("requested_formats") or [info])
            expected = full * cap / duration if full else 0

            def watch():
                while expected and not done.wait(2):
                    got = sum(p.stat().st_size for p in out_dir.glob("source.*") if p.is_file())
                    on_progress(min(got / expected, 0.99))

            threading.Thread(target=watch, daemon=True).start()
        try:
            info = ydl.process_ie_result(info, download=True)
        finally:
            done.set()
    files = sorted(out_dir.glob("source.*"), key=lambda p: p.stat().st_size, reverse=True)
    if not files:
        raise RuntimeError("Download finished but no video file was written")
    log(f"Downloaded: {info.get('title')} ({int(min(duration, cap) if cap and duration > cap else duration)}s)")
    return files[0], {
        "title": info.get("title") or "",
        "uploader": info.get("uploader") or info.get("channel") or "",
        "webpage_url": info.get("webpage_url") or url_or_path,
    }
