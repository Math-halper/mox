# Mox

A private AI workspace that runs a **real language model in your browser** and answers
from a knowledge library built into the site.

Originally a copy of [UFY](https://github.com/Math-halper/UFY), rebuilt as Mox with a
dark theme, a model that ships with the app, and a substantial knowledge library.

- **The model is included.** `models/smollm2-135m-instruct-q4_1.gguf` (94 MB,
  Apache-2.0) is served by this same website and executed by llama.cpp compiled to
  WebAssembly. No Hugging Face download, no API key, no server. Upload your own
  `.gguf` and it joins the model picker, stored in this browser for next time.
- **A code workspace.** A full-screen editor with a file tree, live preview,
  console, and an AI panel. Mox can read the files and rewrite them from chat by
  emitting `mox:write` blocks; every change can be undone.
- **A real calculator.** A safe expression engine (no `eval`) with trigonometry,
  logarithms, statistics, combinatorics, percentages, and unit conversion, plus
  `<calc>…</calc>` tags that make arithmetic in answers exact.
- **Black and white, high contrast.** A chat-style workspace — sidebar of past chats,
  knowledge and files, a single centered composer — rendered in pure greyscale (every
  colour is `#000`, `#fff`, or a white alpha). Body text sits at 21:1 against the
  background and the dimmest label still clears 7:1, so it stays readable in bright
  light. No web fonts, no CDN assets.
- **Knowledge included.** 43 documents (~39k words) on math, reading and writing,
  technology (including full HTML, CSS, JavaScript, and API references), science,
  humanities, and life skills, indexed in the browser.

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
| Context | 8,192 tokens per session (the most the model supports) |
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

You can also use **Model & settings → Upload a .gguf**. Uploaded models are copied
into IndexedDB, appear in the same picker (marked *your upload*), and are selected
automatically from then on. They can be removed from the picker, which frees the
space. Large models are limited by the browser's storage quota and by the tab's
memory — a few hundred MB is comfortable, multi-gigabyte files are not.

The script saves the GGUF into `models/` and registers it in `models/manifest.json`.
Reload the page, open **Model & settings**, and pick it. You can also load any `.gguf`
chat model straight from your computer with **Load a .gguf from this computer**.

Presets: Qwen2.5-Coder 1.5B, Qwen3 4B Instruct 2507, Qwen2.5 0.5B and 1.5B Instruct,
Llama 3.2 1B Instruct. Extra weights are git-ignored; only the bundled 135M model is
committed.

### Which model should build websites?

| Model | Download | Why |
| --- | --- | --- |
| **Qwen2.5-Coder 1.5B Instruct** (Q4_K_M) | ~1.1 GB | The best fit for this app. Code-specialised, 92 languages, Apache-2.0, 32k context, and small enough that a browser tab can hold the weights and still generate at a usable speed. Start here. |
| Qwen3 4B Instruct 2507 (Q4_K_M) | ~2.5 GB | Noticeably better at multi-file, modern HTML/CSS/JS. Needs desktop Chrome and roughly 8 GB of free RAM for the tab; slower per token. |
| Qwen2.5 7B Instruct / Qwen2.5-Coder 7B (Q4) | ~4.7 GB | Better still, but too big for a tab to load reliably. Serve it locally with llama.cpp or Ollama and use the app for everything else. |
| the bundled SmolLM2 135M | 94 MB | Fine for chat and summarizing; too small to write a whole page on its own. |

```sh
python3 tools/fetch_model.py --preset qwen-coder-1.5b   # recommended
python3 tools/fetch_model.py --preset qwen3-4b          # better code, heavier
```

Both also work without the script: download the `.gguf` from Hugging Face and use
**Model & settings → Upload a .gguf**. Treat a browser model as a fast first draft
that you check — the workspace preview, console, and Apply/Undo make that check
cheap.

## The knowledge library

```
knowledge/
├── index.json          generated manifest the app fetches at startup
├── README.md           how the library works and how to extend it
├── math/               6 — arithmetic, algebra, geometry, calculus, statistics, formulas
├── reading/            5 — comprehension, grammar, vocabulary, style, literature
├── technology/         12 — computers, web, programming, AI, security, data,
│                           plus full HTML, CSS, JavaScript, and API references
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
IDF-weighted term score, a coverage bonus for answering the whole question, suffix
stemming (so "fraction" finds "fractions"), and title/phrase bonuses that only apply to
distinctive terms. A relevance floor drops weak matches — a bad passage is worse than
none, because it makes the model cite nonsense.

Answers then take one of two paths:

- **Grounded** — passages matched: they go into the prompt, the answer cites them as `[1]`,
  and the reply may add general knowledge rather than refusing.
- **General** — nothing matched: the model answers from its own knowledge and a line
  under the answer says so ("Answered from the model — no library passage matched").
  It is never told to claim it has no sources, which used to make it refuse plain
  questions like "what is 2+2?".

## The code workspace

Open it with **Workspace** in the sidebar or the top bar (`⌘⇧E` / `Ctrl Shift E`).
It is a small IDE sized for a browser:

- **Files** on the left (`index.html`, `styles.css`, `script.js` by default) stored in
  IndexedDB, importable from your computer, renameable and deletable.
- **Editor** in the middle: line numbers, tab indentation, `⌘S` save, `⌘↵` refresh.
  Changes save automatically as you type.
- **Live preview** on the right in a sandboxed iframe, with desktop/tablet/phone
  widths, pop-out, and a console that captures `console.log`, warnings, and runtime
  errors from the page you are building.
- **Ask Mox** under the preview. Describe a change ("add a dark mode toggle") and the
  model returns complete files; review them and press **Apply changes**. Nothing is
  written until you apply. The workspace toggle **Mox may edit files** also lets chat
  answers apply `mox:write` blocks directly; **Undo** restores the previous version.

The AI receives a manifest of the files, and their contents when the question is
about code, so it edits what is really there instead of guessing.

### Visualising code from chat

Any answer that contains an HTML, CSS, or JavaScript block gets a **Preview code**
button. It loads the snippet into the workspace, wires the stylesheet and script
together, and renders it in the live preview — then you can edit it.

## The calculator

Open it with **Calculator** (`⌘J` / `Ctrl J`). It evaluates expressions with a real
parser rather than `eval`, and it is the same engine that resolves
`<calc>…</calc>` in answers.

- Arithmetic, `^`/`**`, factorial `!`, percent `%`, implicit multiplication
  (`2(3+4)`), hex/binary literals.
- Functions: `sqrt`, `cbrt`, `root`, `pow`, `exp`, `ln`, `log`, `log2`, `abs`,
  `floor`, `ceil`, `round`, `trunc`, `clamp`, `lerp`, `sin`, `cos`, `tan`, `asin`,
  `acos`, `atan`, `atan2`, hyperbolic variants, `deg`, `rad`, `hypot`, `mod`, `rem`,
  `gcd`, `lcm`, `fact`, `ncr`, `npr`, `isprime`, `min`, `max`, `sum`, `product`,
  `mean`, `median`, `mode`, `variance`, `stdev`, `samplevariance`, `samplestdev`,
  `pct`, `increase`, `decrease`, `percentchange`, `random`, `randint`, `convert`.
- Constants: `pi`, `e`, `tau`, `phi`, `inf`, `nan`.
- Natural conversions: `10 km to mi`, `72 F in C`, `20% of 150`, plus a unit panel
  covering length, mass, temperature, time, storage, speed, area, volume, energy,
  pressure, angle, frequency, power, and force.
- History stays in this browser; click an entry to reuse it.

Questions that are purely arithmetic ("what is 1234 × 5678?", "15% of 80",
"convert 10 km to mi") are answered by the calculator directly, so the result is
exact even though the bundled model is small. For scripting,
`__mox.calc('sqrt(2)')` returns `{ ok, value, text }`.

## What you get in the UI

- **Conversations that persist.** Every chat is stored in IndexedDB, listed in the
  sidebar, and restored on reload — switch back to an earlier one, or delete it.
- **Streaming answers** with **Stop** while it writes, then **Copy** and **Regenerate**
  (which re-asks the same question with the same sources).
- **Sources you can open.** Each answer lists the passages it used; click one to read
  the exact text, copy the passage, or open the whole document.
- **Files by drag, drop, or paste** — PDF, Markdown, text, CSV, JSON, HTML, logs — read
  on-device and searchable alongside the bundled library.
- **Offline after the first visit.** A service worker keeps the page itself, so a reload
  with no connection still opens Mox and answers from the loaded model.
- **Keyboard first:** `⌘K` / `Ctrl K` new chat, `⌘/` focus the composer, `⌘J` calculator,
  `⌘⇧E` workspace, `Enter` send, `Shift Enter` newline, `Esc` close, `Tab` cycles
  inside dialogs.
- **Search-only mode:** if the model cannot start, questions still return the matching
  passages instead of failing.
- **Knowledge toggle** in the sidebar, a filterable library by topic, chat export as
  Markdown, and a model panel with a `.gguf` picker.
- **Phone layout** with a slide-in chat drawer and a composer pinned to the bottom.
- **Black and white** throughout, 21:1 contrast for body text.

## Development

```sh
python3 tools/build_knowledge_index.py   # after editing knowledge/
python3 tools/check_site.py              # asset, id, index, GGUF, and branding gate
python3 run.py                           # serve locally on http://localhost:8000

npm install --no-save jsdom fake-indexeddb   # dev-only, for the UI tests
node tests/ui-check.mjs                      # 124 checks in a headless DOM
```

`tests/ui-check.mjs` boots the real `index.html` and `app.js`, then drives them the way
a person would: ask a question, open a source passage, open the phone drawer, reload to
prove the history survived, switch chats, delete one. It also asserts the markdown
renderer, retrieval quality (including singular/plural agreement), the calculator
engine, workspace file writes and preview assembly, and the model picker.

## Project layout

- `index.html`, `styles.css`, `app.js` — the browser app
- `workspace.js` — code workspace: files, editor, sandboxed preview, console, AI edits
- `calculator.js` — expression parser, function library, unit conversions, calculator UI
- `model-store.js` — uploaded GGUF models in IndexedDB, merged into the model picker
- `models/` — `manifest.json` + the bundled GGUF (extra models git-ignored)
- `knowledge/` — the library and its generated `index.json`
- `vendor/wllama/` — llama.cpp WebAssembly runtime (MIT)
- `vendor/pdfjs/` — PDF text extraction for imports (Apache-2.0)
- `tools/fetch_model.py` — download extra GGUF models into `models/`
- `tools/build_knowledge_index.py` — rebuild `knowledge/index.json`
- `tools/check_site.py` — verify assets, ids, manifest and knowledge integrity
- `sw.js` — service worker for offline reloads (network-first, cache as fallback)
- `tests/ui-check.mjs` — headless UI checks (dev only)
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
