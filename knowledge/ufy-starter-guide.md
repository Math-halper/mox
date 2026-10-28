# About this workspace

This is the dark edition of UFY: a local-first AI workspace that runs a compact language model inside your browser and answers from a knowledge library built into the site.

## Starting up

1. Serve the folder: `python3 run.py` (or `start-ufy.command` on macOS, `start-ufy.bat` on Windows).
2. Open the address it prints. The model starts loading automatically.
3. Ask a question. Answers cite the documents they used.

The first load downloads the model into browser storage, which takes a while on a slow connection. Later visits reuse the cache. When the weights are present in `models/`, they are served by this website instead of Hugging Face, so the page works without an external model download.

## The knowledge library

`knowledge/` holds 29 documents — about 18,000 words — covering:

- Mathematics: arithmetic, algebra, geometry, trigonometry, calculus, probability, statistics, and a formula sheet.
- Reading and writing: comprehension, grammar, vocabulary, style, literature, and rhetoric.
- Technology: computers, the internet, programming, AI, security, and databases.
- Science: physics, chemistry, biology, Earth science, and astronomy.
- Humanities: history, geography, culture, philosophy, and critical thinking.
- Life skills: health, personal finance, and study methods.

These files are fetched by the page, split into passages, and scored against each question in the browser. The best passages are placed in the model's prompt as context, and their titles are shown under the answer.

## Adding your own material

Use **Add a folder** or **Add files** to import notes, PDFs, or exported documents. Imported text is stored in this browser's IndexedDB and can be removed from the sidebar at any time.

To add a document to the built-in library so it loads automatically, drop it into `knowledge/` and run `python3 tools/build_knowledge_index.py`.

## What the model does and does not do

The model is Qwen2.5 0.5B Instruct, a small instruction-following model, quantized to 4 bits. It is a text predictor: it can be fluent and confidently wrong. The library passages are the authority for factual questions. Nothing you type trains or modifies the model.

## Privacy

Inference runs on your device with WebGPU when available, otherwise the CPU through WebAssembly. Questions, imported files, and the passages retrieved for them stay in the browser. The only network requests are for the app's own files and, if the model is not stored locally, the model weights.
