import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "output"
TOKENS_FILE = ROOT / "tokens.json"

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:  # dotenv is optional
    pass


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, "").strip() or default


def env_int(name: str, default: int) -> int:
    try:
        return int(env(name, str(default)))
    except ValueError:
        return default


def load_tokens() -> dict:
    try:
        return json.loads(TOKENS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_tokens(update: dict) -> None:
    tokens = load_tokens()
    tokens.update(update)
    TOKENS_FILE.write_text(json.dumps(tokens, indent=2), encoding="utf-8")
    try:
        TOKENS_FILE.chmod(0o600)
    except OSError:
        pass
