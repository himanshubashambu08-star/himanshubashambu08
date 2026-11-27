"""Reel Analyzer API + static frontend."""
import json
import logging
import shutil
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import db, pipeline
from .analyze import chat_stream
from .config import CLAUDE_MODEL, FRONTEND_DIST, MAX_UPLOAD_MB, env
from .media import UserFacingError, detect_platform, extract_url

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="Reel Analyzer")
db.init()

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".3gp", ".avi"}
UPLOAD_PATHS = {"/api/reels/upload", "/share"}


@app.middleware("http")
async def limit_upload_size(request: Request, call_next):
    if request.method == "POST" and request.url.path in UPLOAD_PATHS:
        length = request.headers.get("content-length")
        if length and int(length) > (MAX_UPLOAD_MB + 1) * 1024 * 1024:
            return JSONResponse({"detail": f"That file is too big. The limit is {MAX_UPLOAD_MB} MB."}, status_code=413)
    return await call_next(request)


@app.exception_handler(UserFacingError)
async def user_error(_: Request, exc: UserFacingError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


# ---------- helpers ----------

def _options(language: str, currency: str, title: str = "") -> dict:
    # A title the user typed is kept; otherwise Claude's suggested title replaces the placeholder.
    return {"language": language or "auto", "currency": (currency or "auto")[:12], "title_locked": bool(title.strip())}


def _get_or_404(rid: str) -> dict:
    reel = db.get_reel(rid)
    if not reel:
        raise HTTPException(404, "Reel not found")
    return reel


def _start_link(url: str, title: str, language: str, currency: str) -> str:
    url = extract_url(url) or ""
    if not url:
        raise UserFacingError("That doesn't look like a link. Paste a full Instagram, TikTok or YouTube Shorts URL (starting with https://).")
    rid = db.create_reel("link", url, detect_platform(url), title.strip(), _options(language, currency, title))
    pipeline.submit(rid, url=url)
    return rid


async def _start_upload(file: UploadFile, title: str, language: str, currency: str) -> str:
    name = file.filename or "video.mp4"
    ext = Path(name).suffix.lower()
    if ext not in VIDEO_EXTS and not (file.content_type or "").startswith("video/"):
        raise UserFacingError("Please upload a video file (MP4, MOV, WEBM or a screen recording).")
    rid = db.create_reel("upload", None, "upload", title.strip() or Path(name).stem[:80], _options(language, currency, title))
    work = pipeline.reel_dir(rid)
    work.mkdir(parents=True, exist_ok=True)
    dest = work / f"upload{ext if ext in VIDEO_EXTS else '.mp4'}"
    limit, size = MAX_UPLOAD_MB * 1024 * 1024, 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                out.close()
                shutil.rmtree(work, ignore_errors=True)
                db.delete_reel(rid)
                raise HTTPException(413, f"That file is too big. The limit is {MAX_UPLOAD_MB} MB.")
            out.write(chunk)
    if size == 0:
        shutil.rmtree(work, ignore_errors=True)
        db.delete_reel(rid)
        raise UserFacingError("The uploaded file is empty.")
    pipeline.submit(rid, uploaded=dest)
    return rid


# ---------- API ----------

@app.get("/api/health")
def health():
    return {
        "claude": bool(env("ANTHROPIC_API_KEY") or env("ANTHROPIC_AUTH_TOKEN")),
        "whisper": bool(env("OPENAI_API_KEY")),
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "model": CLAUDE_MODEL,
        "max_upload_mb": MAX_UPLOAD_MB,
    }


class LinkIn(BaseModel):
    url: str = Field(max_length=2000)
    title: str = Field(default="", max_length=200)
    language: str = "auto"
    currency: str = "auto"


@app.post("/api/reels/link")
def submit_link(body: LinkIn):
    return {"id": _start_link(body.url, body.title, body.language, body.currency)}


@app.post("/api/reels/upload")
async def submit_upload(
    file: UploadFile = File(...),
    title: str = Form(""),
    language: str = Form("auto"),
    currency: str = Form("auto"),
):
    return {"id": await _start_upload(file, title, language, currency)}


@app.get("/api/reels")
def list_reels(q: str = "", tag: str = "", platform: str = "", status: str = ""):
    return db.list_reels(q.strip(), tag.strip(), platform.strip(), status.strip())


@app.get("/api/tags")
def tags():
    return db.all_tags()


@app.get("/api/reels/{rid}")
def get_reel(rid: str):
    return _get_or_404(rid)


@app.get("/api/reels/{rid}/status")
def get_status(rid: str):
    r = _get_or_404(rid)
    return {k: r.get(k) for k in ("id", "status", "stage", "progress", "error")}


class PatchIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    tags: list[str] | None = None


@app.patch("/api/reels/{rid}")
def patch_reel(rid: str, body: PatchIn):
    _get_or_404(rid)
    fields = {}
    if body.title is not None:
        fields["title"] = body.title.strip()
    if body.tags is not None:
        fields["tags"] = sorted({t.strip().lower()[:40] for t in body.tags if t.strip()})[:20]
    db.update_reel(rid, **fields)
    return db.get_reel(rid)


@app.post("/api/reels/{rid}/retry")
def retry(rid: str):
    r = _get_or_404(rid)
    if r["status"] in ("queued", "processing"):
        raise UserFacingError("This video is still processing.")
    work = pipeline.reel_dir(rid)
    db.update_reel(rid, status="queued", stage="Waiting to start", progress=0, error=None)
    if r["source_url"]:
        pipeline.submit(rid, url=r["source_url"])
    else:
        uploads = list(work.glob("upload.*"))
        if not uploads:
            db.update_reel(rid, status="error", error="The original upload is gone. Upload the file again.")
            raise UserFacingError("The original upload is gone. Upload the file again.")
        pipeline.submit(rid, uploaded=uploads[0])
    return {"id": rid}


@app.delete("/api/reels/{rid}")
def delete_reel(rid: str):
    _get_or_404(rid)
    db.delete_reel(rid)
    shutil.rmtree(pipeline.reel_dir(rid), ignore_errors=True)
    return {"ok": True}


@app.get("/api/reels/{rid}/messages")
def messages(rid: str):
    _get_or_404(rid)
    return db.get_messages(rid)


@app.delete("/api/reels/{rid}/messages")
def clear_messages(rid: str):
    _get_or_404(rid)
    db.clear_messages(rid)
    return {"ok": True}


class ChatIn(BaseModel):
    question: str = Field(min_length=1, max_length=4000)


@app.post("/api/reels/{rid}/chat")
def chat(rid: str, body: ChatIn):
    reel = _get_or_404(rid)
    if reel["status"] != "done":
        raise UserFacingError("Wait for the analysis to finish before asking questions.")
    history = db.get_messages(rid)
    question = body.question.strip()

    def events():
        final = ""
        try:
            for ev in chat_stream(pipeline.reel_dir(rid) / "frames", reel, history, question):
                if ev["type"] == "final":
                    final = ev["text"]
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            db.add_message(rid, "user", question)
            db.add_message(rid, "assistant", final)
        except UserFacingError as e:
            yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"
        except Exception as e:  # noqa: BLE001
            logging.exception("chat failed")
            yield f"data: {json.dumps({'type': 'error', 'text': f'Something went wrong: {e}'})}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/media/{rid}/{name}")
