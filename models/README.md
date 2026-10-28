# models/

This folder is the model store for the site. The page reads `manifest.json`, fetches the
GGUF files listed there **from this website**, and runs them in the browser with wllama
(llama.cpp in WebAssembly).

```
models/
├── manifest.json                        what the app offers in Model & settings
├── smollm2-135m-instruct-q4_1.gguf      bundled, committed (94 MB, Apache-2.0)
└── qwen2.5-0.5b-instruct-q4_k_m.gguf    optional, downloaded, git-ignored
```

## The bundled model

| Field | Value |
| --- | --- |
| Model | `HuggingFaceTB/SmolLM2-135M-Instruct` |
| Quantization | Q4_1 (GGUF v3) |
| Size | 98,362,432 bytes |
| Context | 8,192 trained and used per session |
| License | Apache-2.0 |

It is committed so a fresh clone runs a real model with no downloads.

## Adding a model

```sh
python3 tools/fetch_model.py --list               # presets
python3 tools/fetch_model.py --preset qwen-0.5b   # ~400 MB
python3 tools/fetch_model.py --url <gguf-url> --name "My model"
python3 tools/fetch_model.py --check
```

Each download is registered in `manifest.json`:

```json
{
  "id": "qwen2.5-0.5b-instruct-q4_k_m",
  "name": "Qwen2.5 0.5B Instruct",
  "file": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
  "bytes": 412345678,
  "parameters": "0.5B",
  "quantization": "Q4_K_M",
  "context": 32768,
  "license": "Apache-2.0"
}
```

To add one by hand, copy the `.gguf` in, append an entry, and reload the page.

You can also upload a `.gguf` from your computer at runtime without touching this
folder (**Model & settings → Upload a .gguf**). Uploads are copied into the browser's
IndexedDB, appear in the same picker marked *your upload*, and survive reloads until
you remove them. They are never sent anywhere. Keep uploads to a few hundred MB: the
browser's storage quota and the tab's memory are the limit, not git.

## Which model to add for code

For building websites in this app, `Qwen2.5-Coder-1.5B-Instruct` at Q4_K_M (about
1.1 GB) is the sweet spot: code-specialised, Apache-2.0, 32k context, and small
enough for a browser tab. `Qwen3-4B-Instruct-2507` (Q4_K_M, about 2.5 GB) is the
next step up if the machine has the memory. Anything at 7B and above (about 4.7 GB)
should be run by llama.cpp or Ollama outside the tab.

```sh
python3 tools/fetch_model.py --preset qwen-coder-1.5b
python3 tools/fetch_model.py --preset qwen3-4b
```

## Why only one file is in git

GitHub rejects files above 100 MB, and weight binaries bloat a repository. The bundled
135M model sits just under that limit; everything else is listed in `.gitignore` and is
expected to live on the machine that serves the site.

## Requirements for a model

- GGUF format with a chat template in its metadata (most instruct models have one).
- Under roughly 2 GB: the weights are loaded into a single browser tab's memory.
