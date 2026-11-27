"""Download (yt-dlp), probe, frame and audio extraction (ffmpeg)."""
import json
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from .config import MAX_FRAMES, MAX_UPLOAD_MB, MAX_VIDEO_SECONDS, env


class UserFacingError(Exception):
    """An error whose message is safe and useful to show in the UI."""


def require_tools() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise UserFacingError(f"{tool} is not installed on the server. Install ffmpeg and restart.")


def detect_platform(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if "instagram.com" in host:
        return "instagram"
    if "tiktok.com" in host:
        return "tiktok"
    if "youtube.com" in host or "youtu.be" in host:
        return "youtube"
    if "facebook.com" in host or "fb.watch" in host:
        return "facebook"
    return "other"


URL_RE = re.compile(r"https?://[^\s<>\"']+")


def extract_url(text: str) -> str | None:
    """Pull the first link out of shared text like 'Check this out! https://...'."""
    m = URL_RE.search(text or "")
    return m.group(0).rstrip(").,!") if m else None


def _friendly_download_error(msg: str, platform: str) -> str:
    m = msg.lower()
    if "unsupported url" in m:
        return "That link isn't a video we can download. Paste the link to the reel/short itself (not a profile or search page)."
    if "private" in m:
        return "This video is private. Only public videos can be downloaded — or download it on your phone and upload the file instead."
    if any(s in m for s in ("login required", "log in", "sign in", "cookies", "rate-limit", "rate limit", "empty media response")):
        if platform == "instagram":
            return (
                "Instagram blocked the download (it wants a logged-in session). Set YTDLP_COOKIES_FILE on the server "
                "(see README), or save the reel on your phone and upload the file instead."
            )
        return "The site asked for a login before letting us download. Upload the video file instead, or configure cookies (see README)."
    if any(s in m for s in ("not available", "removed", "deleted", "does not exist", "404")):
        return "This video isn't available any more — it may have been deleted or the link is wrong."
    if "geo" in m or "your country" in m:
        return "This video is blocked in the server's country. Upload the file instead."
    if "age" in m and "restrict" in m:
        return "This video is age-restricted, so it can't be downloaded without a login. Upload the file instead."
    if any(s in m for s in ("timed out", "connection", "network", "resolve", "unreachable")):
        return "Couldn't reach the site to download the video. Check the server's internet connection and try again."
    return f"Couldn't download this link. Try uploading the video file instead. (Details: {msg.strip()[:300]})"


def download(url: str, out_dir: Path, log=print) -> tuple[Path, dict]:
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    platform = detect_platform(url)
    opts = {
        "format": "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
        "merge_output_format": "mp4",
        "outtmpl": str(out_dir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "max_filesize": MAX_UPLOAD_MB * 1024 * 1024,
        "socket_timeout": 30,
        "retries": 2,
    }
    cookies_file = env("YTDLP_COOKIES_FILE")
    if cookies_file:
        opts["cookiefile"] = cookies_file
    browser = env("YTDLP_COOKIES_FROM_BROWSER")
    if browser:
        opts["cookiesfrombrowser"] = (browser,)

    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get("_type") == "playlist":
                entries = [e for e in (info.get("entries") or []) if e]
                if not entries:
                    raise UserFacingError("That link has no videos in it.")
                info = entries[0]
            duration = info.get("duration") or 0
            if duration and duration > MAX_VIDEO_SECONDS:
                raise UserFacingError(
                    f"This video is {int(duration // 60)} minutes long. Reel Analyzer is built for short videos (up to {MAX_VIDEO_SECONDS // 60} minutes)."
                )
            log(f"Downloading from {platform}…")
            info = ydl.process_ie_result(info, download=True)
    except DownloadError as e:
        raise UserFacingError(_friendly_download_error(str(e), platform)) from e

    files = [p for p in out_dir.glob("source.*") if p.suffix not in (".part", ".ytdl")]
    files.sort(key=lambda p: p.stat().st_size, reverse=True)
    if not files:
        raise UserFacingError(
            "The download finished but no video came back (this can happen with photo posts or carousels). Upload the video file instead."
        )
    return files[0], {
        "title": info.get("title") or info.get("description", "")[:80] or "",
        "uploader": info.get("uploader") or info.get("channel") or info.get("uploader_id") or "",
        "description": (info.get("description") or "")[:2000],
    }


def probe(video: Path) -> dict:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(video)],
            capture_output=True, text=True, timeout=60, check=True,
        ).stdout
    except subprocess.CalledProcessError as e:
        raise UserFacingError("This file doesn't look like a video we can read. Try an MP4 or MOV.") from e
    data = json.loads(out or "{}")
    streams = data.get("streams") or []
    if not any(s.get("codec_type") == "video" for s in streams):
        raise UserFacingError("This file has no video track. Upload an MP4, MOV or screen recording.")
    duration = float((data.get("format") or {}).get("duration") or 0)
    if duration > MAX_VIDEO_SECONDS:
        raise UserFacingError(
            f"This video is {int(duration // 60)} minutes long. Reel Analyzer is built for short videos (up to {MAX_VIDEO_SECONDS // 60} minutes)."
        )
    return {"duration": duration, "has_audio": any(s.get("codec_type") == "audio" for s in streams)}


def frame_times(duration: float) -> list[float]:
    """One frame every 1-2 s, capped at MAX_FRAMES spread evenly over longer videos."""
    if duration <= 0:
        return [0.0]
    interval = 1.0 if duration <= MAX_FRAMES else 2.0
    if duration / interval > MAX_FRAMES:
        interval = duration / MAX_FRAMES
    times, t = [], min(0.3, duration / 2)
    while t < duration - 0.05 and len(times) < MAX_FRAMES:
        times.append(round(t, 2))
        t += interval
    return times or [0.0]


def extract_frames(video: Path, out_dir: Path, duration: float) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for i, t in enumerate(frame_times(duration)):
        path = out_dir / f"frame_{i:02d}.jpg"
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t}", "-i", str(video), "-frames:v", "1",
                # Long side 1024px keeps on-screen text readable while staying cheap for vision
                "-vf", "scale='if(gt(iw,ih),min(1024,iw),-2)':'if(gt(iw,ih),-2,min(1024,ih))'",
                "-q:v", "4", str(path),
            ],
            capture_output=True, timeout=60,
        )
        if path.exists() and path.stat().st_size > 0:
            frames.append({"file": path.name, "t": t})
    if not frames:
        raise UserFacingError("Couldn't read any frames from this video. The file may be corrupted.")
    return frames


def extract_audio(video: Path, out: Path) -> Path | None:
    """Mono 16 kHz MP3 — small enough for Whisper's 25 MB limit on short videos."""
    r = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", str(out)],
        capture_output=True, timeout=300,
    )
    if r.returncode != 0 or not out.exists() or out.stat().st_size < 1000:
        return None
    return out
