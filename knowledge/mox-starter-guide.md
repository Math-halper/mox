# About this workspace

Mox is a local-first AI workspace. A real language model ships with the site, runs inside your browser on WebAssembly, and answers from a knowledge library built into these pages.

## The model

- **What it is:** SmolLM2 135M Instruct, a compact instruction-tuned model from Hugging Face, quantized to Q4_1 (about 94 MB).
- **Where it lives:** `models/smollm2-135m-instruct-q4_1.gguf`, served by this same website.
- **How it runs:** llama.cpp compiled to WebAssembly, through the `wllama` runtime in `vendor/wllama/`.
- **What it needs:** no account, no API key, no server, and no connection to a model host. Everything ships in this folder.

Because the model is small it is fast to start and light on memory, but its reasoning is limited. It is best at summarizing, rewording, and explaining passages that the retrieval step hands it.

### Upgrading the model

Download a larger GGUF once (for example `python3 tools/fetch_model.py --preset qwen-0.5b`), or drop any `.gguf` chat model into `models/` and list it in `models/manifest.json`. Open **Model & settings** in the sidebar to switch between the models on disk. Bigger models answer better and run slower on a CPU.

## Chats, shortcuts, and offline use

Every conversation is saved in this browser and listed in the sidebar, so closing the tab does not lose it. Open an old chat to pick it up again, or press the small × beside its title to delete it. Inside a conversation, Stop halts a long answer, Copy puts the text on the clipboard, and Regenerate asks the same question again. Every answer lists the passages it used: click one to read the exact text.

Keyboard: ⌘K or Ctrl K starts a new chat, ⌘/ or Ctrl / jumps to the message box, Enter sends, Shift Enter starts a new line, and Escape closes a dialog or the phone drawer.

Once the page has been opened, a service worker keeps a copy of it. A reload with no internet connection still opens Mox and answers from the model and library already stored on the device. Files can be dragged onto the message box or pasted into it instead of using the Add a folder button.

## Starting up

Mox is a static website, so there is nothing to install.

- **Hosted:** open the published address (for this project, `https://math-halper.github.io/mox/`). The model loads automatically on the first visit.
- **Local:** run `python3 run.py` (Windows: `start-mox.bat`, macOS: `start-mox.command`) and open the address it prints, usually `http://localhost:8000`.

The first visit transfers the 94 MB model file; after that the browser serves it from its cache, so the app opens quickly and keeps working offline. Opening `index.html` directly from disk does not work, because browsers block WebAssembly over `file://` URLs.

## The knowledge library

`knowledge/` holds 39 documents — about 29k words — covering:

- Mathematics: arithmetic, algebra, geometry, trigonometry, calculus, probability, statistics, and a formula sheet.
- Reading and writing: comprehension, grammar, vocabulary, style, literature, and rhetoric.
- Technology: computers, the internet, programming, AI, security, and databases.
- Science: physics, chemistry, biology, Earth science, and astronomy.
- Humanities: history, geography, culture, philosophy, and critical thinking.
- Life skills: health, personal finance, and study methods.

Each file is fetched by the page, split into overlapping passages, and scored against every question in the browser. The best passages are placed in the model's prompt as sources, and their titles appear under the answer.

## Adding your own material

Use **Add a folder** or **Add files** to import notes, PDFs, or exported documents. Imported text is stored in this browser's IndexedDB and can be removed from the sidebar.

To add a document to the built-in library so it loads automatically, drop it into `knowledge/` and run `python3 tools/build_knowledge_index.py`.

## When Mox has sources, and when it doesn't

If your question matches something in the library, Mox puts those passages in front of the model, cites them as [1], [2], and links them under the answer so you can read the exact text. If nothing matches — a greeting, simple arithmetic, something outside the 39 documents — Mox answers from the model's own knowledge and says so in one line under the reply. It should never claim it has "no sources" or refuse a question just because the library is silent.

When the library does match but only partly, the answer uses the passages and then fills in. Treat it as a fast study aid, not an authority: check anything that matters against the cited document or another source.

## Honest limits

A 135M model can be fluent and still wrong. The retrieved passages are the source of truth for factual questions; the model's own knowledge is thin. When the model cannot start, Mox switches to search-only mode and shows the matching passages directly instead of guessing.

## Privacy

The model and the library are served by this site. Your questions, imported files, and retrieved passages stay in the browser. Nothing is uploaded and no third-party inference service is involved.
