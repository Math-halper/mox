# UFY Dark

A private, local-first AI workspace that runs a language model inside your browser
and answers from a knowledge library built into the site.

This repository is a copy of [UFY](https://github.com/Math-halper/UFY) with three
changes:

1. **Dark mode** everywhere — a dark-first theme with no web-font or CDN dependency.
2. **The model lives on the website.** The inference runtime is vendored in
   `vendor/`, and model weights can be served from `models/` by the same site that
   serves the page, so nothing is downloaded from a third-party model host.
3. **A real knowledge library.** `knowledge/` now holds 29 documents (~18,000 words)
   on mathematics, reading and writing, technology, science, humanities, and life
   skills, indexed automatically on startup.

## Run it

```sh
python3 run.py
```

Then open the address it prints (usually <http://localhost:8000>). No pip packages,
accounts, or API keys. `start-ufy.command` (macOS/Linux) and `start-ufy.bat`
(Windows) do the same thing.

The model starts loading on page load. Keep the tab open until it finishes: the
first run downloads the weights into browser storage, later runs reuse them.

## Put the model on the site

The app checks `models/onnx-community/Qwen2.5-0.5B-Instruct/config.json` first.

```sh
python3 tools/fetch_model.py          # download the ONNX files into ./models (~400 MB)
python3 tools/fetch_model.py --check  # show what is already there
```

With the files present, the browser loads the model straight from this website — no
request to Hugging Face — and the top bar reads **model on this site**. Without them,
the app falls back to fetching weights from Hugging Face once and caching them, so a
fresh clone still works.

Weight binaries are ignored by `.gitignore`; keep them on the machine that serves the
site, or host `models/` from a static file service alongside the app.

### What is vendored

| Path | Contents | Source |
| --- | --- | --- |
| `vendor/transformers/` | Transformers.js browser bundle, 3.7.2 | `@huggingface/transformers` (Apache-2.0) |
| `vendor/ort/` | ONNX Runtime Web WASM + loader, jsep build | `onnxruntime-web` 1.22.0-dev (MIT) |
| `vendor/pdfjs/` | PDF.js 4.10.38 + worker | `pdfjs-dist` (Apache-2.0) |

The app points the runtime at these local files (`env.backends.onnx.wasm.wasmPaths`
and `env.localModelPath`), so a first load does not depend on jsDelivr for the engine.

## The knowledge library

```
knowledge/
├── index.json          generated manifest the app fetches at startup
├── README.md           how the library works and how to extend it
├── math/               6 documents — arithmetic, algebra, geometry, calculus, statistics, formulas
├── reading/            5 documents — comprehension, grammar, vocabulary, style, literature
├── technology/         6 documents — computers, web, programming, AI, security, data
├── science/            4 documents — physics, chemistry, biology + Earth, astronomy
├── humanities/         3 documents — history, geography and culture, philosophy
└── life/               3 documents — health, money, study skills
```

Add a file, then:

```sh
python3 tools/build_knowledge_index.py
```

Your own documents can also be imported at runtime with **Add a folder** / **Add
files**; they live in the browser's IndexedDB, not in the repository.

Retrieval is lexical: each document is split into ~1,000-character passages, scored
with a TF-IDF-style term score plus title and exact-phrase bonuses, and the best five
passages are inserted into the prompt. Answers cite the documents used, and
`knowledge/` files are never uploaded anywhere.

## Project files

- `index.html`, `styles.css`, `app.js` — the browser app (dark theme, streaming answers)
- `knowledge/` — bundled library + `index.json` manifest
- `models/` — model weights (optional, git-ignored) served by this site
- `vendor/` — inference runtime and PDF reader served locally
- `tools/fetch_model.py` — downloads ONNX weights into `models/`
- `tools/build_knowledge_index.py` — rebuilds `knowledge/index.json`
- `run.py` — dependency-free static server (correct MIME types for `.wasm`/`.mjs`)

## How it works

- **Model:** Qwen2.5 0.5B Instruct in ONNX, 4-bit quantized, run by Transformers.js
  with WebGPU when available and a WebAssembly CPU fallback otherwise.
- **Context:** each question retrieves library passages, which are passed to the model
  with instructions to answer from them and name the file. If the model cannot start,
  the app switches to search-only mode and shows the matching passages directly.
- **Privacy:** prompts and documents stay in the browser. The only network requests are
  for this site's own files and, if no local weights exist, the model download.
- **Storage:** imported files, the library cache, and model weights use IndexedDB and
  the browser cache. Clearing site data removes them.

## Notes

- Best in a recent Chrome, Edge, or Firefox. WebGPU support varies by browser.
- Files above 12 MB are skipped; supported formats are PDF, TXT, Markdown, CSV, JSON,
  HTML, XML, YAML, and LOG.
- A 0.5B model is small. It is useful for summarizing and explaining retrieved
  passages, not for reliable recall of facts outside them.
- `UFY_ISOLATE=1 python3 run.py` enables cross-origin isolation, which allows the
  WebAssembly backend to use multiple threads.
