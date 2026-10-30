# Mox

Mox is a private AI workspace that runs a real language model inside the visitor's browser and answers from a knowledge library built into the site. It is a static website — no backend, no account, no API key, and no inference server.

## What the project contains

- **A browser-based language model.** `models/smollm2-135m-instruct-q4_1.gguf` (94 MB, Apache-2.0) is served by the site itself and executed by llama.cpp compiled to WebAssembly through the `wllama` runtime in `vendor/wllama/`. The weights never leave the site, and visitors can upload their own `.gguf` files, which are stored in the browser's IndexedDB and appear in the same model picker.
- **A knowledge library.** `knowledge/` holds 49 documents (~47k words) covering math, reading and writing, technology (including HTML, CSS, JavaScript, API, SVG and data-visualisation references, guides to popular websites, local AI agents, Git and GitHub automation, and browser desktop shells), science, humanities, and life skills. Each document is indexed in the browser, and answers cite the passages they use. Question words are expanded with a synonym table ("website" also searches "web", "site", "html"), so short questions find the right passage more often.
- **Drawings.** Ask for a shape, a chart, a flowchart or a simple scene and Mox builds a real SVG from geometry — no image model involved. Every drawing can be downloaded as `.svg` or `.png`, copied, or opened in the workspace.
- **A code workspace.** A file tree, editor with line numbers, live sandboxed preview, console, and AI panel. Mox can read workspace files and rewrite them from chat using `mox:write` blocks, with Apply/Undo control.
- **A calculator.** A safe expression engine (no `eval`) with trigonometry, logarithms, statistics, combinatorics, percentages, unit conversion, and `<calc>…</calc>` tags that make arithmetic in answers exact.
- **Conversations and interface.** Every chat is stored in IndexedDB, listed in the sidebar, and restored on reload. The interface is black and white throughout (body text at 21:1 contrast), works on phones with a slide-in drawer, and stays available offline after the first visit through a service worker.

## How it works

Mox loads the bundled model on the first visit and caches it in the browser. When a question is asked, the app searches the knowledge library for matching passages, places the best ones in the model's prompt as numbered sources, and streams the answer back. When nothing matches, the model answers from its own knowledge and a line under the reply says so. Purely arithmetic questions are handled by the calculator directly, and requests to draw are handled by the drawing engine, so both results are exact rather than guessed.

## Project layout

- `index.html`, `styles.css`, `app.js` — the browser app
- `workspace.js` — code workspace: files, editor, sandboxed preview, console, AI edits
- `calculator.js` — expression parser, function library, unit conversions
- `svg.js` — drawing engine: shapes, charts, flowcharts, scenes, and SVG sanitising
- `model-store.js` — uploaded GGUF models in IndexedDB, merged into the model picker
- `models/` — `manifest.json` and the bundled GGUF (additional models are git-ignored)
- `knowledge/` — the library and its generated `index.json`
- `vendor/wllama/` — llama.cpp WebAssembly runtime (MIT)
- `vendor/pdfjs/` — PDF text extraction for imports (Apache-2.0)
- `tools/` — scripts for fetching models, rebuilding the knowledge index, and checking the site
- `sw.js` — service worker for offline reloads
- `tests/ui-check.mjs` — headless UI checks (development only)
- `run.py` — dependency-free static server with correct `.wasm`, `.mjs`, and `.gguf` MIME types

## Privacy

The page, model, and library are served from this repository. Questions, imported files, and retrieved passages stay in the browser; imported files and the library cache live in IndexedDB and the Cache API, and clearing site data removes them. Nothing is uploaded and no third-party inference service is involved.

## Credits

Mox is built and maintained by **[Math-halper](https://github.com/Math-halper)**. Three of the engineering documents in the knowledge library — *Running a language model locally, and letting it use tools*, *Git and GitHub automation done safely*, and *Building a desktop environment in the browser* — were written by distilling the architecture and hard-won lessons of the author's own projects:

- **[BOOTMILELIK](https://github.com/Math-halper/BOOTMILELIK)** (MIT) — *Milelik*, a local AI assistant for Linux Mint. A pure-standard-library Python agent that drives a local Qwen2.5-Coder 7B through Ollama, LM Studio or llama.cpp, with 26 tools spanning shell, files, network, desktop apps, media and GitHub, plus a browser front end with a workspace, a code runner and local APIs. The chapter on local models, tool-call dialects, approval gates and testing against fakes comes from this design.
- **[math-halper.github.io](https://github.com/Math-halper/math-halper.github.io)** (AGPL-3.0) — *proton*, a desktop environment that runs entirely in the browser: window manager, app catalog, virtual file system, terminal, text editor, VLC ported to WebAssembly, a repository-wide search engine, and a Math Helper practice cover page. It is itself a rebranded rebuild of [proton-arcade/mlp](https://github.com/proton-arcade/mlp), and some of its bundled games are vendored from third-party collections — see its own `CREDITS.md` for those. The chapter on browser desktop shells comes from this design.
- **[mox](https://github.com/Math-halper/mox)** — this project.

Those three documents are general technical references. They describe the architecture, not the code, and they deliberately omit project, author and third-party names so that Mox does not surface them as answers — the credit belongs here, in the repository, where a reader can follow it.

Thank you also to the people behind the pieces this site stands on: llama.cpp and wllama, PDF.js, Hugging Face and the SmolLM2 authors, and the Wikimedia and MDN communities whose public documentation is the standard for the web references in `knowledge/`.

## Licenses

The bundled model is Apache-2.0 (`HuggingFaceTB/SmolLM2-135M-Instruct`). wllama is MIT and embeds llama.cpp (MIT). PDF.js is Apache-2.0. Knowledge documents are original text written for this project; three of them distil the architecture of the projects credited above and carry no code from them.
