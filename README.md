# mox

A local AI agent that runs on your own computer. It reads your files, runs commands, edits code, fetches pages, and keeps going until the task is actually done — with a permission model and a sandbox between it and the rest of your machine.

Runs fully offline against any OpenAI-compatible local model server (Ollama, LM Studio, llama.cpp, vLLM). No cloud account required, no data leaves the box.

```bash
$ mox "find out why the tests fail and fix it"

→ shell  npm test
  ✓ 8.4s  FAIL src/parse.test.ts > handles empty input
→ read_file path=src/parse.test.ts
  ✓ 1ms  ...
→ read_file path=src/parse.ts
  ✓ 1ms  ...
→ edit_file path=src/parse.ts
  ✓ 0ms  edited src/parse.ts (1 replacement)
→ shell  npm test
  ✓ 9.1s  Tests 41 passed (41)

mox (7 steps, 21.4s, 18,204 tokens)
`parse("")` threw because `split("")` returns `[""]`. Guarded it and added a
regression test. Full suite is green.
```

## Make your own assistant (a folder, not a service)

```bash
mox self init ./ada --name Ada     # identity, knowledge, skills, memory — all plain files
mox self chat ./ada                # talk to it: your local model, with tools
mox self train ./ada               # train a small neural net on that folder, from scratch
mox self talk ./ada                # talk to the from-scratch model
```

Everything the assistant is lives in `ada/` — `SELF.md` (who it talks like), `knowledge/*.md` (what it knows), `skills/` (how it works), `memory/` (what it remembers), `config.json`. Edit any of it and the next `mox self chat` picks it up. Put the folder in git if you want to diff your assistant's personality over time.

Two brains, same folder: **`chat`** uses a real local model and mox's tools, so it can actually do things. **`talk`** uses a decoder-only transformer trained on your folder by hand-written backpropagation in `src/tiny/lm.ts` — zero dependencies, ~120k parameters, trained in a couple of minutes. That one is a real language model and it will babble; see [docs/SELF.md](docs/SELF.md) for an honest account of both.

## Why this exists

"Can an AI agent do everything on my computer?" Mostly yes, and the hard part is not the loop — the loop is a few hundred lines. The hard parts are:

1. **Tool coverage** — an agent is exactly as useful as the tools it has.
2. **Permissions** — an agent with your account can also delete your work.
3. **Verification** — an agent that can't check its own output is a random number generator attached to a shell.

mox is built around those three, not around a clever prompt.

## Install (Linux Mint, Ubuntu, Debian, any Linux, macOS)

One command:

```bash
curl -fsSL https://raw.githubusercontent.com/Math-halper/mox/main/install.sh | bash
```

It installs entirely into `~/.local` — **no root, no PPA, no system packages replaced.** Want to read it first (recommended for anything you pipe into bash)? It is 400 lines of plain bash: [install.sh](install.sh). The equivalent with a checkout:

```bash
git clone https://github.com/Math-halper/mox && cd mox && ./install.sh
```

The installer:

1. checks for **Node.js ≥ 22.18** and, if Mint's/Ubuntu's packaged Node is too old, downloads a private copy into `~/.local/share/mox/node` — your system Node is untouched, no PPA, no `sudo`;
2. copies the app to `~/.local/share/mox/app` and writes `~/.local/bin/mox`;
3. adds `~/.local/bin` to `PATH` in `~/.profile` (only that line, marked `# mox: user binaries`);
4. installs **bubblewrap** for the sandbox and fixes the Ubuntu 24.04 / **Mint 22 AppArmor restriction** that silently breaks it;
5. detects a running Ollama / LM Studio / llama.cpp server, or tells you the two commands to get one;
6. runs `mox doctor` so you see exactly what works.

Options: `--yes` (non-interactive), `--no-sandbox`, `--no-node`, `--with-ollama`, `--prefix DIR`, `--uninstall`, `--help`.

Then open a **new terminal** so `PATH` updates, and:

```bash
ollama pull qwen3:8b        # only if the installer didn't find a running server
ollama serve                # or: sudo systemctl start ollama
mox doctor
mox "summarise what this repo does and list the riskiest files"
```

### Linux Mint / Ubuntu notes

- **Mint 22 / Ubuntu 24.04+: bubblewrap needs a sysctl.** The installer offers to write `/etc/sysctl.d/60-mox-userns.conf` to lift AppArmor's unprivileged-userns restriction. Without it, `bwrap` fails with "setting up uid map: Permission denied" and mox runs unsandboxed (policy approvals still apply). Remove the file and `sudo sysctl --system` to revert.
- **Mint's repo Node is too old** (18.x or 20.x). Don't fight it; the installer handles it. If you prefer your own: `--no-node` plus any Node ≥ 22.18 from nvm, fnm, or NodeSource.
- **No Flatpak/snap needed.** Everything lives in `~/.local`.
- **Uninstall:** `mox --help` will not do it — run the installer again with the flag:
  `curl -fsSL https://raw.githubusercontent.com/Math-halper/mox/main/install.sh | bash -s -- --uninstall`.
  That removes the launcher and the app copy. It leaves your `~/.profile` PATH line, the system `bubblewrap` package, Ollama, and any `.mox/` folders in your projects.

### Requirements

