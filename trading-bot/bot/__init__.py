"""Trading bot package."""
import subprocess
import os

VERSION = "4.5"          # bump on every release that changes behaviour


def build():
    """Short git commit of the running code, so the dashboard shows exactly what is deployed."""
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        out = subprocess.run(["git", "-C", here, "log", "-1", "--format=%h %cd", "--date=format:%d %b %H:%M"],
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or None
    except Exception:
        return None
