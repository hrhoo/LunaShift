#!/usr/bin/env python3
"""Run LunaShift locally. Standard-library only; internet is optional."""
from __future__ import annotations
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path
from urllib.parse import urlparse
import argparse
import json
import threading
import webbrowser
from online_horizons import fetch_tracks

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
MAX_BODY = 1_000_000

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *values):
        if "/api/" in self.path or (len(values) > 1 and str(values[1]) not in ("200", "304")):
            super().log_message(fmt, *values)

    def _json(self, payload, status=200):
        raw = json.dumps(payload, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if urlparse(self.path).path == "/api/health":
            return self._json({"ok": True, "online_horizons": True})
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/horizons":
            return self._json({"error": "Not found"}, 404)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY:
                raise ValueError("Invalid request size.")
            body = json.loads(self.rfile.read(size))
            site = body.get("site") or {}
            for key in ("latitude_deg", "longitude_deg"):
                if key not in site:
                    raise ValueError("Site latitude and longitude are required.")
            rows, meta = fetch_tracks(site, body["start_utc"], body.get("hours", 2), body.get("step_min", 60), body.get("collector_height_m", 0), body.get("antenna_height_m", 0))
            return self._json({"rows": rows, "metadata": meta})
        except Exception as exc:
            return self._json({"error": str(exc)}, 503)


def main():
    parser = argparse.ArgumentParser(description="Start LunaShift in your browser.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    server = None
    for port in range(args.port, args.port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            pass
    if server is None:
        raise SystemExit("No free local port found. Try: python run.py --port 9000")
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"\nLunaShift\nOpen {url}\nKeep this window open while using the app. Press Ctrl+C to stop.\n", flush=True)
    if not args.no_browser:
        threading.Timer(.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nLunaShift stopped.")
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