def media(rid: str, name: str):
    if "/" in name or ".." in name or not name.endswith(".jpg"):
        raise HTTPException(404)
    path = pipeline.reel_dir(rid) / "frames" / name
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


# ---------- PWA share target ----------

@app.post("/share")
async def share_target(
    request: Request,
    title: str = Form(""),
    text: str = Form(""),
    url: str = Form(""),
    video: UploadFile | None = File(None),
):
    """Android 'Share to Reel Analyzer' lands here (see manifest share_target)."""
    try:
        if video is not None and video.filename:
            rid = await _start_upload(video, "", "auto", "auto")
        else:
            link = extract_url(url) or extract_url(text) or extract_url(title)
            if not link:
                return RedirectResponse("/?share_error=no-link", status_code=303)
            rid = _start_link(link, "", "auto", "auto")
    except (UserFacingError, HTTPException) as e:
        msg = getattr(e, "detail", None) or str(e)
        from urllib.parse import quote

        return RedirectResponse(f"/?share_error={quote(str(msg))}", status_code=303)
    return RedirectResponse(f"/reel/{rid}", status_code=303)


# ---------- frontend ----------

if FRONTEND_DIST.exists():
    @app.get("/{path:path}")
    def spa(path: str):
        if path.startswith(("api/", "media/")):
            raise HTTPException(404)
        candidate = (FRONTEND_DIST / path).resolve()
        if path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
            headers = {"Cache-Control": "no-cache"} if candidate.name in ("sw.js", "manifest.webmanifest") else None
            return FileResponse(candidate, headers=headers)
        return FileResponse(FRONTEND_DIST / "index.html", headers={"Cache-Control": "no-cache"})
