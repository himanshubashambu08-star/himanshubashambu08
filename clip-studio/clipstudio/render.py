"""Step 6: cut, reframe to 1080x1920, burn captions, normalise audio -> H.264 MP4."""
import json
import subprocess
import tempfile
from pathlib import Path


def probe(video: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height:format=duration", "-of", "json", str(video)],
        capture_output=True, text=True, check=True,
    ).stdout
    data = json.loads(out)
    s = data["streams"][0]
    return {"width": int(s["width"]), "height": int(s["height"]),
            "duration": float(data["format"]["duration"])}


def render_clip(src: Path, out: Path, start: float, end: float, plan: dict,
                ass_name: str | None, info: dict, on_progress=lambda f: None) -> None:
    w, h = info["width"], info["height"]
    subs = f",ass={ass_name}" if ass_name else ""

    if plan["mode"] == "crop":
        cw = int(h * 9 / 16) // 2 * 2
        x = int(min(max(plan["cx"] * w - cw / 2, 0), w - cw))
        graph = f"[0:v]crop={cw}:{h}:{x}:0,scale=1080:1920,setsar=1{subs}[v]"
    elif plan["mode"] == "vertical":
        graph = (f"[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
                 f"pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1{subs}[v]")
    else:  # fit: full frame on top of a blurred, zoomed copy
        graph = (
            "[0:v]split[a][b];"
            "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
            "gblur=sigma=40,eq=brightness=-0.12[bg];"
            "[b]scale=1080:-2[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1{subs}[v]"
        )

    cmd = [
        "ffmpeg", "-y", "-v", "error", "-nostats", "-progress", "pipe:1",
        "-ss", f"{start:.2f}", "-t", f"{end - start:.2f}", "-i", str(src.resolve()),
        "-filter_complex", graph, "-map", "[v]", "-map", "0:a?",
        "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-profile:v", "high",
        "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
        "-movflags", "+faststart", out.name,
    ]
    # run inside the clip folder so the .ass path needs no escaping
    # stderr goes to a temp file so a chatty error can't fill the pipe and block ffmpeg
    with tempfile.TemporaryFile("w+", encoding="utf-8", errors="replace") as err:
        proc = subprocess.Popen(cmd, cwd=out.parent, stdout=subprocess.PIPE, stderr=err,
                                text=True, encoding="utf-8", errors="replace")
        for line in proc.stdout:  # "-progress" prints key=value lines, out_time_us is position
            if line.startswith("out_time_us=") and line[12:].strip().isdigit():
                on_progress(min(int(line[12:]) / 1e6 / (end - start), 1))
        if proc.wait() != 0:
            err.seek(0)
            raise RuntimeError(f"ffmpeg failed: {err.read().strip()[-600:]}")
