# Architecture

mox is small on purpose. The whole thing is ~2,500 lines of TypeScript with zero runtime dependencies; the only dev dependencies are `typescript` and `@types/node`, and Node 22.18+ strips the types at load time.

```
your task
   │
   ▼
┌──────────────┐    messages + tool schemas    ┌──────────────────┐
│   Agent      │ ────────────────────────────▶ │  local model      │
│  (agent.ts)  │ ◀──────────────────────────── │  (OpenAI-compat)  │
└──────┬───────┘      text and/or tool_calls   └──────────────────┘
       │
       │ one call at a time
       ▼
┌──────────────┐   allow/ask/deny   ┌──────────────┐
│  Policy      │ ◀────────────────▶ │  Approver    │  (terminal prompt)
│ (policy.ts)  │                    └──────────────┘
└──────┬───────┘
       │ allowed
       ▼
┌──────────────┐   argv prefix    ┌──────────────┐
│  Sandbox     │ ───────────────▶ │  Tool exec   │
│ (sandbox.ts) │                  │ (tools/*.ts) │
└──────────────┘                  └──────┬───────┘
                                         │ result (truncated)
                                         ▼
                                  back to the model
```

Every step is written to `.mox/runs/<id>.jsonl` before it is displayed, so a crashed run is still a readable transcript.

## The loop (`src/agent.ts`)

1. Build a system prompt: environment, tool list, sandbox description, approval mode, project memory.
2. Send `messages` + `tools` (JSON schemas) to the model.
3. If the response has no `tool_calls`, it's the final answer — stop.
4. Otherwise, for each call **in order**:
   - parse the arguments (local models produce broken JSON; see `parseToolArgs`)
   - look up the tool; unknown tools come back as an error the model can read
   - evaluate policy → allow / ask / deny
   - execute (sandboxed where relevant), truncate output, append as a `tool` message
5. Repeat until the model answers, the step limit hits, the loop guard fires, or you Ctrl-C.

Design choices worth knowing:

- **Serial tool calls.** Parallel calls would be faster, but a local model's second call often depends on the first one's output, and serial execution makes traces readable. Easy to parallelize later for read-only tools.
- **Errors are messages, not exceptions.** A failed tool becomes a `tool` message starting with `Error:`. The model gets a chance to fix itself, which is most of what makes agents feel competent.
- **The loop guard.** Three identical calls in a row → the fourth is refused with an explanation. Small models get stuck; this converts an infinite loop into a recoverable state.
- **Truncation is middle-out.** Command output is cut in the middle so both the beginning and the error at the end survive.
- **Prompt rebuild on protocol change.** If the model server rejects native tool calling, `OpenAIModel` flips to the text protocol and the agent rewrites the system prompt to explain the `<tool_call>` format mid-run.

## Tools (`src/tools/`)

A tool is a plain object:

```ts
const myTool: ToolDef = {
  name: "jira_search",
  description: "Search Jira issues by JQL. Returns id, title, status.",
  readOnly: true,
  parameters: {
    type: "object",
    properties: { jql: { type: "string" } },
    required: ["jql"],
  },
  async execute(args, ctx) {
    // ctx.cwd, ctx.config, ctx.sandbox, ctx.signal, ctx.notice()
    return "PROJ-12 | Fix login | In Progress";
  },
  escalate: (args) => (String(args.jql).includes("delete") ? "suspicious JQL" : null),
};
```

Register it in `builtinTools()` (`src/tools/index.ts`) and it appears in the prompt, the schemas, `mox tools`, and the trace automatically.

Guidance that matters more than the interface:

- **Descriptions are the API docs for the model.** Say when to use the tool, when not to, and what the output looks like. Vague descriptions are the #1 cause of bad tool selection.
- **Return compact text.** The model pays for every token you return, and long outputs dilute attention. Summarise, cap, and point at files for details.
- **Mark `readOnly` honestly.** It is what lets a tool skip the approval prompt.
- **Throw `ToolError` with a fixable message.** "no such file: /x/y (did you mean src/y?)" beats "ENOENT".

## Policy (`src/policy.ts`)

Four layers, first match wins:

1. **Hard blocks** — credential paths, fork bombs, block-device writes. Not overridable by config.
2. **Dangerous shell** — `rm -rf /`, `sudo`, force-push, `curl | bash`, … Denied by default; `allowDangerous: true` downgrades to a prompt.
3. **User rules** — `{ tool, match, decision }` from config, in order. This is where you encode "npm test is always fine".
4. **Mode** — `readonly` (only read-only tools), `ask` (default; mutating tools prompt), `auto` (everything except layers 1–3).

## Sandbox (`src/sandbox.ts`)

Linux: `bubblewrap` with read-only system mounts, a read-write project dir, private `/tmp`, and `$HOME` replaced by an empty directory. macOS: `sandbox-exec` with a profile that denies writes outside the project and denies reads of credential dirs. Both are best-effort confinement, not a VM. On Windows there is no backend yet — mox says so instead of pretending.

## MCP (`src/mcp.ts`)

Minimal JSON-RPC 2.0 client over newline-delimited stdio. On startup mox sends `initialize`, then `tools/list`, and wraps each remote tool as `mcp__<server>__<tool>`. MCP tool results are always treated as mutating (there's no read-only hint in the older protocol), so they prompt in `ask` mode.

This is the highest-leverage extension point: one protocol instead of N integrations.

## Model client (`src/model.ts`)

Speaks the OpenAI `/v1/chat/completions` shape, which Ollama, LM Studio, llama.cpp, vLLM, and most gateways implement. It:

- auto-detects the model name from `/v1/models` when none is configured
- retries 5xx and connection errors with backoff
- recovers tool calls that a model wrote inline as JSON in its prose
- falls back to a text protocol when the server rejects `tools`, and remembers that for the process

## What is deliberately absent

- **No streaming.** Local models on consumer hardware are slow enough that streaming adds complexity for little perceived gain, and traces are easier to reason about as complete turns. Worth adding for interactive chat.
- **No vector store.** `grep` beats embeddings for the code-sized corpora this is aimed at, and it is inspectable.
- **No plugin marketplace.** MCP is the standard; don't invent another.
- **No GUI automation.** Deliberate — see the roadmap.
