# Mox

Mox is a private AI workspace that runs a real language model inside the visitor's browser and answers from a knowledge library built into the site. It is a static website — no backend, no account, no API key, and no inference server.

## What the project contains

- **A browser-based language model.** `models/smollm2-135m-instruct-q4_1.gguf` (94 MB, Apache-2.0) is served by the site itself and executed by llama.cpp compiled to WebAssembly through the `wllama` runtime in `vendor/wllama/`. The weights never leave the site, and visitors can upload their own `.gguf` files, which are stored in the browser's IndexedDB and appear in the same model picker.
- **A knowledge library.** `knowledge/` holds 55 documents (~56k words) covering math, reading and writing, technology (including HTML, CSS, JavaScript, API, SVG and data-visualisation references, guides to popular websites, local AI agents, browser model runtimes and GGUF, small open models, classic browser games, emulators and Flash, website design references, a line-of-code lookup for HTML/CSS/JS, Git and GitHub automation, and browser desktop shells), science, humanities, and life skills. Each document is indexed in the browser, and answers cite the passages they use. Question words are expanded with a synonym table ("website" also searches "web", "site", "html"), so short questions find the right passage more often.
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

Mox is built and maintained by **[Math-halper](https://github.com/Math-halper)**.

### The projects the reference library was distilled from

Three engineering documents in `knowledge/` — *Running a language model locally, and letting it use tools*, *Git and GitHub automation done safely*, and *Building a desktop environment in the browser* — were written by distilling the architecture and hard-won lessons of the author's other projects:

- **[BOOTMILELIK](https://github.com/Math-halper/BOOTMILELIK)** (MIT) — *Milelik*, a local AI assistant for Linux Mint. A pure-standard-library Python agent that drives a local Qwen2.5-Coder 7B through Ollama, LM Studio or llama.cpp, with 26 tools spanning shell, files, network, desktop apps, media and GitHub, plus a browser front end with a workspace, a code runner and local APIs. The chapter on local models, tool-call dialects, approval gates and testing against fakes comes from this design.
- **[math-halper.github.io](https://github.com/Math-halper/math-halper.github.io)** (AGPL-3.0) — *proton*, a desktop environment that runs entirely in the browser: window manager, app catalog, virtual file system, terminal, text editor, VLC ported to WebAssembly, a repository-wide search engine, and a Math Helper practice cover page. The chapter on browser desktop shells comes from this design.
- **[mox](https://github.com/Math-halper/mox)** — this project.

Those three documents are general technical references. They describe architecture, not code, and deliberately omit project, author and third-party names so that retrieval never lands on a page about this site's own family of code. The credit belongs here, in the repository, where a reader can follow it.

### Built on

Everything below is real, shipped or used by this site — links and licences checked October 2026.

| Project | Licence | How Mox uses it |
| --- | --- | --- |
| [wllama](https://github.com/ngxson/wllama) | MIT | The WebAssembly binding that runs llama.cpp inside the browser; vendored in `vendor/wllama/`. |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT | The inference engine underneath wllama — the code that actually evaluates tokens. |
| [PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 | Extracts text from imported PDFs; vendored in `vendor/pdfjs/`. |
| [SmolLM2](https://github.com/huggingface/smollm) | Apache-2.0 | The bundled 135M model, served from `models/` as GGUF. |
| [Qwen](https://github.com/QwenLM/Qwen2.5-Coder) (Qwen team, Alibaba) | Apache-2.0 | Qwen2.5-Coder 1.5B, Qwen2.5 0.5B/1.5B and Qwen3 4B are offered in the model picker (downloaded from Hugging Face, not bundled). |
| [Llama 3.2](https://github.com/meta-llama/llama-models) (Meta) | Llama 3.2 Community Licence | Llama 3.2 1B appears in the picker as an optional download. That licence is *not* Apache-2.0 — read it before redistributing the weights. |
| [jsdom](https://github.com/jsdom/jsdom) | MIT | Development only: boots the real page for `tests/ui-check.mjs`. |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) | Apache-2.0 | Development only: an in-memory IndexedDB so the tests can open a database. |

The web references in `knowledge/` were checked against [MDN Web Docs](https://developer.mozilla.org/) and [Wikipedia](https://www.wikipedia.org/), the two public references every web developer leans on. Their text is not copied; the debt is to the standard they set.

### Upstream of the browser-desktop project

None of this code is in Mox. It is credited because one chapter was distilled from a project that builds on it, and that chain deserves to be visible:

- [proton-arcade/mlp](https://github.com/proton-arcade/mlp) — the original desktop shell that *proton* is rebuilt from.
- [Gams-Offline/Gams](https://github.com/Gams-Offline/Gams) — the offline games mirror that supplies many of its bundled games.
- [Ruffle](https://github.com/ruffle-rs/ruffle) — the Flash Player emulator in Rust/WebAssembly those games run on.
- [webretro](https://github.com/BinBashBanana/webretro) — RetroArch in the browser, for the emulator app.
- [VLC](https://github.com/videolan/vlc) — libvlc, ported to WebAssembly for the media player app.
- [proton-arcade](https://github.com/proton-arcade) — the account behind several of the vendored game builds (*gdweb*, *evo*, *AmplerLauncher*).

### Games and game runtimes the library points at

The documents *Classic browser games* and *Old games in a new browser* name real implementations so that a question about a game has something concrete to land on. These are the projects they reference (checked October 2026):

| Project | Licence | What it is |
| --- | --- | --- |
| [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048) | MIT | The original 2048 — grid slide-and-merge |
| [jakesgordon/javascript-tetris](https://github.com/jakesgordon/javascript-tetris) | MIT | Compact Tetris: rotation, lock delay, line clears |
| [dom96/snake](https://github.com/dom96/snake) | MIT | The grid game in a few hundred lines |
| [soundanalogous/Breakout](https://github.com/soundanalogous/Breakout) | MIT | Canvas Breakout: paddle angle, brick collisions |
| [nebez/floppybird](https://github.com/nebez/floppybird) | Apache-2.0 | Flappy Bird clone — one velocity, tuned constants |
| [wayou/t-rex-runner](https://github.com/wayou/t-rex-runner) | BSD-3-Clause | The Chrome dino, extracted from Chromium |
| [luciopanepinto/pacman](https://github.com/luciopanepinto/pacman) | GPL-3.0 | Pac-Man: tile maze, ghost targeting, scatter/chase |
| [Hextris/hextris](https://github.com/Hextris/hextris) | Licence file only (check before reuse) | Hexagonal Tetris-like puzzle |
| [pshenok/server-survival](https://github.com/pshenok/server-survival) | MIT | Tower defence that teaches cloud architecture |
| [ruffle-rs/ruffle](https://github.com/ruffle-rs/ruffle) | MIT / Apache-2.0 (dual) | Flash player reimplemented in Rust + WebAssembly |
| [EmulatorJS/EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) | GPL-3.0 | RetroArch front end for the browser — consoles, saves, gamepads |
| [BinBashBanana/webretro](https://github.com/BinBashBanana/webretro) | MIT | RetroArch in the browser with a core picker |

None of this code is in Mox; the documents describe the mechanics, and the licences above are what apply if anyone reuses them. Note that the GPL-3.0 projects (Pac-Man, EmulatorJS) carry obligations that the MIT ones do not, and that no emulator licence grants any right to the games people run on it — see the table at the end of the emulators document.

### Design references

One document, *Website design references*, describes the anatomy of a dozen recognisable layouts — a news list, classifieds, an encyclopedia article, documentation, a repository page, a SaaS landing page, a marketplace grid, a product page, a community feed, a media grid, a search page, a modern app shell — so that "build it like X" produces the same *bones* rather than a copy.

No code, copy, imagery or assets from any of those sites appear in this repository; the descriptions are original, written from how the layouts work. The document ends with the rule written into the workspace prompt: borrow the structure, never the logo, the name or the trademark. It credits [MDN](https://developer.mozilla.org/), [web.dev](https://web.dev/), [WebAIM](https://webaim.org/) and [W3C WAI](https://www.w3.org/WAI/) for the accessibility and layout guidance those patterns depend on.

### A licensing note

Several of the upstream repositories above — including `proton-arcade/mlp` and the vendored game collections — declare **no licence file** at all, and a few of the game builds are fan ports or mirrors of commercial games. That is a real constraint on redistributing them, and worth knowing before publishing a fork. Mox itself also has no licence file yet; add one if you want others to reuse this code.

## Licenses

- **Bundled model** — Apache-2.0 (`HuggingFaceTB/SmolLM2-135M-Instruct`).
- **wllama** — MIT; it embeds **llama.cpp**, also MIT.
- **PDF.js** — Apache-2.0.
- **Optional models** — Qwen models are Apache-2.0; Llama 3.2 1B is under the Llama 3.2 Community Licence and is not bundled.
- **Knowledge documents** — original text written for this project; three of them distil the architecture of the projects credited above and carry no code from them.
