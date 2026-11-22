"""Send a video to TikTok through the Content Posting API.

TIKTOK_MODE=draft  -> lands in the TikTok app inbox, you tap Post (scope video.upload).
TIKTOK_MODE=direct -> posts immediately (scope video.publish). Until TikTok audits your
                      app, direct posts can only be private (SELF_ONLY).
"""
import math
import secrets
import time
import urllib.parse
from pathlib import Path

import requests

from .config import env, load_tokens, save_tokens

API = "https://open.tiktokapis.com/v2"
CHUNK = 10 * 1024 * 1024  # 10 MB; TikTok allows 5-64 MB chunks


def _save(data: dict) -> None:
    save_tokens({
        "tiktok_access_token": data["access_token"],
        "tiktok_refresh_token": data.get("refresh_token", load_tokens().get("tiktok_refresh_token")),
        "tiktok_expires_at": time.time() + int(data.get("expires_in", 86400)) - 300,
    })


def login_url() -> tuple[str, str]:
    state = secrets.token_urlsafe(16)
    scope = "user.info.basic,video.upload,video.publish"
    q = urllib.parse.urlencode({"client_key": env("TIKTOK_CLIENT_KEY"), "scope": scope,
                                "response_type": "code", "redirect_uri": env("TIKTOK_REDIRECT_URI"),
                                "state": state})
    return f"https://www.tiktok.com/v2/auth/authorize/?{q}", state


def exchange_code(code: str) -> None:
    r = requests.post(f"{API}/oauth/token/", timeout=30, data={
        "client_key": env("TIKTOK_CLIENT_KEY"), "client_secret": env("TIKTOK_CLIENT_SECRET"),
        "code": code, "grant_type": "authorization_code",
        "redirect_uri": env("TIKTOK_REDIRECT_URI")})
    data = r.json()
    if "access_token" not in data:
        raise RuntimeError(f"TikTok login failed: {data}")
    _save(data)


def _token() -> str:
    tokens = load_tokens()
    if tokens.get("tiktok_access_token") and time.time() < tokens.get("tiktok_expires_at", 0):
        return tokens["tiktok_access_token"]
    refresh = tokens.get("tiktok_refresh_token")
    if not refresh:
        raise RuntimeError("TikTok is not connected: run `python run.py tiktok-login`")
    r = requests.post(f"{API}/oauth/token/", timeout=30, data={
        "client_key": env("TIKTOK_CLIENT_KEY"), "client_secret": env("TIKTOK_CLIENT_SECRET"),
        "grant_type": "refresh_token", "refresh_token": refresh})
    data = r.json()
    if "access_token" not in data:
        raise RuntimeError(f"TikTok token refresh failed, run `python run.py tiktok-login` again: {data}")
    _save(data)
    return data["access_token"]


def _call(path: str, token: str, body: dict) -> dict:
    r = requests.post(f"{API}{path}", json=body, timeout=60, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"})
    data = r.json()
    err = data.get("error", {})
    if err.get("code") not in (None, "ok"):
        raise RuntimeError(f"TikTok API error: {err.get('code')} {err.get('message')}")
    return data.get("data", {})


def post_video(video: Path, caption: str, log=print) -> str:
    token = _token()
    size = video.stat().st_size
    chunk = size if size <= 64 * 1024 * 1024 else CHUNK
    count = max(1, math.floor(size / chunk))  # remainder rides on the last chunk
    source = {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": chunk,
              "total_chunk_count": count}

    direct = env("TIKTOK_MODE", "draft").lower() == "direct"
    if direct:
        creator = _call("/post/publish/creator_info/query/", token, {})
        wanted = env("TIKTOK_PRIVACY", "SELF_ONLY")
        options = creator.get("privacy_level_options", [wanted])
        privacy = wanted if wanted in options else options[0]
        init = _call("/post/publish/video/init/", token, {
            "post_info": {"title": caption[:2200], "privacy_level": privacy,
                          "disable_comment": False, "disable_duet": False, "disable_stitch": False},
            "source_info": source})
    else:
        init = _call("/post/publish/inbox/video/init/", token, {"source_info": source})

    log("TikTok: uploading…")
    with video.open("rb") as f:
        for i in range(count):
            first = i * chunk
            last = size - 1 if i == count - 1 else first + chunk - 1
            body = f.read(last - first + 1)
            r = requests.put(init["upload_url"], data=body, timeout=600, headers={
                "Content-Type": "video/mp4", "Content-Length": str(len(body)),
                "Content-Range": f"bytes {first}-{last}/{size}"})
            if r.status_code not in (200, 201, 206):
                raise RuntimeError(f"TikTok upload failed ({r.status_code}): {r.text[:200]}")

    publish_id = init["publish_id"]
    log("TikTok: processing…")
    for _ in range(60):
        status = _call("/post/publish/status/fetch/", token, {"publish_id": publish_id})
        state = status.get("status")
        if state == "PUBLISH_COMPLETE":
            private = direct and env("TIKTOK_PRIVACY", "SELF_ONLY") == "SELF_ONLY"
            return "TikTok: posted" + (" (private until your app is audited)" if private else "")
        if state == "SEND_TO_USER_INBOX":
            return "TikTok: in your inbox, open TikTok and tap Post (add the caption there)"
        if state == "FAILED":
            raise RuntimeError(f"TikTok rejected the video: {status.get('fail_reason')}")
        time.sleep(5)
    return f"TikTok: still processing (publish_id {publish_id})"
