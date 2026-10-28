# models/

The website looks here first for model weights, before it ever contacts Hugging Face.

```
models/
└── onnx-community/
    └── Qwen2.5-0.5B-Instruct/
        ├── config.json
        ├── generation_config.json
        ├── tokenizer.json
        ├── tokenizer_config.json
        ├── special_tokens_map.json
        ├── vocab.json
        ├── merges.txt
        └── onnx/
            ├── decoder_model_merged_q4.onnx
            └── decoder_model_merged_q4f16.onnx
```

## Fill it in

```sh
python3 tools/fetch_model.py
```

The script reads the file listing from the Hugging Face API and downloads only the
files the browser engine needs (about 400 MB, mostly the two ONNX weight files).
It also writes `model-manifest.json`.

Check status at any time:

```sh
python3 tools/fetch_model.py --check
```

## Why the weights are not in git

Weight files are large binaries and are ignored by `.gitignore`. Keep them in the
folder on the machine that serves the site, or host `models/` from a static file
service next to the rest of the app.

## How the app decides

On startup the app requests `models/onnx-community/Qwen2.5-0.5B-Instruct/config.json`:

- **Present** → weights are loaded from this site only. No request to Hugging Face.
- **Missing** → the browser downloads weights from the Hugging Face CDN once and
  caches them. The top bar shows which source is in use.

To point at a different model, set `UFY_MODEL_ID` when fetching and change `MODEL_ID`
at the top of `app.js`.
