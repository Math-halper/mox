# About this workspace

Mox is a local-first AI workspace. A real language model ships with the site, runs inside your browser on WebAssembly, and answers from a knowledge library built into these pages.

## The model

- **What it is:** SmolLM2 135M Instruct, a compact instruction-tuned model from Hugging Face, quantized to Q4_1 (about 94 MB).
- **Where it lives:** `models/smollm2-135m-instruct-q4_1.gguf`, served by this same website.
- **How it runs:** llama.cpp compiled to WebAssembly, through the `wllama` runtime in `vendor/wllama/`.
- **What it needs:** no account, no API key, no server, and no connection to a model host. Everything ships in this folder.

Because the model is small it is fast to start and light on memory, but its reasoning is limited. It is best at summarizing, rewording, and explaining passages that the retrieval step hands it.

### Choosing and uploading models

Open the model menu at the top of the page to see every available model. Download a larger GGUF once (for example `python3 tools/fetch_model.py --preset qwen-0.5b`) and list it in `models/manifest.json`, or upload a `.gguf` straight from your computer with **Upload a .gguf**. Uploads are copied into this browser's storage, marked "your upload" in the picker, remembered after a reload, and can be removed there. Bigger models answer better and run slower on a CPU. For writing websites, Qwen2.5-Coder 1.5B (about 1.1 GB) is the best fit that still runs comfortably in a tab; Qwen3 4B Instruct (about 2.5 GB) is better at code but needs a desktop machine. Anything larger is better run outside the browser.

## The workspace and the calculator

Two tools sit beside the chat and do not need the model to work:

- **Workspace** (`⌘⇧E` or the Workspace button) is a small code editor with a file list, a live preview of `index.html`, a console that shows errors from the page you are building, and desktop/tablet/phone preview widths. Files are saved in this browser. Under the preview, **Ask Mox** can rewrite the files: you review the changes and press Apply. In chat, Mox may also write files by replying with blocks headed `mox:write path=index.html`; the workspace toggle "Mox may edit files" controls whether those are applied automatically, and Undo restores the previous version.
- **Calculator** (`⌘J` or the Calculator button) evaluates expressions exactly: arithmetic, powers, factorial, trigonometry, logarithms, statistics, combinations, percentages, and unit conversions such as `10 km to mi` or `72 F in C`. Answers in chat that contain `<calc>2 + 2</calc>` are computed by the same engine, so the number is right rather than guessed, and a question that is only arithmetic ("what is 1234 × 5678?") is answered by the calculator directly instead of the model.
- Any chat answer containing HTML, CSS, or JavaScript gets a **Preview code** button that opens it in the workspace preview.

## Chats, shortcuts, and offline use

Every conversation is saved in this browser and listed in the sidebar, so closing the tab does not lose it. Open an old chat to pick it up again, or press the small × beside its title to delete it. Inside a conversation, Stop halts a long answer, Copy puts the text on the clipboard, and Regenerate asks the same question again. Every answer lists the passages it used: click one to read the exact text.

Keyboard: ⌘K or Ctrl K starts a new chat, ⌘/ or Ctrl / jumps to the message box, ⌘J opens the calculator, ⌘⇧E opens the workspace, Enter sends, Shift Enter starts a new line, and Escape closes a dialog or a panel.

Once the page has been opened, a service worker keeps a copy of it. A reload with no internet connection still opens Mox and answers from the model and library already stored on the device. Files can be dragged onto the message box or pasted into it instead of using the Add a folder button.

## Starting up

Mox is a static website, so there is nothing to install.

- **Hosted:** open the published address (for this project, `https://math-halper.github.io/mox/`). The model loads automatically on the first visit.
- **Local:** run `python3 run.py` (Windows: `start-mox.bat`, macOS: `start-mox.command`) and open the address it prints, usually `http://localhost:8000`.

The first visit transfers the 94 MB model file; after that the browser serves it from its cache, so the app opens quickly and keeps working offline. Opening `index.html` directly from disk does not work, because browsers block WebAssembly over `file://` URLs.

## The knowledge library

`knowledge/` holds 43 documents — about 39k words — covering:

- Mathematics: arithmetic, algebra, geometry, trigonometry, calculus, probability, statistics, and a formula sheet.
- Reading and writing: comprehension, grammar, vocabulary, style, literature, and rhetoric.
- Technology: computers, the internet, programming, AI, security, databases, APIs, and full reference documents for HTML, CSS, and JavaScript.
- Science: physics, chemistry, biology, Earth science, and astronomy.
- Humanities: history, geography, culture, philosophy, and critical thinking.
- Life skills: health, personal finance, and study methods.

Each file is fetched by the page, split into overlapping passages, and scored against every question in the browser. The best passages are placed in the model's prompt as sources, and their titles appear under the answer.

## Adding your own material

Use **Add a folder** or **Add files** to import notes, PDFs, or exported documents. Imported text is stored in this browser's IndexedDB and can be removed from the sidebar.

To add a document to the built-in library so it loads automatically, drop it into `knowledge/` and run `python3 tools/build_knowledge_index.py`.

## When Mox has sources, and when it doesn't

If your question matches something in the library, Mox puts those passages in front of the model, cites them as [1], [2], and links them under the answer so you can read the exact text. If nothing matches — a greeting, simple arithmetic, something outside the 43 documents — Mox answers from the model's own knowledge and says so in one line under the reply. It should never claim it has "no sources" or refuse a question just because the library is silent.

When the library does match but only partly, the answer uses the passages and then fills in. Treat it as a fast study aid, not an authority: check anything that matters against the cited document or another source.

## Honest limits

A 135M model can be fluent and still wrong. The retrieved passages are the source of truth for factual questions; the model's own knowledge is thin. When the model cannot start, Mox switches to search-only mode and shows the matching passages directly instead of guessing.

## Privacy

The model and the library are served by this site. Your questions, imported files, and retrieved passages stay in the browser. Nothing is uploaded and no third-party inference service is involved.