- Linux (x86_64 or arm64) or macOS, bash, curl or wget, `tar`, `xz-utils`
- Node 22.18+ (handled automatically)
- Optional: `bubblewrap` (sandbox), `playwright` (browser tool), Ollama / LM Studio / llama.cpp (the model)

## Commands

| Command | What it does |
|---|---|
| `mox "<task>"` | Run one task, print the result, exit |
| `mox chat` | Interactive session that keeps context across turns |
| `mox doctor` | Check node, sandbox, model server, Playwright, MCP |
| `mox init` | Write a starter `mox.config.json` |
| `mox tools` | List every tool the model can call |
| `mox runs` | List past runs with step/call/error counts |
| `mox show latest` | Replay a run's transcript: every call, argument, and result |
| `mox config` | Print the resolved config (API key redacted) |
| `mox self init/chat/ask/talk/train/info` | An assistant defined entirely by a folder |

Useful flags: `--yes` (auto-approve), `--readonly` (deny everything that writes), `--model`, `--base-url`, `--max-steps`, `--verbose`, `--json`, `--no-sandbox`, `--no-mcp`.

## What it can do today

- **Shell** — any CLI: builds, tests, git, package managers, deployment tooling
- **Files** — `read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep`
- **Web (text)** — `http_request` with HTML→text conversion and JSON parsing
- **Web (real browser)** — `browser` drives Chromium through Playwright: navigate, click, fill, screenshot. Optional: `npm i playwright && npx playwright install chromium`
- **Memory** — `remember` / `recall`, persisted to `.mox/MEMORY.md` per project
- **MCP** — any Model Context Protocol server becomes a tool automatically (`mcp__<server>__<tool>`). This is how you reach GitHub, Slack, Notion, Postgres, and your calendar without writing integrations.

Not included yet: desktop GUI control (screenshots + mouse). See [docs/ROADMAP.md](docs/ROADMAP.md) for why that's deliberately last, and what it would take.

## Safety model

Default posture: **ask before anything that changes state.**

```
read_file, grep, list_dir, glob   → run freely
shell, write_file, edit_file      → prompt for approval
rm -rf /, sudo, git push --force,
curl … | bash, ~/.ssh, ~/.aws     → blocked, even with --yes
```

- **Sandbox.** On Linux, shell commands run under `bubblewrap`: system paths read-only, only the project dir and `/tmp` writable, `$HOME` replaced with an empty dir so `~/.ssh` is unreachable, optional network isolation. If `bwrap` is missing, mox says so loudly and keeps going unsandboxed (or refuses, if `sandbox.required` is set).
- **Credential blocks.** SSH keys, AWS/gh/docker/kube credentials and `.netrc` are denied at the policy layer — a prompt-injected model cannot read them, and a permissive rule can't unlock them.
- **Env scrubbing.** Shell children never inherit `*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`.
- **Full traces.** Every run is a JSONL file in `.mox/runs` — inputs, calls, outputs, approvals. Read it before you trust it.
- **Loop guard.** The same call three times in a row gets cut off with an explanation, so small models can't burn your afternoon retrying the same failing command.

Read [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) before pointing this at anything you care about. The short version: **prompt injection is not solved**, and `--yes` on a machine with your credentials and network access is a loaded gun.

## Configuration

`mox.config.json` in the project root (all keys optional). Env vars override file config; CLI flags override both.

```jsonc
{
  "model": {
    "baseUrl": "http://127.0.0.1:11434/v1",
    "name": "",              // empty = first model the server reports
    "apiKey": "local",
    "protocol": "auto",      // auto | native | text
    "temperature": 0.2,
    "maxTokens": 4096
  },
  "policy": {
    "mode": "ask",           // ask | auto | readonly
    "allowDangerous": false,
    "allowOutsideRoots": false,
    "rules": [
      { "tool": "shell", "match": "^npm (test|run build)", "decision": "allow" },
      { "tool": "shell", "match": "\\bgit push\\b", "decision": "ask" },
      { "tool": "http_request", "decision": "deny" }
    ]
  },
  "sandbox": { "mode": "auto", "allowNetwork": true, "maskHome": true, "required": false },
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
                "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "..." } }
  }
}
```

See [examples/mox.config.json](examples/mox.config.json). Env vars: `MOX_MODEL`, `MOX_BASE_URL`, `MOX_API_KEY`, `MOX_MAX_STEPS`, `MOX_APPROVAL`, `MOX_TRACE_DIR`, `MOX_NO_SANDBOX`, `MOX_PROTOCOL`.

## Docs

- [docs/SELF.md](docs/SELF.md) — the editable folder, and what the from-scratch model really is
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the loop works, and how to add a tool
- [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) — what this does and does not protect you from
- [docs/MODELS.md](docs/MODELS.md) — which local model to run, and what to expect
- [docs/ROADMAP.md](docs/ROADMAP.md) — tiers 2 and 3, honestly scoped

## Development

```bash
npm test          # 40 tests: policy, tools, agent loop, CLI end-to-end against a fake model server
npm run typecheck
npm run dev -- "your task"   # watch mode
./install.sh --uninstall && ./install.sh   # reinstall after changing sources
```

No `npm install` is needed to run mox itself — it has zero runtime dependencies. The dev dependencies (`typescript`, `@types/node`) are only for typechecking.

The end-to-end tests spin up a real HTTP server that speaks the OpenAI schema, then run the actual CLI as a subprocess — no model weights needed.

MIT licensed.
