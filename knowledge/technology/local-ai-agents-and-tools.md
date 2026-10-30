# Running a language model locally, and letting it use tools

A local assistant is three things wired together: a model server, an agent loop, and a set of tools. Nothing has to leave the machine, and no account or API key is required.

```
you ──► front end (browser or CLI) ──► agent loop ──► model server (localhost)
                                          │
                                          ├── shell commands and files (with your approval)
                                          ├── editor and code runner
                                          ├── web fetch and search
                                          ├── desktop apps, media players, documents
                                          └── Git and GitHub
```

## The model server

Three servers cover almost everything:

- **Ollama** — default port `11434`, chat at `/api/chat`, its own model registry (`ollama pull`, `ollama list`).
- **LM Studio** — OpenAI-compatible server at `/v1/chat/completions`, default port `1234`; you load a GGUF in the app, then start the server.
- **llama.cpp** — `llama-server`, default port `8080`; needs `--jinja` for tool-call templates to work.

A well-behaved client probes all three and uses whichever is already serving a usable model, with a flag to force one (`--backend ollama|openai --host http://127.0.0.1:1234`).

### Model files

**GGUF** is the runnable format for all three. Inside a `models/` folder, an inventory pass should:

- list every `.gguf` it finds, including subfolders and both the app's install directory and the current directory;
- recognise **split shards** (`model-00001-of-00002.gguf`) as one model, not two;
- skip incomplete downloads (`*.part`);
- mark SafeTensors, ONNX, PyTorch and plain `.bin` files as *visible but not runnable*, rather than feeding them to a runtime that cannot load them.

### Templates matter more than the weights

A raw GGUF imported with a bare `FROM` has no chat template, so tool calls come out as rambling text and the model never stops talking. Importing with the correct Modelfile — ChatML markers, the tool-call format, stop tokens — is the difference between an agent that works and one that appears broken. Qwen-family coder models want ChatML plus `<tool_call>`; keep a minimal template for unknown GGUFs so the file's own metadata is used.

### Sampling for tool use

Tool calls are structured output, so they want low randomness: temperature around 0.1–0.3, `top_p` ~0.8–0.92, `top_k` 20–40, a mild repetition penalty (1.05–1.25). A **one-tool-at-a-time** loop is slower but produces far fewer malformed calls than asking a small model to plan several steps at once.

## The agent loop

1. Send the task, a system prompt, and the tool schemas to the model.
2. The model replies with a tool call, e.g. `run_command {"command": "df -h"}`.
3. Check the call: is it allowed, does it need confirmation, is it dangerous?
4. Run it, truncate the output, send the result back.
5. Repeat until the model answers, up to a step cap (12 is a sane default).
6. Cut off **identical repeated calls** — small models loop, and a loop that repeats a failing command wastes minutes.

Truncating long command output is not cosmetic: a wall of `apt` logs eats the context window and makes every later turn slower and dumber.

## Tool-call dialects a client must accept

Small local models emit tool calls in whatever shape their training left them with. Parse all of these:

- native `tool_calls` (Ollama and OpenAI-compatible)
- `<tool_call>{"name": …, "arguments": …}</tool_call>` and the `[tool_call]` variant
- Hermes-style `<function=…><parameter=…>…</parameter></function>` XML
- plain or fenced JSON, sometimes with the name outside the object
- Python-like text: `run_command(command="ls -l")`

Also normalise **synonyms** (`bash`, `execute_command`, `cmd`, `shell` → the run-command tool; `search_query` → web search). When a call is malformed, send it back with "reply in exactly this format" — twice, then give up gracefully. Strip leaked chat tokens (`<|im_end|>`, `<|im_start|>`) from answers.

If a server rejects native tools entirely, fall back to the text protocol rather than failing.

## Safety that actually holds

An agent that can run commands is an agent that can delete your files. The design rules that keep this honest:

- **Ask before acting.** Every shell command and file write shows `[y/N]`, as do app launches and Git/GitHub writes. In a browser front end, route the same prompts to approval dialogs instead of stdin.
- **Classify danger separately from ordinary actions.** A `--yolo` / auto-approve mode should skip routine prompts only. Destructive patterns always require a typed `YES`: `rm -rf /`, `mkfs`, `dd` to a disk, `shutdown`/`reboot`, `curl … | bash`, fork bombs, and anything with `sudo`.
- **Never auto-approve merges.** Merging a pull request is the classic irreversible-enough action: require explicit typed confirmation, not a flag.
- **Remove whole capabilities.** If deletion of repositories or accounts is not needed, do not implement it at all — an unimplemented action cannot be prompted into existence.
- **Refuse, don't hang, in non-interactive use.** Piped input cannot answer a prompt, so anything needing confirmation is refused.
- **Keep secrets out of the loop.** Never print tokens, never pass them to the model, and strip them from subprocess environments. GitHub reads can use the REST API; writes go through the `gh` CLI as *you*.
- **Constrain the filesystem.** Workspace APIs reject any path outside the chosen folder; the front end binds to `127.0.0.1` and requires a random per-launch token (cookie or `X-Token` header).
- **Bound the network.** Web fetches are GET-only and capped (~2 MB), and binaries are not shown to the model.
- **Be clear that it is not a sandbox.** Local code execution runs as your user. That is a feature for your own code and a hazard for code you have not read.

Say this out loud in the interface. A confirmation dialog is only meaningful if the person knows why it appeared.

## Context, speed, and honest expectations

- A 7B model at Q4_K_M is ~4.7 GB and wants ~6 GB free RAM/VRAM with context. An 8k context is a good default; a model's full 32k window costs speed and memory.
- Keep the model warm between calls (Ollama's keep-alive, ~10 minutes) — the first reply after idle includes load time.
- Smaller models are dumber, not just faster. A 7B coder handles "find the big folders", "what is using port 8080", "summarise this page" and most scripting tasks; long autonomous jobs need steering.
- Tools that fail should say why in one line and the model should try another route, not retry the same call.

## Testing an agent without a model

The whole loop can be tested deterministically: fake the model server (canned tool-call JSON), fake the GitHub API, fake binaries for `playerctl`, `ffprobe`, `libreoffice`, and drive the real HTTP front end on an ephemeral port. Pin the installer wizard with scripted stdin, use a temporary Git repository, and assert on the actions taken rather than on model prose. Dozens of such tests run in seconds, offline, and catch the failures that matter: a tool call that never executes, a confirmation that was skipped, a path that escaped the workspace.
