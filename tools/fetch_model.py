#!/usr/bin/env python3
"""Download the ONNX model weights into ./models so the site serves them itself.

The browser app looks for `models/<MODEL_ID>/config.json` first. When it finds
that folder, the model is loaded from this website with no request to Hugging
Face. When it does not, the app falls back to fetching the weights from the
Hugging Face CDN in the browser.

Requires only the Python standard library (no pip installs).

Usage:
    python3 tools/fetch_model.py              # download into ./models
    python3 tools/fetch_model.py --check      # report what is present
    python3 tools/fetch_model.py --list       # show the file list, download nothing
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL_ID = os.environ.get("UFY_MODEL_ID", "onnx-community/Qwen2.5-0.5B-Instruct")
MODELS_DIR = ROOT / "models"
TARGET_DIR = MODELS_DIR / MODEL_ID
REPO_ENDPOINT = f"https://huggingface.co/api/models/{MODEL_ID}"
RESOLVE = f"https://huggingface.co/{MODEL_ID}/resolve/main"

# Files the transformers.js text-generation pipeline can use, in preference
# order per backend. Everything else in the repository is skipped.
WANTED = [
    "config.json",
    "generation_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "vocab.json",
    "merges.txt",
    "onnx/decoder_model_merged_q4.onnx",
    "onnx/decoder_model_merged_q4f16.onnx",
]


def human(size: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def remote_files() -> list[dict]:
    request = urllib.request.Request(REPO_ENDPOINT, headers={"User-Agent": "ufy-fetch-model"})
    with urllib.request.urlopen(request, timeout=30) as response:
        info = json.load(response)
    files = []
    for entry in info.get("siblings", []):
        name = entry.get("rfilename", "")
        if not name or name.endswith(".gitattributes"):
            continue
        if "/" not in name:
            keep = name in WANTED
        else:
            keep = name in WANTED or any(name == want for want in WANTED)
        if keep:
            files.append({"name": name, "url": f"{RESOLVE}/{name}"})
    missing = [want for want in WANTED if want.startswith("onnx/") and not any(f["name"] == want for f in files)]
    if len(missing) == len([w for w in WANTED if w.startswith("onnx/")]):
        raise SystemExit(
            "No ONNX weight files found in this repository. Check UFY_MODEL_ID."
        )
    return files


def download(item: dict) -> None:
    destination = TARGET_DIR / item["name"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 0:
        print(f"  have  {item['name']} ({human(destination.stat().st_size)})")
        return
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(item["url"], headers={"User-Agent": "ufy-fetch-model"})
    print(f"  get   {item['name']}")
    with urllib.request.urlopen(request, timeout=120) as response, open(temporary, "wb") as handle:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            handle.write(chunk)
            done += len(chunk)
            if total:
                percent = done * 100 / total
                sys.stdout.write(f"\r        {human(done)} / {human(total)}  {percent:5.1f}%")
                sys.stdout.flush()
        if total:
            sys.stdout.write("\n")
    temporary.replace(destination)


def write_manifest() -> None:
    payload = {
        "modelId": MODEL_ID,
        "format": "onnx (transformers.js)",
        "note": "Served directly by this website. The browser app detects models/<modelId>/config.json.",
    }
    (MODELS_DIR / "model-manifest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch the ONNX model into ./models")
    parser.add_argument("--check", action="store_true", help="only report what is already downloaded")
    parser.add_argument("--list", action="store_true", dest="list_only", help="show the file list and exit")
    parser.add_argument("--manifest-only", action="store_true", help="write model-manifest.json without downloading")
    args = parser.parse_args()

    MODELS_DIR.mkdir(exist_ok=True)
    if args.manifest_only:
        write_manifest()
        print(f"Wrote {MODELS_DIR / 'model-manifest.json'}")
        return 0

    if args.check:
        present = sorted(p for p in TARGET_DIR.rglob("*") if p.is_file()) if TARGET_DIR.exists() else []
        if not present:
            print(f"No local model files yet. The app will download from Hugging Face on first load.")
            print(f"Run `python3 tools/fetch_model.py` to serve the model from this site instead.")
            return 0
        total = sum(p.stat().st_size for p in present)
        print(f"{MODELS_DIR.relative_to(ROOT)}/{MODEL_ID}: {len(present)} files, {human(total)}")
        for path in present:
            print(f"  {path.relative_to(TARGET_DIR)}  {human(path.stat().st_size)}")
        return 0

    print(f"Model: {MODEL_ID}")
    print(f"Target: {TARGET_DIR.relative_to(ROOT)}")
    try:
        files = remote_files()
    except urllib.error.URLError as error:
        print(f"Could not reach Hugging Face: {error}", file=sys.stderr)
        print("The website still works; it will download weights from Hugging Face in the browser.", file=sys.stderr)
        return 1
    if args.list_only:
        for item in files:
            print(item["name"])
        return 0
    if not files:
        print("Nothing to download.", file=sys.stderr)
        return 1

    print(f"Downloading {len(files)} files…")
    for item in files:
        download(item)
    write_manifest()
    total = sum(p.stat().st_size for p in TARGET_DIR.rglob("*") if p.is_file())
    print(f"Done. {human(total)} now served from this site. Reload the page.")
    if shutil.which("git"):
        print("Tip: weight files are ignored by git so the repository stays small.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
