# Roadmap

The capability gap between "runs a shell command" and "does everything" is not one gap. It is a ladder, and each rung costs roughly an order of magnitude more effort than the one below.

| Tier | Surface | Reliability today | State in mox |
|---|---|---|---|
| 1 | Shell, files, code, HTTP, MCP | High | **Shipped** |
| 2 | Real browser (JS sites, logins, forms) | Medium — works, flaky on CAPTCHAs/2FA/SPAs | Tool exists via Playwright; needs hardening |
| 3 | Desktop GUI (screenshot + mouse + keyboard) | Low — 2–5 s/action, errors compound | Not started, deliberately |
| 4 | Physical world | N/A | Buy a robot |

## Tier 2 — make the browser trustworthy

Browser automation is the highest-value next step: most "I need a computer to do this" tasks are web tasks.

- [ ] **Accessibility-tree snapshots instead of raw HTML.** Feed the model a compact list of interactive elements with stable refs (`[button "Sign in"]`) rather than 200 KB of DOM. Cuts tokens by an order of magnitude and improves click accuracy dramatically.
- [ ] **Persistent profile** so logins survive across runs, with an explicit `--profile` dir and a warning that it holds cookies.
- [ ] **Human-in-the-loop for the hostile parts**: pause and hand the window over for CAPTCHA/2FA instead of failing.
- [ ] **Downloads/uploads** and file chooser handling.
- [ ] **Network log capture** so the model can see the XHR that actually carries the data, instead of scraping rendered text.
- [ ] **Domain allowlist** in policy, e.g. `{ "tool": "browser", "match": "bank", "decision": "deny" }`.

## Tier 3 — desktop GUI, and why it is last

Screenshot → model → click is a control loop with a 2–5 second period and no transactional semantics. A single mis-click in the wrong window is unrecoverable. Expect roughly 60–80% success on a three-step GUI task with a frontier model, much worse locally, and latency measured in minutes.

If you genuinely need it — legacy enterprise software, an app with no CLI or API — the sane shape is:

- [ ] **Accessibility APIs first** (Windows UI Automation, macOS AX, AT-SPI on Linux). Structured elements and actions, not pixels. This is the difference between "click the element named Save" and "click at (812, 403)".
- [ ] **Screenshot fallback** with Set-of-Marks prompting: overlay numbered boxes, ask for a number, click its centre.
- [ ] **A virtual display** (Xvfb / a second user session) so the agent isn't fighting you for the mouse and can't touch your other windows.
- [ ] **Window-scoped actions only.** Never global hotkeys, never anything that reaches outside the target window.
- [ ] **Mandatory confirmation at the end of every GUI run** — a human looks at the screenshot before anything is submitted.

That is a separate project, honestly. It is not a weekend addition to this loop.

## Tier 1 hardening (do this first)

- [ ] **Streaming** responses, so interactive `mox chat` feels alive on slow local models.
- [ ] **Context compaction** — summarise old tool results instead of dropping them, so long runs don't fall off a 16k cliff.
- [ ] **Parallel read-only tool calls** (grep + read + list at once). Safe, and cuts wall-clock time noticeably.
- [ ] **Sub-agents** — a cheap local model for exploration (grep, read, summarise) handing a compact brief to a stronger model for the actual edit. This is the single biggest quality win available for local setups.
- [ ] **Hybrid routing** — local model by default, escalate to a cloud model when stuck or when the task is classified as hard. `Model` is a one-method interface; this is mostly policy.
- [ ] **`mox resume <run>`** — continue from a trace after a crash or an interrupt.
- [ ] **Diff preview before writes.** Show a unified diff in the approval prompt for `edit_file` / `write_file`, not just the path.
- [ ] **Better sandbox story on Windows** (AppContainer or a WSL2 backend) and a real container mode (`mox --container`).
- [ ] **MCP read-only hints** so trusted query tools can skip approvals.
- [ ] **Structured evals** — a suite of 20 real tasks run against several local models, scored pass/fail. Without this, every prompt change is vibes.

## Non-goals

- A plugin marketplace. MCP is the standard; use it.
- A general vector database. `grep` is inspectable and good enough at repo scale.
- Beating Claude Code or Codex on autonomous coding. The point of mox is that it runs on your machine, with your rules, and you can read all of it.
