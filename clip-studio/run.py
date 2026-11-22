"""Clip Studio.

  python run.py                         open the one-button web app (http://localhost:8000)
  python run.py --phone                 same, reachable from your phone on the same Wi-Fi
  python run.py clip <link> [--post instagram,tiktok]
  python run.py tiktok-login            connect your TikTok account once
  python run.py check                   show what is set up
"""
import argparse
import shutil
import socket
import sys
import urllib.parse


def cmd_web(args):
    from clipstudio.web import app

    host = "0.0.0.0" if args.phone else "127.0.0.1"
    if args.phone:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
        except OSError:
            ip = "<your-computer-ip>"
        finally:
            s.close()
        print(f"\n  Open on your phone:  http://{ip}:{args.port}\n")
    else:
        print(f"\n  Open:  http://localhost:{args.port}\n")
    app.run(host=host, port=args.port, threaded=True)


def cmd_clip(args):
    from clipstudio import pipeline

    post_to = [p.strip() for p in (args.post or "").split(",") if p.strip()]
    pipeline.run(args.url, post_to)


def cmd_tiktok_login(_args):
    from clipstudio.config import env
    from clipstudio.publish_tiktok import exchange_code, login_url

    if not (env("TIKTOK_CLIENT_KEY") and env("TIKTOK_CLIENT_SECRET") and env("TIKTOK_REDIRECT_URI")):
        sys.exit("Set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET and TIKTOK_REDIRECT_URI in .env first.")
    url, state = login_url()
    print("\n1. Open this link and allow access:\n\n   " + url)
    print("\n2. You'll land on your redirect page (it may show an error, that's fine).")
    back = input("   Paste the full address from the browser bar here:\n   > ").strip()
    params = urllib.parse.parse_qs(urllib.parse.urlparse(back).query)
    if params.get("state", [""])[0] != state:
        sys.exit("That address doesn't match this login attempt. Run tiktok-login again.")
    exchange_code(params["code"][0])
    print("\n✓ TikTok connected. Tokens saved to tokens.json (keep it private).")


def cmd_check(_args):
    from clipstudio.config import env, load_tokens

    tokens = load_tokens()
    rows = [
        ("ffmpeg", bool(shutil.which("ffmpeg")), "install ffmpeg"),
        ("Claude moment picker", bool(env("ANTHROPIC_API_KEY")), "optional: ANTHROPIC_API_KEY"),
        ("Instagram", bool(env("IG_ACCESS_TOKEN") or tokens.get("ig_access_token")), "IG_ACCESS_TOKEN"),
        ("TikTok", bool(tokens.get("tiktok_refresh_token")), "python run.py tiktok-login"),
    ]
    for name, ok, fix in rows:
        print(f"  {'✓' if ok else '✗'} {name}" + ("" if ok else f"   → {fix}"))


def main():
    p = argparse.ArgumentParser(description="Clip Studio")
    p.add_argument("--phone", action="store_true", help="make the web app reachable on your Wi-Fi")
    p.add_argument("--port", type=int, default=8000)
    sub = p.add_subparsers(dest="cmd")
    c = sub.add_parser("clip", help="clip a video from the terminal")
    c.add_argument("url")
    c.add_argument("--post", help="comma list: instagram,tiktok")
    sub.add_parser("tiktok-login")
    sub.add_parser("check")
    args = p.parse_args()
    {"clip": cmd_clip, "tiktok-login": cmd_tiktok_login, "check": cmd_check}.get(args.cmd, cmd_web)(args)


if __name__ == "__main__":
    main()
