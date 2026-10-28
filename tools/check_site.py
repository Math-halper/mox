#!/usr/bin/env python3
"""Check that the site is internally consistent. Requires only the standard library.

    python3 tools/check_site.py

Verifies that every asset the page loads exists, that every element id the app
looks up is present in index.html, and that the knowledge manifest matches the
files on disk.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
APP = ROOT / "app.js"

problems: list[str] = []
notes: list[str] = []


def read(path: Path) -> str:
    if not path.exists():
        problems.append(f"missing file: {path.relative_to(ROOT)}")
        return ""
    return path.read_text(encoding="utf-8")


html = read(HTML)
app = read(APP)

# 1) Every local asset referenced by the page.
for match in re.finditer(r'(?:src|href)="([^"]+)"', html):
    url = match.group(1)
    if url.startswith(("http:", "https:", "#", "data:", "mailto:")):
        continue
    target = ROOT / url.split("?")[0]
    if not target.exists():
        problems.append(f"index.html references a missing file: {url}")

# 2) Element ids the app queries must exist in the markup.
ids_in_html = set(re.findall(r'\bid="([^"]+)"', html))
ids_in_app = set(re.findall(r"\$\('#([A-Za-z0-9_-]+)'\)", app))
for identifier in sorted(ids_in_app - ids_in_html):
    problems.append(f"app.js looks up #{identifier} but index.html has no such id")

# 3) Files the app fetches at runtime.
for relative in [
    "vendor/transformers/transformers.min.js",
    "vendor/ort/ort-wasm-simd-threaded.jsep.wasm",
    "vendor/ort/ort-wasm-simd-threaded.jsep.mjs",
    "vendor/pdfjs/pdf.min.mjs",
    "vendor/pdfjs/pdf.worker.min.mjs",
    "knowledge/index.json",
]:
    if not (ROOT / relative).exists():
        problems.append(f"runtime asset missing: {relative}")

# 4) Knowledge manifest integrity.
index_path = ROOT / "knowledge" / "index.json"
if index_path.exists():
    index = json.loads(index_path.read_text(encoding="utf-8"))
    listed = {entry["path"] for entry in index.get("documents", [])}
    on_disk = {
        path.relative_to(ROOT / "knowledge").as_posix()
        for path in (ROOT / "knowledge").rglob("*")
        if path.is_file()
        and path.suffix.lower() in {".md", ".markdown", ".txt", ".csv", ".json", ".html", ".htm", ".xml", ".yaml", ".yml", ".log"}
        and path.name != "README.md"
        and path.name != "index.json"
    }
    for missing in sorted(listed - on_disk):
        problems.append(f"knowledge/index.json lists a missing file: {missing}")
    for unlisted in sorted(on_disk - listed):
        problems.append(f"knowledge/{unlisted} is not in index.json (run tools/build_knowledge_index.py)")
    words = sum(entry.get("words", 0) for entry in index.get("documents", []))
    notes.append(f"knowledge library: {len(listed)} documents, {words:,} words")
    categories = {entry.get("category", "") for entry in index.get("documents", [])}
    notes.append(f"categories: {', '.join(sorted(c or 'general' for c in categories))}")

# 5) Model weights.
model = ROOT / "models" / "onnx-community" / "Qwen2.5-0.5B-Instruct"
if (model / "config.json").exists():
    size = sum(path.stat().st_size for path in model.rglob("*") if path.is_file())
    notes.append(f"model: served from models/ ({size / 1024 / 1024:.0f} MB)")
else:
    notes.append("model: not in models/ — the browser will fetch weights from Hugging Face once")

# 6) Any accidental CDN references in the app.
for pattern in ("cdn.jsdelivr.net", "unpkg.com", "fonts.googleapis.com"):
    if pattern in app or pattern in html:
        problems.append(f"index.html/app.js still reference {pattern}")

for note in notes:
    print(f"  · {note}")
if problems:
    print("\nProblems:")
    for problem in problems:
        print(f"  ✗ {problem}")
    sys.exit(1)
print("\nEverything checks out.")
