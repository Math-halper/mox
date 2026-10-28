#!/usr/bin/env python3
"""Download a GGUF model into ./models so this site can serve it.

The site already ships with a working model (SmolLM2 135M Instruct). Use this
script only when you want a bigger one: it downloads a quantization from the
Hugging Face CDN, saves it next to the bundled model, and registers it in
models/manifest.json. After that, pick it in the app under Model & settings.

Requires only the Python standard library.

    python3 tools/fetch_model.py --list              # show presets
    python3 tools/fetch_model.py --preset qwen-0.5b  # download a preset
    python3 tools/fetch_model.py --url <gguf-url> --name "My model"
    python3 tools/fetch_model.py --check             # what is on disk
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
MANIFEST = MODELS / "manifest.json"

PRESETS = {
    "qwen-0.5b": {
        "id": "qwen2.5-0.5b-instruct-q4_k_m",
        "name": "Qwen2.5 0.5B Instruct",
        "file": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        "parameters": "0.5B",
        "quantization": "Q4_K_M",
        "context": 32768,
        "license": "Apache-2.0",
        "url": "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
        "note": "About 400 MB. Noticeably better answers than the bundled 135M model.",
    },
    "qwen-1.5b": {
        "id": "qwen2.5-1.5b-instruct-q4_k_m",
        "name": "Qwen2.5 1.5B Instruct",
        "file": "qwen2.5-1.5b-instruct-q4_k_m.gguf",
        "parameters": "1.5B",
        "quantization": "Q4_K_M",
        "context": 32768,
        "license": "Apache-2.0",
        "url": "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
        "note": "About 1 GB. Best quality here, but slow on a CPU and heavy in a browser tab.",
    },
    "llama-1b": {
        "id": "llama-3.2-1b-instruct-q4_k_m",
        "name": "Llama 3.2 1B Instruct",
        "file": "llama-3.2-1b-instruct-q4_k_m.gguf",
        "parameters": "1B",
        "quantization": "Q4_K_M",
        "context": 8192,
        "license": "Llama 3.2 Community License",
        "url": "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
        "note": "About 800 MB. Good general chat model.",
    },
}


def human(size: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def load_manifest() -> dict:
    if MANIFEST.exists():
        try:
            return json.loads(MANIFEST.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"version": 1, "default": None, "models": []}


def save_manifest(manifest: dict) -> None:
    MODELS.mkdir(exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def register(entry: dict) -> None:
    manifest = load_manifest()
    entry = {key: value for key, value in entry.items() if key != "url"}
    models = [item for item in manifest.get("models", []) if item.get("id") != entry["id"]]
    models.append(entry)
    manifest["models"] = models
    manifest.setdefault("version", 1)
    save_manifest(manifest)


def download(url: str, destination: Path) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "mox-fetch-model"})
    with urllib.request.urlopen(request, timeout=180) as response, open(temporary, "wb") as handle:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            handle.write(chunk)
            done += len(chunk)
            if total:
                sys.stdout.write(f"\r  {human(done)} / {human(total)}  {done * 100 / total:5.1f}%")
                sys.stdout.flush()
        if total:
            sys.stdout.write("\n")
    temporary.replace(destination)
    return destination.stat().st_size


def show_check() -> int:
    files = sorted(MODELS.glob("*.gguf"))
    manifest = load_manifest()
    if not files:
        print("No .gguf files in models/. The site will fall back to search-only mode.")
        return 1
    print(f"models/ ({len(files)} file(s)):")
    for path in files:
        magic = path.read_bytes()[:4]
        state = "ok" if magic == b"GGUF" else f"NOT GGUF ({magic!r})"
        listed = any(item.get("file") == path.name for item in manifest.get("models", []))
        print(f"  {path.name:<46} {human(path.stat().st_size):>10}  {state}  {'in manifest' if listed else 'NOT in manifest'}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Download a GGUF model into ./models")
    parser.add_argument("--preset", choices=sorted(PRESETS), help="download a known-good model")
    parser.add_argument("--url", help="direct .gguf URL to download")
    parser.add_argument("--name", help="display name for --url downloads")
    parser.add_argument("--file", help="file name to save as (defaults to the URL's name)")
    parser.add_argument("--list", action="store_true", dest="list_only")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    if args.list_only:
        print("Presets:")
        for key, preset in PRESETS.items():
            print(f"  {key:<12} {preset['name']:<24} {preset['quantization']:<8} {preset['note']}")
        print("\nThe bundled SmolLM2 135M model needs no download.")
        return 0
    if args.check or not (args.preset or args.url):
        return show_check()

    if args.preset:
        preset = dict(PRESETS[args.preset])
    else:
        if not args.url.lower().endswith(".gguf"):
            print("--url must point at a .gguf file", file=sys.stderr)
            return 2
        filename = args.file or os.path.basename(args.url.split("?")[0])
        preset = {
            "id": Path(filename).stem.lower().replace(" ", "-"),
            "name": args.name or Path(filename).stem,
            "file": filename,
            "parameters": "",
            "quantization": "",
            "context": 4096,
            "license": "check the model card",
            "url": args.url,
        }

    destination = MODELS / preset["file"]
    print(f"Model:  {preset['name']}")
    print(f"Target: {destination.relative_to(ROOT)}")
    if destination.exists():
        print("  already downloaded — registering it instead")
    else:
        try:
            size = download(preset["url"], destination)
            preset["bytes"] = size
            print(f"  saved {human(size)}")
        except urllib.error.URLError as error:
            print(f"Download failed: {error}", file=sys.stderr)
            print("The bundled model still works; nothing was changed.", file=sys.stderr)
            return 1

    preset.setdefault("bytes", destination.stat().st_size)
    preset["added"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    register(preset)
    print(f"Registered in {MANIFEST.relative_to(ROOT)}. Reload the page, then open Model & settings to switch to it.")
    print("Tip: weight files are ignored by git so the repository stays small.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
