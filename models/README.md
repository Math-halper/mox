# models/ — the model store

This folder holds the language models the site offers, and the manifest the app reads to build the model picker.

## What is here

| File | Purpose |
| --- | --- |
| `manifest.json` | Lists every model the app can offer: id, name, file, size, parameters, quantization, context length, and license |
| `smollm2-135m-instruct-q4_1.gguf` | The bundled model — SmolLM2 135M Instruct, Q4_1 quantization, about 94 MB, Apache-2.0 |
| `qwen2.5-0.5b-instruct-q4_k_m.gguf` | Optional model, downloaded separately; git-ignored |

## The bundled model

The site ships with one model already committed: SmolLM2 135M Instruct (HuggingFaceTB), Q4_1, roughly 94 MB, Apache-2.0, with an 8,192-token context. It loads from `models/` through `models/manifest.json`, so the weights never leave the site. On a typical laptop it generates a few tokens per second on the CPU — enough for short answers and summarizing retrieved passages, less reliable for facts outside them.

## How models are used

The page reads `manifest.json`, fetches GGUF files from this same website, and runs them in the browser with wllama (llama.cpp compiled to WebAssembly). No Hugging Face download, no API key, and no server are required. Visitors can also upload a `.gguf` from their computer at runtime (**Model & settings → Upload a .gguf**). Uploads are copied into the browser's IndexedDB, appear in the same picker marked "your upload," survive reloads until removed, and are never sent anywhere.

## Which models fit a browser tab

Because the weights load into a single tab's memory, comfortably sized models work best. Qwen2.5-Coder 1.5B Instruct at Q4_K_M (about 1.1 GB) is the sweet spot for building websites — code-specialised, Apache-2.0, 32k context, small enough for a tab. Qwen3 4B Instruct 2507 (Q4_K_M, about 2.5 GB) is the next step up for machines with the memory. Models at 7B and above (roughly 4.7 GB) are better run outside the browser with llama.cpp or Ollama.

Catalog entries in `manifest.json` can point at recommended models not yet on disk, each with a download URL and size; the model screen lists them with a download link so a visitor can fetch the file and upload it without editing this folder.
