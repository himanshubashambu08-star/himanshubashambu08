"""Tiny local web dashboard (stdlib only). Shows every chart side by side, live.

Binds to 127.0.0.1 by default. To see it from a VPS, use an SSH tunnel:
    ssh -L 8050:127.0.0.1:8050 you@your-server   then open http://localhost:8050
"""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATIC = os.path.join(os.path.dirname(__file__), "static", "index.html")


def make_handler(engine):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code, body, ctype):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                with open(STATIC, "rb") as f:
                    self._send(200, f.read(), "text/html; charset=utf-8")
            elif self.path == "/api/state":
                self._send(200, json.dumps(engine.snapshot(), default=str).encode(), "application/json")
            else:
                self._send(404, b"not found", "text/plain")

        def _json_body(self, limit=64_000):
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > limit:
                return None
            try:
                return json.loads(self.rfile.read(n))
            except ValueError:
                return None

        def do_POST(self):
            body = self._json_body()
            if body is None:
                return self._send(400, b'{"error":"bad body"}', "application/json")
            if self.path == "/api/ask":
                out = engine.brain.ask(body.get("question"), body.get("history"))
                self._send(200, json.dumps(out).encode(), "application/json")
            elif self.path == "/api/seen":
                n = engine.mark_seen(body.get("keys"))
                self._send(200, json.dumps({"seen": n}).encode(), "application/json")
            else:
                self._send(404, b"not found", "text/plain")

        def log_message(self, *a):
            pass
    return Handler


def start(engine, host="127.0.0.1", port=8050):
    srv = ThreadingHTTPServer((host, port), make_handler(engine))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
