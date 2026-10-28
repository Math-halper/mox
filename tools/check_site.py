#!/usr/bin/env python3
"""Check that the Mox site is internally consistent. Standard library only.

    python3 tools/check_site.py
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

# 1) Local assets referenced by the markup.
for match in re.finditer(r'(?:src|href)="([^"]+)"', html):
    url = match.group(1)
    if url.startswith(("http:", "https:", "#", "data:", "mailto:")):
        continue
    if not (ROOT / url.split("?")[0]).exists():
        problems.append(f"index.html references a missing file: {url}")

# 2) Element ids the app queries must exist in the markup.
ids_in_html = set(re.findall(r'\bid="([^"]+)"', html))
ids_in_app = set(re.findall(r"\$\('#([A-Za-z0-9_-]+)'\)", app))
# Rendered by app.js into modals/toasts rather than present in index.html.
DYNAMIC_IDS = {"modelUpload", "modelRefresh", "modelStorage", "exportChat", "clearChats",
               "libraryFilter", "copyPassage", "readWholeDoc",
               "modelRestore", "modelSwitchStatus"}
for identifier in sorted(ids_in_app - ids_in_html - DYNAMIC_IDS):
    problems.append(f"app.js looks up #{identifier} but index.html has no such id")

# 3) Files the page fetches at runtime.
runtime_assets = [
    "vendor/wllama/wllama.js",
    "vendor/wllama/wllama.wasm",
    "vendor/pdfjs/pdf.min.js",
    "vendor/pdfjs/pdf.worker.min.js",
    "calculator.js",
    "workspace.js",
    "model-store.js",
    "knowledge/index.json",
    "models/manifest.json",
    "sw.js",
]
for relative in runtime_assets:
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
        and path.name not in {"README.md", "index.json"}
    }
    for missing in sorted(listed - on_disk):
        problems.append(f"knowledge/index.json lists a missing file: {missing}")
    for unlisted in sorted(on_disk - listed):
        problems.append(f"knowledge/{unlisted} is not in index.json (run tools/build_knowledge_index.py)")
    words = sum(entry.get("words", 0) for entry in index.get("documents", []))
    notes.append(f"knowledge library: {len(listed)} documents, {words:,} words")

# 5) Model files, GGUF magic, and manifest agreement.
manifest_path = ROOT / "models" / "manifest.json"
gguf_files = sorted((ROOT / "models").glob("*.gguf"))
if manifest_path.exists():
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest.get("models", []):
        path = ROOT / "models" / entry["file"]
        if not path.exists():
            problems.append(f"models/manifest.json lists a missing file: {entry['file']}")
            continue
        if path.read_bytes()[:4] != b"GGUF":
            problems.append(f"models/{entry['file']} is not a GGUF file")
        if entry.get("bytes") and path.stat().st_size != entry["bytes"]:
            problems.append(f"models/{entry['file']} size {path.stat().st_size} != manifest {entry['bytes']}")
    listed_files = {entry["file"] for entry in manifest.get("models", [])}
    for path in gguf_files:
        if path.name not in listed_files:
            problems.append(f"models/{path.name} exists but is not listed in models/manifest.json — the app will not offer it")
    if not manifest.get("models"):
        problems.append("models/manifest.json has no entries")
    total = sum(path.stat().st_size for path in gguf_files)
    notes.append(f"models: {len(gguf_files)} GGUF file(s), {total / 1048576:.0f} MB")
    default = manifest.get("default")
    if default and default not in {entry.get("id") for entry in manifest.get("models", [])}:
        problems.append(f"models/manifest.json default '{default}' is not one of the listed models")
else:
    problems.append("models/manifest.json is missing — the app cannot find a model")

# 6) No leftover third-party runtime references.
for pattern in ("cdn.jsdelivr.net", "unpkg.com", "fonts.googleapis.com", "huggingface.co/"):
    if pattern in app or pattern in html:
        problems.append(f"index.html/app.js still reference {pattern}")

# 7) Branding consistency. Attribution links to the original project are fine.
for path in [HTML, APP, ROOT / "README.md", ROOT / "run.py", ROOT / "styles.css"]:
    text = read(path)
    for number, line in enumerate(text.splitlines(), start=1):
        if "Math-halper/UFY" in line:
            continue
        if re.search(r"\bUFY\b|\bufy\b", line):
            problems.append(f"{path.name}:{number} still uses the old name: {line.strip()[:70]}")

for note in notes:
    print(f"  · {note}")
if problems:
    print("\nProblems:")
    for problem in problems:
        print(f"  ✗ {problem}")
    sys.exit(1)
print("\nEverything checks out.")
