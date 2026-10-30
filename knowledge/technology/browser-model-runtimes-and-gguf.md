# Running a language model in the browser: wllama, llama.cpp, and GGUF

A web page can run a real language model without a server. The recipe is three layers: llama.cpp does the inference, WebAssembly lets it run in a tab, and a binding makes it usable from JavaScript.

## llama.cpp

llama.cpp is a C/C++ inference engine for transformer models, MIT licensed, and the reference implementation for the GGUF format. It runs on CPUs, GPUs and phones, supports most open model architectures, and does the two things that matter for local inference: quantized weights (so a model fits in memory) and streaming token generation.

## GGUF

GGUF is a single-file model format: a header with metadata, a tokenizer, a chat template, and tensors at various precisions. One file, no sidecar, which is why it is the format every local runner uses.

- The file starts with the magic bytes `GGUF`; a file that does not begin with them is not a model, however it is named.
- Metadata includes the architecture, context length, embedding size, layer count, and often the chat template (`tokenizer.chat_template`).
- Quantization names say how many bits per weight: `Q4_K_M` is a 4-bit mix with the important tensors kept a little larger, `Q5_K_M` and `Q8_0` are progressively larger and more accurate, `Q4_1`/`Q4_0` are older and simpler. Rule of thumb: a model of N billion parameters at 4-bit is roughly 0.6–0.7 GB per billion parameters.
- Split GGUFs (`model-00001-of-00002.gguf`) are one model in pieces; loaders should treat them as a unit, and streaming loaders can fetch the pieces in parallel.
- **SafeTensors, ONNX, PyTorch checkpoints and generic `.bin` files are not GGUF.** A runner should list them and say "not runnable here" rather than failing obscurely.

## WebAssembly, SIMD and threads

Both llama.cpp and the numerics underneath it compile to WebAssembly. Three details decide how fast it feels:

- **SIMD** — WebAssembly SIMD instructions are what make a CPU tensor multiply usable at all. Every modern browser has them.
- **Threads** — WebAssembly threads need `SharedArrayBuffer`, which a page only gets when it is *cross-origin isolated*: the response must carry `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. A static host that cannot set headers needs a small service-worker shim that adds them and reloads once.
- **WebGPU** — newer runtimes can offload to the GPU through WebGPU, which is dramatically faster when available and falls back to CPU when not. Firefox support has lagged, and some builds disable it there.
- **Workers** — inference must run in a Web Worker or the page freezes while tokens are generated.

## wllama

wllama (MIT) is the WebAssembly binding for llama.cpp designed for browser apps. What it offers:

- an **OpenAI-compatible API** — `createCompletion` and `createChatCompletion`, the same shapes as the hosted APIs, so client code ports over;
- **streaming** through an `onData` callback, with an abort signal to cancel mid-generation;
- **embeddings** and reranking for retrieval;
- **tool calling** and **multimodal** input (images, audio) with supporting models;
- single- and multi-thread builds, chosen automatically based on what the browser supports;
- loading a model from a URL or from `Blob`/`ArrayBuffer` data, which is how a page serves weights from its own site or from a user's file upload;
- everything inside a worker, so the UI keeps rendering.

Its two hard limits are worth knowing before promising anything: multi-threaded mode requires the two cross-origin-isolation headers, and a single `ArrayBuffer` cannot exceed about 2 GB, so base64-in-JS tricks and giant models need split files instead.

A compatible build (`wllama-compat`) exists for browsers missing newer WebAssembly features. It loads its own binaries from a CDN by default and is significantly slower — a site that promises "nothing leaves your device" should vendor it locally rather than let it fetch from a CDN.

## The practical pipeline

1. **Load.** Fetch the GGUF (from the site, or from cache), show progress, and keep it in the browser's HTTP cache so a reload does not re-download 100 MB.
2. **Verify.** Check the `GGUF` magic bytes and, ideally, a checksum from a manifest.
3. **Create the context.** Set the context size deliberately: larger context costs memory and slows prompt processing. 4k–8k is plenty for retrieval-augmented chat.
4. **Prompt.** Apply the model's chat template if it has one; fall back to ChatML for SmolLM2/Qwen-style models when it does not.
5. **Sample.** Low temperature for factual or structured output, a repetition penalty for small models that loop, stop tokens for the template's end markers.
6. **Stream and cancel.** Render tokens as they arrive, and let a stop button abort the request.
7. **Unload.** Free the model when switching models; holding several in memory in one tab is how a page gets killed by the browser.

## Why a page should serve its own weights

Fetching a model from a third-party CDN is convenient and quietly breaks the privacy claim: the model host learns who loaded what. Serving the GGUF from the same origin keeps the promise, works offline after the first visit (with a service worker or the HTTP cache), and avoids availability depending on someone else's repository. The cost is repository size, so the sensible split is: one small model bundled, larger ones offered as optional downloads with explicit sizes.

## What a browser model can and cannot do

- A 135M–1.5B model is fast to start and light on memory; it is good at summarising, rewording, and explaining passages handed to it, and weak at facts it has to recall on its own.
- A 1.5B code-specialised model can write and edit small HTML/CSS/JS files competently; a 4B is better but needs desktop-class memory.
- 7B and above is a job for a native app (llama.cpp, Ollama, LM Studio), not a single tab.
- Retrieval does more for answer quality at this size than any sampling tweak. Put the right 600 words in front of a small model and it looks competent; ask it to remember something and it does not.
