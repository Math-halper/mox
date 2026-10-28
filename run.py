#!/usr/bin/env python3
"""Serve UFY Dark locally. Requires Python 3; no pip packages are needed.

    python3 run.py                 # http://localhost:8000
    UFY_PORT=9000 python3 run.py   # choose a port
    UFY_HOST=0.0.0.0 python3 run.py

The server serves every file this app needs: the page, the inference runtime in
vendor/, the model weights in models/ (when downloaded), and the knowledge
library. It never proxies or uploads your data.
"""
from __future__ import annotations

import os
import socket
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("UFY_HOST", "0.0.0.0")
PORT = int(os.environ.get("UFY_PORT", "8000"))
OPEN_BROWSER = os.environ.get("UFY_NO_BROWSER", "") not in {"1", "true", "yes"}
# Cross-origin isolation lets the WebAssembly backend use more than one thread.
# It is off by default because it also requires every remote asset to opt in.
ISOLATE = os.environ.get("UFY_ISOLATE", "") in {"1", "true", "yes"}


class UFYHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".json": "application/json",
        ".md": "text/markdown; charset=utf-8",
        ".onnx": "application/octet-stream",
    }

    def end_headers(self) -> None:
        path = self.path.split("?")[0]
        if "/vendor/" in path or "/models/" in path:
            self.send_header("Cache-Control", "public, max-age=604800")
        elif path.endswith(("index.html", "/", "app.js", "styles.css", "index.json")):
            self.send_header("Cache-Control", "no-cache")
        if ISOLATE:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        sys.stdout.write("[ufy] " + (fmt % args) + "\n")
        sys.stdout.flush()


def available_port(host: str, start: int) -> int:
    for port in range(start, start + 40):
        try:
            with socket.socket() as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind((host, port))
            return port
        except OSError:
            continue
    raise RuntimeError("Could not find an available port.")


def local_urls(port: int) -> list[str]:
    urls = [f"http://localhost:{port}"]
    if HOST in {"0.0.0.0", "::"}:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect(("8.8.8.8", 80))
                address = sock.getsockname()[0]
            if not address.startswith("127."):
                urls.append(f"http://{address}:{port}")
        except OSError:
            pass
    return urls


def main() -> int:
    global PORT
    os.chdir(ROOT)
    PORT = available_port(HOST, PORT)
    handler = partial(UFYHandler, directory=str(ROOT))
    server = ThreadingHTTPServer((HOST, PORT), handler)
    urls = local_urls(PORT)
    print(f"UFY Dark is running at {urls[0]}")
    for extra in urls[1:]:
        print(f"  also reachable at {extra}")
    weights = ROOT / "models" / "onnx-community" / "Qwen2.5-0.5B-Instruct" / "config.json"
    if weights.exists():
        print("Model: served from ./models (no Hugging Face download needed).")
    else:
        print("Model: not downloaded locally yet — run `python3 tools/fetch_model.py` to serve it from this site.")
    print("Library: knowledge/ (rebuilt by tools/build_knowledge_index.py).")
    print("Leave this window open while using UFY. Press Ctrl+C to stop.")
    if OPEN_BROWSER:
        try:
            webbrowser.open(urls[0])
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping UFY…")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
