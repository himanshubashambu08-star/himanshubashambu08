import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # reel-analyzer/

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / "backend" / ".env")
except ImportError:
    pass


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, "").strip() or default


DATA_DIR = Path(env("DATA_DIR", str(ROOT / "data"))).resolve()
REELS_DIR = DATA_DIR / "reels"
DB_PATH = DATA_DIR / "reels.db"
FRONTEND_DIST = ROOT / "frontend" / "dist"

CLAUDE_MODEL = env("CLAUDE_MODEL", "claude-opus-5-5")
WHISPER_MODEL = env("WHISPER_MODEL", "whisper-1")
MAX_UPLOAD_MB = int(env("MAX_UPLOAD_MB", "200"))
MAX_FRAMES = 20
MAX_VIDEO_SECONDS = 15 * 60  # reels are short; refuse very long videos

REELS_DIR.mkdir(parents=True, exist_ok=True)
