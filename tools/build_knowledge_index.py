#!/usr/bin/env python3
"""Rebuild knowledge/index.json from the files in knowledge/.

The app fetches this manifest at startup so the bundled library is available
without the user having to pick a folder. Requires only the Python standard
library.

Usage:
    python3 tools/build_knowledge_index.py
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KNOWLEDGE = ROOT / "knowledge"
INDEX = KNOWLEDGE / "index.json"

SUPPORTED = {".md", ".markdown", ".txt", ".csv", ".json", ".log", ".yaml", ".yml", ".html", ".htm", ".xml"}

# Files that describe the folder rather than teach anything. They stay in the
# repository for humans but are not indexed into the model's context.
EXCLUDED_NAMES = {"README.md", "index.json"}

CATEGORIES = [
    ("math", "Mathematics", "Arithmetic through calculus, plus a formula reference."),
    ("reading", "Reading & Writing", "Comprehension, grammar, style, vocabulary, and literature."),
    ("technology", "Technology", "Computers, the web, programming, AI, security, and data."),
    ("science", "Science", "Physics, chemistry, biology, Earth, and space."),
    ("humanities", "Humanities", "History, geography, cultures, and philosophy."),
    ("life", "Life & Skills", "Health, money, and learning how to learn."),
    ("", "General", "General notes and guides that do not belong to a category."),
]


def title_for(path: Path, text: str) -> str:
    """Use the first Markdown heading, else the filename, as a readable title."""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            heading = stripped.lstrip("#").strip()
            if heading:
                return heading
        if stripped:
            break
    stem = path.stem.replace("-", " ").replace("_", " ")
    return stem[:1].upper() + stem[1:]


def build() -> dict:
    documents = []
    for path in sorted(KNOWLEDGE.rglob("*")):
        if not path.is_file() or path == INDEX:
            continue
        if path.suffix.lower() not in SUPPORTED:
            continue
        if path.name in EXCLUDED_NAMES:
            continue
        relative = path.relative_to(KNOWLEDGE).as_posix()
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = path.read_text(encoding="utf-8", errors="replace")
        top = relative.split("/")[0] if "/" in relative else ""
        documents.append(
            {
                "path": relative,
                "title": title_for(path, text),
                "category": top,
                "bytes": path.stat().st_size,
                "words": len(text.split()),
            }
        )

    present = {doc["category"] for doc in documents}
    categories = [
        {"id": cid, "name": name, "description": description}
        for cid, name, description in CATEGORIES
        if cid in present or cid == ""
    ]
    return {
        "version": 2,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "categories": categories,
        "documents": documents,
    }


def main() -> int:
    if not KNOWLEDGE.is_dir():
        print(f"No knowledge folder at {KNOWLEDGE}", file=sys.stderr)
        return 1
    data = build()
    INDEX.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    words = sum(doc["words"] for doc in data["documents"])
    total = sum(doc["bytes"] for doc in data["documents"])
    print(
        f"Wrote {INDEX.relative_to(ROOT)}: {len(data['documents'])} documents, "
        f"{words:,} words, {total / 1024:.0f} KB."
    )
    for category in data["categories"]:
        count = sum(1 for doc in data["documents"] if doc["category"] == category["id"])
        print(f"  {category['name']:<20} {count:>3} document{'s' if count != 1 else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
