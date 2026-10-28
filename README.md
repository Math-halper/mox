# Mox

A private AI workspace that runs a **real language model in your browser** and answers
from a knowledge library built into the site.

Originally a copy of [UFY](https://github.com/Math-halper/UFY), rebuilt as Mox with a
dark theme, a model that ships with the app, and a substantial knowledge library.

- **The model is included.** `models/smollm2-135m-instruct-q4_1.gguf` (94 MB,
  Apache-2.0) is served by this same website and executed by llama.cpp compiled to
  WebAssembly. No Hugging Face download, no API key, no server.
- **Dark by default.** A dark, chat-style workspace — sidebar of past chats, knowledge
  and files, a single centered composer — with no web fonts and no CDN assets.
- **Knowledge included.** 28 documents (~18,000 words) on math, reading and writing,
  technology, science, humanities, and life skills, indexed in the browser.

## Use it — no setup for anyone

Mox is a plain static site. There is no backend, no account, and no API key, so any
static host can serve it and visitors just open a link.

**Publish it once, then share the URL**

1. In this repository: **Settings → Pages → Source: GitHub Actions** (one toggle).
2. Push to `main` (or run the *Publish Mox* workflow manually).
3. Your site is live at `https://<owner>.github.io/mox/` — for this repo,
   <https://math-halper.github.io/mox/>.

Every push after that republishes automatically; `tools/check_site.py` runs in the
workflow, so a broken site fails the build instead of the deploy.

**Or publish somewhere else, also without setup**

- **Netlify Drop** — drop this folder on <https://app.netlify.com/drop>. The included
  `_headers` file turns on cross-origin isolation, which makes the engine multi-threaded.
- **Cloudflare Pages** — create a project from this repo, framework preset *None*,
  build command empty, output directory `/`.
- **Any file host** — the site is only HTML, CSS, JS, JSON, GGUF, and WASM files.

**Run it locally** (optional; nothing needs installing)

```sh
python3 run.py          # nicer MIME types, caching, and multi-thread flag
python3 -m http.server  # also works, if Python knows .wasm
```

`start-mox.command` (macOS/Linux) and `start-mox.bat` (Windows) are shortcuts for
`python3 run.py`.

> Opening `index.html` straight from disk does **not** work: browsers block WebAssembly
> and module loading over `file://`. Use a URL, local or hosted.

### Why hosting matters for speed, not features

The model and runtime are ordinary files in this repository, so a static host is
enough. If the host sends `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`
(as `run.py` and `_headers` do), the WebAssembly engine can use several threads; without
them it runs single-threaded and answers a little slower. Everything else is identical.

## The model

| | |
| --- | --- |
| Model | SmolLM2 135M Instruct (`HuggingFaceTB`), Q4_1 quantization |
| Size | 94 MB, one file, committed to this repository |
| Runtime | [wllama](https://github.com/ngxson/wllama) 3.8.1 — llama.cpp in WebAssembly, vendored in `vendor/wllama/` |
| Context | 4,096 tokens per session (the model supports 8,192) |
| License | Apache-2.0 |

It loads from `models/` through `models/manifest.json`, so the weights never leave this
site. On a typical laptop it generates a few tokens per second on the CPU — quick for
short answers, slow for essays.

### Swapping in a bigger model

```sh
python3 tools/fetch_model.py --list               # presets
python3 tools/fetch_model.py --preset qwen-0.5b   # ~400 MB, better answers
python3 tools/fetch_model.py --check              # what is on disk
```

The script saves the GGUF into `models/` and registers it in `models/manifest.json`.
Reload the page, open **Model & settings**, and pick it. You can also load any `.gguf`
chat model straight from your computer with **Load a .gguf from this computer**.

Presets: Qwen2.5 0.5B and 1.5B Instruct, Llama 3.2 1B Instruct. Extra weights are
git-ignored; only the bundled 135M model is committed.

## The knowledge library

```
knowledge/
├── index.json          generated manifest the app fetches at startup
├── README.md           how the library works and how to extend it
├── math/               6 — arithmetic, algebra, geometry, calculus, statistics, formulas
├── reading/            5 — comprehension, grammar, vocabulary, style, literature
├── technology/         6 — computers, web, programming, AI, security, data
├── science/            4 — physics, chemistry, biology + Earth, astronomy
├── humanities/         3 — history, geography and culture, philosophy
└── life/               3 — health, money, study skills
```

Add a file, then rebuild the manifest:

```sh
python3 tools/build_knowledge_index.py
```

You can also import your own documents at runtime with **Add a folder** / **Add files**
(stored in the browser's IndexedDB, never uploaded).

Retrieval is lexical: each document is split into ~800-character passages, scored with an
IDF-weighted term score plus title and exact-phrase bonuses, and the best passages are
inserted into the prompt as sources. Answers cite the documents used.

## What you get in the UI

- **Streaming answers** from the local model, with source pills under each reply.
- **Search-only mode:** if the model cannot start, questions still return the matching
  passages instead of failing.
- **Knowledge toggle** in the sidebar, plus a browsable library by topic.
- **Model panel** listing every model found on disk, with a picker and a `.gguf` upload.
- **Dark theme** throughout, responsive down to phone widths.

## Project layout

- `index.html`, `styles.css`, `app.js` — the browser app
- `models/` — `manifest.json` + the bundled GGUF (extra models git-ignored)
- `knowledge/` — the library and its generated `index.json`
- `vendor/wllama/` — llama.cpp WebAssembly runtime (MIT)
- `vendor/pdfjs/` — PDF text extraction for imports (Apache-2.0)
- `tools/fetch_model.py` — download extra GGUF models into `models/`
- `tools/build_knowledge_index.py` — rebuild `knowledge/index.json`
- `tools/check_site.py` — verify assets, ids, manifest and knowledge integrity
- `run.py` — dependency-free static server with correct `.wasm` / `.mjs` / `.gguf` MIME types

## Privacy

The page, the model, and the library are served from this folder. Questions, imported
files, and retrieved passages stay in the browser; there is no inference server and no
telemetry. Imported files, the library cache, and the browser's copy of the model live in
IndexedDB and the Cache API, and clearing site data removes them.

## Notes and limits

- Best in a recent Chrome or Edge (which ship WebAssembly memory64 and JSPI, the
  features the bundled runtime targets). If a browser lacks them, the app either uses a
  local compatibility build or, failing that, stays in search-only mode rather than
  fetching anything from a CDN. To vendor that build:

  ```sh
  npm i @wllama/wllama-compat
  mkdir -p vendor/wllama/compat
  cp node_modules/@wllama/wllama-compat/wasm/wllama.{js,wasm} vendor/wllama/compat/
  ```

  The app detects `vendor/wllama/compat/wllama.wasm` on startup and registers it with
  `setCompat()`, so no request leaves the site.
- A 135M model is small: it summarizes and explains retrieved passages well, and is
  unreliable for facts outside them. The passages are the authority.
- Imported files above 12 MB are skipped. Supported formats: PDF, TXT, Markdown, CSV,
  JSON, HTML, XML, YAML, LOG.
- `MOX_ISOLATE=1 python3 run.py` enables cross-origin isolation (multithreaded WASM);
  `MOX_PORT` and `MOX_HOST` change the bind address.

## Licenses

The bundled model is Apache-2.0 (`HuggingFaceTB/SmolLM2-135M-Instruct`). wllama is MIT;
wllama embeds llama.cpp (MIT). PDF.js is Apache-2.0. Knowledge documents in this
repository are original text written for this project.
