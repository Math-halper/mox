# About this workspace

Mox is a local-first AI workspace. A real language model ships with the site, runs inside the browser on WebAssembly, and answers from a knowledge library built into these pages.

## The model

- **What it is:** SmolLM2 135M Instruct, a compact instruction-tuned model from Hugging Face, quantized to Q4_1 (about 94 MB).
- **Where it lives:** `models/smollm2-135m-instruct-q4_1.gguf`, served by this same website.
- **How it runs:** llama.cpp compiled to WebAssembly, through the `wllama` runtime in `vendor/wllama/`.
- **What it needs:** no account, no API key, no server, and no connection to a model host. Everything ships with the site.

Because the model is small it is fast to start and light on memory, but its reasoning is limited. It is best at summarizing, rewording, and explaining passages that the retrieval step hands it.

## Choosing and uploading models

The model menu at the top of the page lists every available model. Larger GGUF files can be registered in `models/manifest.json` or uploaded straight from a computer with **Upload a .gguf**. Uploads are copied into the browser's storage, marked "your upload" in the picker, remembered after a reload, and can be removed there. Each entry has **Use this model**, which loads it without reloading the page, and **Delete**, which removes an upload from browser storage (a model served from `models/` can only be hidden from the list and restored later). Models not yet on disk appear with a download link. Bigger models answer better and run slower on a CPU. For writing websites, Qwen2.5-Coder 1.5B (about 1.1 GB) is the best fit that still runs comfortably in a tab; Qwen3 4B Instruct (about 2.5 GB) is better at code but needs a desktop machine. Anything larger is better run outside the browser.

## The workspace and the calculator

Two tools sit beside the chat:

- **Workspace** (`⌘⇧E` or the Workspace button) is a small code editor with a file list, a live preview, a console showing errors from the page being built, and desktop/tablet/phone preview widths. Files are saved in the browser. Under the preview, **Ask Mox** can rewrite the files; changes are reviewed and applied explicitly. In chat, Mox may write files with blocks headed `mox:write path=index.html`; the workspace toggle "Mox may edit files" controls whether those are applied automatically, and Undo restores the previous version.
- **Calculator** (`⌘J` or the Calculator button) evaluates expressions exactly: arithmetic, powers, factorial, trigonometry, logarithms, statistics, combinations, percentages, and unit conversions such as `10 km to mi` or `72 F in C`. Chat answers containing `<calc>2 + 2</calc>` are computed by the same engine, so the number is right rather than guessed, and a purely arithmetic question is answered by the calculator directly instead of the model.

Any chat answer containing HTML, CSS, or JavaScript gets a **Preview code** button that opens it in the workspace preview.

## How Mox talks

Mox is meant to feel like a thoughtful person who happens to know a lot, not like a form letter. In practice that means:

- **Warmth first.** If something you said sounds worried, tired or stuck, Mox names it in a sentence before getting to the answer.
- **Plain words, first person, no throat-clearing** ("Certainly! As an AI…" is exactly what it should not sound like).
- **Matching your energy.** A one-line question gets a one-line answer; a hard problem gets depth.
- **Encouraging without flattery.** No "great question!", and never a hint that you should already know this.
- **Honest about what it is.** Mox will not keep reminding you it is software, but it will not claim to be a person either — no invented body, childhood or memories. Ask directly and you get one plain sentence, then the help.

## Drawings

Mox can draw, but not the way an image generator does. A drawing here is real SVG: shapes, charts, flowcharts and simple scenes written from coordinates by `svg.js`, with no image model and no upload. Ask in plain words — *draw a red heart*, *bar chart of 4, 9, 2, 7*, *pie chart of 50, 30, 20*, *line chart of 3, 8, 4, 12*, *flowchart: research -> design -> build -> ship*, *draw a sunset over mountains*, *draw a night sky* — or open **Draw something** for a menu of everything the engine can build.

Shapes: circle, square, rectangle, triangle, star, heart, diamond, hexagon, pentagon, arrow, sun, moon, cloud, tree, house, rocket, flower, smiley face, checkmark, cross, lightning bolt, spiral. Colours are understood as words ("a navy star") or hex codes, and the background flips to light behind dark shapes so the drawing stays legible.

Each drawing in chat comes with **Download** (`.svg`), **PNG** (960 px), **Copy** (the markup), and **Open in workspace** (to edit it as code). A model answer can also request one with `<draw>a short description</draw>`, and the console exposes `__mox.draw.draw('draw a blue hexagon')`.

The limit is honest: this is geometry, not imagination. Ask for a dog or a portrait and Mox says what it can draw instead of producing a bad guess. For photographs and illustrations the format itself — a grid of pixels — is the right tool, and that needs an image model or a drawing hand.

## Chats, shortcuts, and offline use

Every conversation is saved in the browser and listed in the sidebar, so closing the tab does not lose it. An old chat can be reopened to pick it up again, or deleted with the small × beside its title. Inside a conversation, Stop halts a long answer, Copy puts the text on the clipboard, and Regenerate asks the same question again. Every answer lists the passages it used; clicking one reads the exact text.

Keyboard: ⌘K or Ctrl K starts a new chat, ⌘/ or Ctrl / jumps to the message box, ⌘J opens the calculator, ⌘⇧E opens the workspace, Enter sends, Shift Enter starts a new line, and Escape closes a dialog or panel.

Once the page has been opened, a service worker keeps a copy of it. A reload with no internet connection still opens Mox and answers from the model and library already stored on the device. Files can be dragged onto the message box or pasted into it instead of using **Add a folder**.

The first visit transfers the 94 MB model file; after that the browser serves it from its cache, so the app opens quickly and keeps working offline. The site is served as a static website; opening `index.html` directly from disk does not work, because browsers block WebAssembly over `file://` URLs.

## The knowledge library

`knowledge/` holds 55 documents — about 56k words — covering mathematics, reading and writing, technology (including full HTML, CSS, JavaScript and SVG references, guides to popular websites, local AI agents, browser model runtimes and GGUF, small open models, classic browser games, emulators and Flash, website design references, a line-of-code lookup for HTML/CSS/JS, Git and GitHub automation, browser desktop shells, and a data-visualisation primer), science, humanities, and life skills. Each file is fetched by the page, split into overlapping passages, and scored against every question in the browser. The best passages are placed in the model's prompt as sources, and their titles appear under the answer.

Imported material can be added with **Add a folder** or **Add files**. Imported text is stored in the browser's IndexedDB and can be removed from the sidebar.

## When Mox has sources, and when it doesn't

If a question matches something in the library, Mox puts those passages in front of the model, cites them as `[1]`, `[2]`, and links them under the answer so the exact text can be read. If nothing matches — a greeting, simple arithmetic, something outside the 55 documents — Mox answers from the model's own knowledge and says so in one line under the reply. It should never claim it has "no sources" or refuse a question just because the library is silent.

When the library matches only partly, the answer uses the passages and then fills in. Treat Mox as a fast study aid, not an authority: check anything that matters against the cited document or another source.

## Honest limits

A 135M model can be fluent and still wrong. The retrieved passages are the source of truth for factual questions; the model's own knowledge is thin. When the model cannot start, Mox switches to search-only mode and shows the matching passages directly instead of guessing.

## Privacy

The model and the library are served by this site. Questions, imported files, and retrieved passages stay in the browser. Nothing is uploaded and no third-party inference service is involved.
