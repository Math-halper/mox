# Small open language models: SmolLM, Qwen, Llama

Most useful local AI runs on models between 0.5 and 4 billion parameters. They fit in a browser tab or a laptop, they are free, and their licences usually allow redistribution. Knowing which family does what saves a lot of downloading.

## The families

### SmolLM (Hugging Face)

A family of deliberately compact models, **Apache-2.0**, open weights *and* published training data mixes and configs.

- **SmolLM2 135M / 360M / 1.7B Instruct** — the 135M is the size that fits a website: about 94 MB at Q4_1, an 8k context, fluent but with very little factual recall. It is best treated as a summariser and reworder, not an encyclopedia.
- **SmolLM3 3B** — a 3B trained on 11 trillion tokens, dual-mode reasoning (think / no-think), six languages, up to 128k context with NoPE and YaRN scaling. Notably stronger than Llama 3.2 3B and Qwen2.5 3B on published benchmarks.
- **SmolVLM** — the vision sibling: images and text in one conversation, small enough for a device.

### Qwen (Qwen team, Alibaba)

The widest range of sizes of any open family, mostly **Apache-2.0**.

- **Qwen2.5 0.5B / 1.5B / 3B / 7B Instruct** — general chat and writing, 32k context at most sizes.
- **Qwen2.5-Coder 1.5B / 7B** — code-specialised: fill-in-the-middle training, strong at HTML/CSS/JS and Python for its size. The 1.5B at Q4_K_M (about 1.1 GB) is the best value for writing pages inside a browser tab; the 7B needs a desktop.
- **Qwen3** — newer, with "thinking" modes, much longer context, and better reasoning per parameter. Qwen3 4B Instruct is the step up from the 1.5B coder, at roughly 2.5 GB.

### Llama (Meta)

**Llama 3.2 1B / 3B** are the small members of the family. They are competent general chat models with an 8k–128k context depending on the variant, but the important difference is licensing.

## Licences decide more than benchmarks

- **Apache-2.0** (SmolLM, Qwen): use commercially, modify, redistribute, ship in a product — no strings beyond attribution and the usual notices.
- **Llama Community Licence**: usable, but not OSI open source. It carries an acceptable-use policy, a naming/attribution requirement, and thresholds above which it stops being a free-for-all. If a site bundles Llama weights rather than pointing at them, that licence is part of the shipping checklist.
- **Abliterated or "uncensored" variants** remove the refusal behaviour. They are legal to run locally in most places and a bad default for a public product: nothing stops them proposing a destructive command.

## Instruct, base, and quantized

- **Base** models complete text; **instruct** models are tuned to follow a conversation. Anything you chat with should be instruct.
- **Quantization** trades precision for size. Q4_K_M is the usual sweet spot; Q8_0 is nearly lossless and twice the size; below 4-bit, small models start to break in ways that look like personality changes — loops, dropped instructions, wrong tool syntax.
- A model's **context window** is the total budget of tokens it can see at once (prompt plus answer). Retrieval-augmented answers use a fraction of it deliberately: a small model given 40,000 tokens of context usually performs worse than the same model given the right 600.
- **Chat templates** are part of the model, not the runtime. A GGUF without one, or imported without one, will produce rambling output. SmolLM2 and Qwen use ChatML (`<|im_start|>role … <|im_end|>`); Llama 3 uses its own header tokens (`<|start_header_id|>`), and applying the wrong one is a common cause of "the model is broken".

## Fitting a model to a machine

| Target | Sensible ceiling | Example |
| --- | --- | --- |
| Static website, one tab | ~1 GB | SmolLM2 135M (94 MB), Qwen2.5-Coder 1.5B (1.1 GB) |
| Laptop, native app | 4–8 GB | Qwen3 4B, Qwen2.5-Coder 7B, Llama 3.2 3B |
| Desktop GPU, native | 15–40 GB | 14B–32B models at 4–8 bit |

Rough memory rule: gigabytes ≈ parameters in billions × 0.65 at 4-bit, plus about 1–2 GB for context and runtime overhead. A model that does not fit is not slow — it thrashes and appears to hang.

## Choosing for a job

- **Summarising and rewriting** retrieved text: the smallest instruct model in the family is enough, and faster.
- **Writing code**: a code-specialised model at a small size beats a bigger general model at the same memory budget.
- **Following a tool protocol** (emit valid JSON for one function call): use the strongest model you can afford at that size, low temperature, and one call at a time. A 0.5B model cannot reliably do this; a 7B coder can.
- **Anything factual** where the answer matters: retrieval first, model second. At these sizes the model's own knowledge is thin and confident.

## Etiquette

Models are licensed software, and their authors ask for very little. Keep the licence in the manifest, note the model and version in your UI, do not strip the copyright notices, and do not present a small quantized model as a bigger one's equal. When a model is not bundled but downloaded from a hub, say where it comes from — a silent 1 GB download is the sort of thing people remember.
