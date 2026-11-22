"""Post a Reel through the Instagram API (Instagram Login, Business or Creator account).

Flow: create a REELS container with resumable upload -> upload the file bytes ->
wait until Instagram has processed it -> publish.
"""
import time
from pathlib import Path

import requests

from .config import env, load_tokens, save_tokens

REFRESH_AFTER_DAYS = 20  # long-lived tokens last 60 days; refresh well before


def _host() -> str:
    return f"https://{env('IG_GRAPH_HOST', 'graph.instagram.com')}/{env('IG_API_VERSION', 'v23.0')}"


def _token() -> str:
    tokens = load_tokens()
    token = tokens.get("ig_access_token") or env("IG_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("Instagram is not set up: add IG_ACCESS_TOKEN to .env")
    age_days = (time.time() - tokens.get("ig_refreshed_at", 0)) / 86400
    if "graph.instagram.com" in _host() and age_days > REFRESH_AFTER_DAYS:
        r = requests.get("https://graph.instagram.com/refresh_access_token",
                         params={"grant_type": "ig_refresh_token", "access_token": token}, timeout=30)
        if r.ok and r.json().get("access_token"):
            token = r.json()["access_token"]
            save_tokens({"ig_access_token": token, "ig_refreshed_at": time.time()})
    return token


def _check(r: requests.Response) -> dict:
    try:
        data = r.json()
    except ValueError:
        data = {}
    if not r.ok or "error" in data:
        msg = data.get("error", {}).get("message") if isinstance(data.get("error"), dict) else r.text
        raise RuntimeError(f"Instagram API error ({r.status_code}): {msg}")
    return data


def _user_id(token: str) -> str:
    if env("IG_USER_ID"):
        return env("IG_USER_ID")
    data = _check(requests.get(f"{_host()}/me", params={"fields": "user_id,id,username",
                                                        "access_token": token}, timeout=30))
    return str(data.get("user_id") or data["id"])


def post_reel(video: Path, caption: str, log=print) -> str:
    token = _token()
    user = _user_id(token)

    container = _check(requests.post(
        f"{_host()}/{user}/media",
        data={"media_type": "REELS", "upload_type": "resumable", "caption": caption[:2200],
              "share_to_feed": "true", "access_token": token},
        timeout=60,
    ))
    cid = container["id"]
    upload_uri = container.get("uri") or \
        f"https://rupload.facebook.com/ig-api-upload/{env('IG_API_VERSION', 'v23.0')}/{cid}"

    log("Instagram: uploading…")
    size = video.stat().st_size
    with video.open("rb") as f:
        _check(requests.post(upload_uri, data=f, timeout=600, headers={
            "Authorization": f"OAuth {token}", "offset": "0", "file_size": str(size)}))

    log("Instagram: processing…")
    for _ in range(60):  # up to ~10 minutes
        status = _check(requests.get(f"{_host()}/{cid}", params={
            "fields": "status_code,status", "access_token": token}, timeout=30))
        code = status.get("status_code")
        if code == "FINISHED":
            break
        if code in ("ERROR", "EXPIRED"):
            raise RuntimeError(f"Instagram could not process the video: {status.get('status')}")
        time.sleep(10)
    else:
        raise RuntimeError("Instagram took too long to process the video")

    published = _check(requests.post(f"{_host()}/{user}/media_publish",
                                     data={"creation_id": cid, "access_token": token}, timeout=60))
    media_id = published["id"]
    try:
        link = _check(requests.get(f"{_host()}/{media_id}", params={
            "fields": "permalink", "access_token": token}, timeout=30)).get("permalink")
    except RuntimeError:
        link = None
    return link or f"instagram media {media_id}"
