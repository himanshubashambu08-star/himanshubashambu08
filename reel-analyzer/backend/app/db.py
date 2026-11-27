"""SQLite storage for reels and their follow-up chats."""
import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager

from .config import DB_PATH

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS reels (
    id TEXT PRIMARY KEY,
    created_at REAL NOT NULL,
    source_type TEXT NOT NULL,          -- 'link' | 'upload'
    source_url TEXT,
    platform TEXT,                      -- instagram | tiktok | youtube | upload | other
    title TEXT,
    tags TEXT NOT NULL DEFAULT '[]',    -- JSON list
    status TEXT NOT NULL,               -- queued | processing | done | error
    stage TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    duration REAL,
    uploader TEXT,
    language TEXT,
    transcript TEXT,
    frames TEXT NOT NULL DEFAULT '[]',  -- JSON list of {file, t}
    analysis TEXT,                      -- JSON
    options TEXT NOT NULL DEFAULT '{}'  -- JSON {language, currency}
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_id TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_reel ON messages(reel_id, id);
"""

JSON_COLS = {"tags", "frames", "analysis", "options"}


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def connect():
    with _lock:
        conn = _connect()
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()


def init() -> None:
    with connect() as c:
        c.executescript(SCHEMA)
        # Anything that was mid-flight when the server stopped will never finish.
        c.execute(
            "UPDATE reels SET status='error', error='The server restarted while this video was processing. Delete it and try again.' "
            "WHERE status IN ('queued','processing')"
        )


def _row(r: sqlite3.Row | None) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    for k in JSON_COLS:
        if d.get(k):
            d[k] = json.loads(d[k])
    return d


def create_reel(source_type: str, source_url: str | None, platform: str, title: str, options: dict) -> str:
    rid = uuid.uuid4().hex[:12]
    with connect() as c:
        c.execute(
            "INSERT INTO reels (id, created_at, source_type, source_url, platform, title, status, stage, progress, options) "
            "VALUES (?,?,?,?,?,?, 'queued', 'Waiting to start', 0, ?)",
            (rid, time.time(), source_type, source_url, platform, title, json.dumps(options)),
        )
    return rid


def update_reel(rid: str, **fields) -> None:
    if not fields:
        return
    cols, vals = [], []
    for k, v in fields.items():
        cols.append(f"{k} = ?")
        vals.append(json.dumps(v, ensure_ascii=False) if k in JSON_COLS else v)
    with connect() as c:
        c.execute(f"UPDATE reels SET {', '.join(cols)} WHERE id = ?", (*vals, rid))


def get_reel(rid: str) -> dict | None:
    with connect() as c:
        return _row(c.execute("SELECT * FROM reels WHERE id = ?", (rid,)).fetchone())


def list_reels(q: str = "", tag: str = "", platform: str = "", status: str = "") -> list[dict]:
    sql = (
        "SELECT id, created_at, source_type, source_url, platform, title, tags, status, stage, progress, "
        "error, duration, uploader, language, frames FROM reels WHERE 1=1"
    )
    args: list = []
    if q:
        like = f"%{q.lower()}%"
        sql += " AND (lower(title) LIKE ? OR lower(tags) LIKE ? OR lower(coalesce(transcript,'')) LIKE ? OR lower(coalesce(analysis,'')) LIKE ? OR lower(coalesce(uploader,'')) LIKE ?)"
        args += [like] * 5
    if tag:
        sql += " AND lower(tags) LIKE ?"
        args.append(f'%"{tag.lower()}"%')
    if platform:
        sql += " AND platform = ?"
        args.append(platform)
    if status:
        sql += " AND status = ?"
        args.append(status)
    sql += " ORDER BY created_at DESC"
    with connect() as c:
        rows = [_row(r) for r in c.execute(sql, args).fetchall()]
    for r in rows:
        frames = r.pop("frames", None) or []
        r["thumbnail"] = frames[0]["file"] if frames else None
    return rows


def all_tags() -> list[dict]:
    counts: dict[str, int] = {}
    with connect() as c:
        for (tags,) in c.execute("SELECT tags FROM reels WHERE status='done'"):
            for t in json.loads(tags or "[]"):
                counts[t] = counts.get(t, 0) + 1
    return [{"tag": t, "count": n} for t, n in sorted(counts.items(), key=lambda x: (-x[1], x[0]))]


def delete_reel(rid: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM reels WHERE id = ?", (rid,))


def add_message(rid: str, role: str, content: str) -> None:
    with connect() as c:
        c.execute(
            "INSERT INTO messages (reel_id, role, content, created_at) VALUES (?,?,?,?)",
            (rid, role, content, time.time()),
        )


def get_messages(rid: str) -> list[dict]:
    with connect() as c:
        return [dict(r) for r in c.execute("SELECT role, content, created_at FROM messages WHERE reel_id = ? ORDER BY id", (rid,))]


def clear_messages(rid: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM messages WHERE reel_id = ?", (rid,))
