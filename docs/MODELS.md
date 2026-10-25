# Running the brain locally

mox is model-agnostic: anything that speaks `POST /v1/chat/completions` and `GET /v1/models` works. What follows is practical.

## Picking a model by hardware

| Your machine | Sensible choice | What to expect |
|---|---|---|
| 8 GB RAM, no GPU | 4B-class quant (Qwen3-4B, Llama-3.2-3B, Gemma-3-4B) | Single-file edits, short shell tasks. Weak at multi-step plans; expect it to need the loop guard. |
| 16 GB | 7–8B-class (Qwen3-8B, Mistral-7B-v0.3, Llama-3.1-8B) | The honest sweet spot. Handles "read this, fix that, run tests" chains with supervision. |
| 32 GB, or 24 GB GPU | 14B–32B (Qwen3-14B/32B, Devstral-Small, gpt-oss-20b) | Noticeably better tool selection and recovery from its own mistakes. |
| 64 GB+ Mac, or 2×24 GB GPU | 70B-class quant | Closest to cloud quality. Still below a frontier model at 30-step tasks, but usable unattended on narrow jobs. |

RAM needed ≈ parameter count × bytes per weight + context. Q4 is ~0.55 GB per billion parameters. A 8B at Q4_K_M is ~5 GB, plus 2–4 GB for a 16k context.

**Tool-calling matters more than raw intelligence.** A model that emits clean `tool_calls` is worth two that score higher on benchmarks and can't. Everything below is chosen with that in mind.

## Setup

**Ollama** (easiest):

```bash
ollama pull qwen3:8b
ollama serve                 # http://127.0.0.1:11434/v1
mox doctor
```

Ollama maps `/v1` to the OpenAI schema and supports tools. Set `OLLAMA_CONTEXT_LENGTH=16384` (or `num_ctx` in a Modelfile) — the default context is small and long agent transcripts will silently truncate.

**LM Studio** — load a model, start the local server on port 1234, point mox at `http://127.0.0.1:1234/v1`. Its `/v1` is very OpenAI-compatible and the tool-calling support is good.

**llama.cpp** — `llama-server -m model.gguf --port 8080 -c 16384 --jinja`. The `--jinja` flag is what enables proper chat templates and native tool calls; without it you get the text protocol fallback.

**vLLM, LMDeploy, TGI, OpenRouter, a GPU box on your LAN** — all work. Set `MOX_BASE_URL` and `MOX_API_KEY`.

## Concrete configs that work

```json
{ "model": { "baseUrl": "http://127.0.0.1:11434/v1", "name": "qwen3:8b", "temperature": 0.2, "maxTokens": 4096 } }
```

```json
{ "model": { "baseUrl": "http://127.0.0.1:1234/v1", "name": "qwen/qwen3-14b", "protocol": "auto" } }
```

## When tool calls go wrong

Local models fail in predictable ways. mox handles the common ones, and these are the knobs:

| Symptom | Cause | Fix |
|---|---|---|
| Tool calls come back as prose/text | Server doesn't implement `tools` | mox auto-falls-back to the text protocol. Force it with `"protocol": "text"` if detection misfires |
| Arguments are invalid JSON | Small model formatting | `parseToolArgs` repairs fences, trailing commas, single quotes; then it sends the error back. Usually fixes itself on the retry |
| It narrates instead of acting | Prompt, or a chat-tuned model | Lower temperature, enable `systemPromptExtra` with "use tools, don't describe them", or use a stronger model |
| It repeats one failing command | No error recovery | Loop guard fires at 3. If it happens constantly, the model is too small for the task |
| It forgets the task mid-run | Context too small | Raise `num_ctx` to 16k+, reduce `maxSteps`, shorten tool output with `maxToolOutputChars` |
| Slow, 2–5 s per step | CPU inference | Quantize more aggressively (Q4_K_M), offload layers to GPU, or drop to a 4B model |

## Context budgeting

Every step resends the whole conversation. At 16k context and twelve steps with real command output, you will hit the limit. mox caps each tool result at `agent.maxToolOutputChars` (default 12,000) and truncates in the middle, but you should still prefer `grep` over `read_file` on large files and keep `maxSteps` modest (20–40) rather than heroic.

## Cloud models, if you change your mind

Any OpenAI-compatible endpoint works — `MOX_BASE_URL=https://api.openai.com/v1 MOX_API_KEY=sk-…`, or a gateway (LiteLLM, OpenRouter, vLLM on your LAN). The tradeoff is unchanged: the strongest autonomy today is still cloud-hosted, and the price is that your prompts leave the machine. A sane hybrid is a small local model for routine steps with an explicit escalation when it gets stuck — not implemented here, but the `Model` interface is one method deep.
