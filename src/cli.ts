import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { AgentEvent, ChatMessage, Config, Model, ToolProtocol } from "./types.ts";
import { ConfigError, DEFAULT_CONFIG, loadConfig, redactConfig, type CliOverrides } from "./config.ts";
import { OpenAIModel, ModelError, ScriptedModel, scriptedCall, scriptedText } from "./model.ts";
import { Agent, type ApprovalRequest } from "./agent.ts";
import { builtinTools, ToolError } from "./tools/index.ts";
import { detectSandbox } from "./sandbox.ts";
import { Tracer, listRuns, readRun } from "./trace.ts";
import { loadMcpTools, type McpClient } from "./mcp.ts";
import { closeBrowser } from "./tools/browser.ts";
import { formatBytes, formatMs, oneLine } from "./util.ts";
import {
  appendHistory,
  clearHistory,
  corpusFor,
  initSelf,
  loadHistory,
  loadSelf,
  memoryPath,
  personaBlock,
  summarizeSelf,
  tinyPath,
  SELF_FILES,
  type Self,
} from "./self.ts";
import { startAppServer, resolveAppTarget } from "./app/server.ts";
import { TinyLM, type ModelJson } from "./tiny/lm.ts";
import { lossVerdict, trainTiny } from "./tiny/train.ts";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- presentation

const useColor = process.stdout.isTTY && !process.env["NO_COLOR"];
const paint = (code: string) => (text: string) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const dim = paint("2");
const bold = paint("1");
const red = paint("31");
const green = paint("32");
const yellow = paint("33");
const blue = paint("36");
const magenta = paint("35");

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const HELP = `${bold("mox")} — a local AI agent that runs on your machine

${bold("USAGE")}
  mox <task...>                 run one task and exit
  mox chat                      interactive session (keeps context)
  mox doctor                    check model server, sandbox, config
  mox init                      write a starter mox.config.json
  mox app [dir]                 open the chat window (local, no Electron)
  mox app --install-shortcut    add mox to your application menu
  mox self <cmd> [dir]          build and talk to an assistant defined by a folder
                                (init, chat, ask, train, talk, info)
  mox tools                     list available tools
  mox runs                      list past runs
  mox show <run|latest>         replay a run's trace
  mox config                    print the resolved configuration

${bold("FLAGS")}
  --model <name>                model id (default: first one the server reports)
  --base-url <url>              OpenAI-compatible endpoint (default http://127.0.0.1:11434/v1)
  --max-steps <n>               hard cap on agent steps (default 40)
  --yes, --auto                 approve every non-destructive call (no prompts)
  --readonly                    deny everything that writes or executes
  --no-sandbox                  disable OS sandboxing (not recommended)
  --no-mcp                      do not start configured MCP servers
  --trace-dir <dir>             where run logs go (default .mox/runs)
  --name <name>                 name for 'mox self init'
  --steps <n>                   training steps for 'mox self train'
  --size <nano|small|medium>    model size for 'mox self train'
  --temp <n>                    sampling temperature for 'mox self talk'
  --tokens <n>                  bytes to generate per reply
  --prompt <text>               one-shot prompt for 'mox self talk'
  --force                       write into a non-empty directory
  --verbose                     stream full tool output
  --json                        machine-readable events on stdout
  -h, --help                    this text
  -v, --version                 version

${bold("EXAMPLES")}
  mox "find the flaky test and fix it"
  mox chat --model qwen3:8b
  mox "summarise README.md into 3 bullets" --yes

  ${dim("# an assistant you own: a folder you can edit")}
  mox self init ./ada --name Ada
  mox self chat ./ada
  mox self ask ./ada "what do you know about batteries?"
  mox self train ./ada && mox self talk ./ada

  mox doctor

${dim("Config: mox.config.json in the project root (optional). Runs log to .mox/runs.")}
`;

// ---------------------------------------------------------------- arg parsing

type Flags = {
  help: boolean;
  version: boolean;
  verbose: boolean;
  json: boolean;
  noMcp: boolean;
  prompt: string[];
  overrides: CliOverrides;
  command:
    | "run"
    | "chat"
    | "doctor"
    | "init"
    | "tools"
    | "runs"
    | "show"
    | "config"
    | "self"
    | "app";
  showTarget?: string;
  selfSub?: string;
  selfDir?: string;
  nameOpt?: string;
  force?: boolean;
  steps?: number;
  sizeOpt?: string;
  temp?: number;
  tokens?: number;
  samplePrompt?: string;
  port?: number;
  installShortcut?: boolean;
  open?: boolean;
  host?: string;
  demo?: boolean;
};

const VALUE_FLAGS: Record<string, keyof CliOverrides> = {
  "--model": "model",
  "--base-url": "baseUrl",
  "--trace-dir": "traceDir",
};

function parseArgs(argv: string[]): Flags {
  const noArgs = argv.length === 0;
  const flags: Flags = {
    help: noArgs,
    version: false,
    verbose: false,
    json: false,
    noMcp: false,
    prompt: [],
    overrides: {},
    command: "run",
  };

  const commands = new Set(["chat", "doctor", "init", "tools", "runs", "show", "config", "self", "app"]);
  let index = 0;
  if (argv[0] && commands.has(argv[0])) {
    flags.command = argv[0] as Flags["command"];
    index = 1;
    if (flags.command === "show" && argv[1] && !argv[1].startsWith("-")) {
      flags.showTarget = argv[1];
      index = 2;
    }
    if (flags.command === "self") {
      const sub = argv[1];
      if (!sub || sub.startsWith("-")) {
        throw new UsageError(
          "mox self needs a subcommand: init, chat, talk, train, info",
        );
      }
      flags.selfSub = sub;
      index = 2;
      if (argv[2] && !argv[2].startsWith("-")) {
        flags.selfDir = argv[2];
        index = 3;
      }
    }
  }

  for (; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "-h" || arg === "--help") flags.help = true;
    else if (arg === "-v" || arg === "--version") flags.version = true;
    else if (arg === "--verbose") flags.verbose = true;
    else if (arg === "--json") flags.json = true;
    else if (arg === "--no-mcp") flags.noMcp = true;
    else if (arg === "--yes" || arg === "--auto" || arg === "-y") flags.overrides.approval = "auto";
    else if (arg === "--readonly") flags.overrides.approval = "readonly";
    else if (arg === "--no-sandbox") flags.overrides.noSandbox = true;
    else if (VALUE_FLAGS[arg]) {
      const value = argv[++index];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      (flags.overrides as Record<string, unknown>)[VALUE_FLAGS[arg]!] = value;
    } else if (arg === "--max-steps") {
      const value = Number(argv[++index]);
      if (!Number.isFinite(value) || value < 1) throw new UsageError("--max-steps needs a positive integer");
      flags.overrides.maxSteps = value;
    } else if (arg === "--name") {
      flags.nameOpt = argv[++index];
      if (!flags.nameOpt) throw new UsageError("--name needs a value");
    } else if (arg === "--force") flags.force = true;
    else if (arg === "--steps") {
      const value = Number(argv[++index]);
      if (!Number.isFinite(value) || value < 1) throw new UsageError("--steps needs a positive integer");
      flags.steps = Math.floor(value);
    } else if (arg === "--size") {
      const value = argv[++index];
      if (!value || !["nano", "small", "medium"].includes(value)) {
        throw new UsageError("--size must be nano, small or medium");
      }
      flags.sizeOpt = value;
    } else if (arg === "--temp" || arg === "--temperature") {
      const value = Number(argv[++index]);
      if (!Number.isFinite(value) || value < 0) throw new UsageError("--temp needs a number >= 0");
      flags.temp = value;
    } else if (arg === "--tokens") {
      const value = Number(argv[++index]);
      if (!Number.isFinite(value) || value < 1) throw new UsageError("--tokens needs a positive integer");
      flags.tokens = Math.floor(value);
    } else if (arg === "--prompt") {
      flags.samplePrompt = argv[++index];
      if (!flags.samplePrompt) throw new UsageError("--prompt needs a value");
    } else if (arg === "--port") {
      const value = Number(argv[++index]);
      if (!Number.isFinite(value) || value < 0 || value > 65535) throw new UsageError("--port needs a number 1-65535");
      flags.port = Math.floor(value);
    } else if (arg === "--install-shortcut") flags.installShortcut = true;
    else if (arg === "--demo") flags.demo = true;
    else if (arg === "--host") {
      flags.host = argv[++index];
      if (!flags.host) throw new UsageError("--host needs an address");
    }
    else if (arg === "--open") flags.open = true;
    else if (arg === "--protocol") {
      const value = argv[++index] as ToolProtocol | undefined;
      if (!value || !["auto", "native", "text"].includes(value)) {
        throw new UsageError("--protocol must be auto, native or text");
      }
      flags.overrides.protocol = value;
    } else if (arg.startsWith("-") && arg !== "-") {
      throw new UsageError(`unknown flag ${arg}`);
    } else {
      flags.prompt.push(arg);
    }
  }
  return flags;
}

class UsageError extends Error {}

// ---------------------------------------------------------------- approvals

type Approver = (req: ApprovalRequest) => Promise<boolean>;

function makeApprover(opts: {
  interactive: boolean;
  auto: boolean;
  json: boolean;
  ask?: (question: string) => Promise<string>;
}): Approver {
  const sessionAllowed = new Set<string>();
  const asked = new Map<string, boolean>();
  let rl: readline.Interface | null = null;

  const ask = async (question: string): Promise<string> => {
    if (opts.ask) return await opts.ask(question);
    rl ??= readline.createInterface({ input: process.stdin, output: process.stderr });
    return await new Promise<string>((resolve) => rl!.question(question, resolve));
  };

  return async (req) => {
    if (opts.auto) return true;
    if (!opts.interactive) {
      if (!opts.json) {
        process.stderr.write(
          yellow(`\n! ${req.tool} needs approval (${req.reason}) but stdin is not a terminal — denied.\n`) +
            dim("  Re-run with --yes to approve non-destructive calls automatically.\n"),
        );
      }
      return false;
    }
    if (sessionAllowed.has(req.tool)) return true;
    if (asked.get(req.tool)) return false;

    const preview =
      req.tool === "shell" ? String(req.args["command"] ?? "") : req.summary || JSON.stringify(req.args);
    process.stderr.write(
      `\n${yellow("approve?")} ${bold(req.tool)} ${dim(`— ${req.reason}`)}\n` +
        `  ${oneLine(preview, 300)}\n` +
        `  ${dim("[y] once   [a] always this tool   [n] no   [q] quit")}\n`,
    );
    const answer = (await ask("  > ")).trim().toLowerCase();
    if (answer === "q" || answer === "quit") {
      process.kill(process.pid, "SIGINT");
      return false;
    }
    if (answer === "a" || answer === "always") {
      sessionAllowed.add(req.tool);
      return true;
    }
    if (answer === "y" || answer === "yes" || answer === "") return true;
    asked.set(req.tool, true);
    return false;
  };
}

// ---------------------------------------------------------------- event renderer

function renderer(opts: { verbose: boolean; json: boolean }) {
  if (opts.json) {
    return {
      handle: (event: AgentEvent) => {
        if (event.type === "step") return;
        process.stdout.write(JSON.stringify(event) + "\n");
      },
      close: () => undefined,
    };
  }
  let lastTool = "";
  return {
    handle: (event: AgentEvent) => {
      switch (event.type) {
        case "step":
          if (opts.verbose) process.stderr.write(dim(`\n· step ${event.step}\n`));
          break;
        case "assistant":
          // The final answer is printed by the command itself; echoing it here
          // would print it twice in a terminal. Intermediate narration (text
          // emitted alongside tool calls) is shown only in verbose mode.
          if (opts.verbose) process.stderr.write(dim(`\n${event.text}\n`));
          break;
        case "tool_start": {
          lastTool = event.name;
          const preview =
            event.name === "shell"
              ? String(event.args["command"] ?? "")
              : Object.entries(event.args)
                  .map(([key, value]) => `${key}=${oneLine(String(value), 60)}`)
                  .join(" ");
          process.stderr.write(`${blue("→")} ${bold(event.name)} ${dim(oneLine(preview, 160))}\n`);
          break;
        }
        case "tool_end": {
          const icon = event.isError ? red("✗") : green("✓");
          const head = event.content.split("\n")[0] ?? "";
          process.stderr.write(
            `  ${icon} ${dim(formatMs(event.ms))} ${dim(oneLine(head, 140))}\n`,
          );
          if (opts.verbose) process.stderr.write(dim(event.content) + "\n");
          void lastTool;
          break;
        }
        case "approval":
          if (event.decision === "deny") {
            process.stderr.write(`${red("✗ blocked")} ${dim(event.reason)}\n`);
          }
          break;
        case "notice":
          process.stderr.write(`${yellow("!")} ${dim(event.message)}\n`);
          break;
        case "usage":
          break;
        case "done":
          break;
      }
    },
    close: () => undefined,
  };
}

// ---------------------------------------------------------------- setup helpers

async function buildAgent(
  flags: Flags,
  config: Config,
  cwd: string,
  opts: {
    ask?: (question: string) => Promise<string>;
    persona?: string;
    memoryPath?: string;
    approve?: Approver;
    onEvent?: (event: AgentEvent) => void;
    modelOverride?: Model;
  } = {},
): Promise<{ agent: Agent; model: Model; tracer: Tracer; mcpClients: McpClient[] }> {
  if (opts.memoryPath) {
    config.memory = { enabled: true, path: opts.memoryPath };
  }
  const model = opts.modelOverride ?? new OpenAIModel(config);
  const tracer = new Tracer(config.trace.dir, config.trace.enabled, cwd);

  let tools = builtinTools(config);
  const mcpClients: McpClient[] = [];
  if (!flags.noMcp && Object.keys(config.mcpServers).length > 0) {
    const loaded = await loadMcpTools(config.mcpServers, (message) =>
      process.stderr.write(yellow(`! ${message}\n`)),
    );
    tools = [...tools, ...loaded.tools];
    mcpClients.push(...loaded.clients);
  }

  const interactive = Boolean(process.stdin.isTTY);
  const approve =
    opts.approve ??
    makeApprover({
      interactive,
      auto: config.policy.mode === "auto",
      json: flags.json,
      ask: opts.ask,
    });

  const render = renderer({ verbose: flags.verbose, json: flags.json });
  const sink = opts.onEvent ? (event: AgentEvent) => { render.handle(event); opts.onEvent!(event); } : render.handle;

  const agent = new Agent({
    config,
    model,
    tools,
    cwd,
    sandbox: detectSandbox(),
    tracer,
    approve,
    onEvent: sink,
    persona: opts.persona,
  });

  return { agent, model, tracer, mcpClients };
}

function configWarnings(config: Config, cwd: string): string[] {
  const warnings: string[] = [];
  const sandbox = detectSandbox();
  if (config.sandbox.mode !== "off" && !sandbox.available) {
    warnings.push(`no sandbox available (${sandbox.detail}) — commands run with your full permissions`);
  }
  if (config.policy.mode === "auto" && config.sandbox.mode === "off") {
    warnings.push("auto-approve with the sandbox off: any prompt injection can run anything");
  }
  if (config.model.apiKey && config.model.apiKey !== "local" && /^http:\/\/(?!127\.0\.0\.1|localhost)/.test(config.model.baseUrl)) {
    warnings.push("sending an API key over plain http to a remote host");
  }
  if (!fs.existsSync(path.join(cwd, "mox.config.json"))) {
    warnings.push("no mox.config.json here — using defaults (run `mox init` to customize)");
  }
  return warnings;
}

// ---------------------------------------------------------------- commands

async function cmdRun(flags: Flags, task: string): Promise<number> {
  const { config, cwd } = loadConfig(process.cwd(), flags.overrides);
  for (const warning of configWarnings(config, cwd)) {
    process.stderr.write(yellow(`! ${warning}\n`));
  }
  const { agent, tracer, mcpClients } = await buildAgent(flags, config, cwd);

  const controller = new AbortController();
  const onSigint = () => {
    if (controller.signal.aborted) process.exit(130);
    process.stderr.write(yellow("\n! interrupt received — stopping after this step (Ctrl-C again to force)\n"));
    controller.abort();
  };
  process.on("SIGINT", onSigint);

  try {
    const result = await agent.run(task, { history: undefined });
    if (!flags.json) {
      process.stdout.write(`\n${bold("mox")} ${dim(`(${result.steps} steps, ${formatMs(result.ms)}${result.usage.total_tokens ? `, ${result.usage.total_tokens} tokens` : ""})`)}\n`);
      process.stdout.write(result.text + "\n");
    }
    return result.text.startsWith("(stopped:") ? 1 : 0;
  } finally {
    tracer.close();
    for (const client of mcpClients) client.close();
    await closeBrowser();
    process.off("SIGINT", onSigint);
  }
}

async function cmdChat(flags: Flags): Promise<number> {
  const interactive = Boolean(process.stdin.isTTY);
  if (!interactive) {
    process.stderr.write(red("mox chat needs a terminal for stdin.\n"));
    return 2;
  }
  const { config, cwd } = loadConfig(process.cwd(), flags.overrides);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: blue("mox> ") });
  const ask = (question: string) => new Promise<string>((resolve) => rl.question(question, resolve));
  const { agent, tracer, mcpClients, model } = await buildAgent(flags, config, cwd, { ask });

  console.log(`${bold("mox chat")} ${dim(`— model ${config.model.name || "auto"} at ${config.model.baseUrl}`)}`);
  console.log(dim("Type a task. /new clears context, /exit quits.\n"));

  let history: ChatMessage[] = [];
  let exitCode = 0;

  rl.prompt();
  for await (const line of rl) {
    const input = String(line).trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input === "/exit" || input === "/quit") break;
    if (input === "/new") {
      history = [];
      console.log(dim("context cleared"));
      rl.prompt();
      continue;
    }
    if (input === "/help") {
      console.log(dim("/new  clear context\n/exit quit"));
      rl.prompt();
      continue;
    }

    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.on("SIGINT", onSigint);
    try {
      const result = await agent.run(input, { history });
      history = result.messages;
      console.log(`\n${result.text}\n`);
    } catch (err) {
      if (err instanceof ModelError) {
        console.error(red(`model error: ${err.message}`));
        exitCode = 1;
      } else {
        console.error(red(`error: ${(err as Error).message}`));
      }
    } finally {
      process.off("SIGINT", onSigint);
    }
    rl.prompt();
  }

  rl.close();
  tracer.close();
  for (const client of mcpClients) client.close();
  await closeBrowser();
  void model;
  return exitCode;
}

async function cmdDoctor(flags: Flags): Promise<number> {
  const { config, cwd, source } = loadConfig(process.cwd(), flags.overrides);
  const ok = (label: string, detail: string) => console.log(`${green("✓")} ${label}: ${dim(detail)}`);
  const warn = (label: string, detail: string) => console.log(`${yellow("!")} ${label}: ${detail}`);
  const bad = (label: string, detail: string) => console.log(`${red("✗")} ${label}: ${detail}`);

  console.log(bold("\nmox doctor\n"));
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 22) ok("node", `v${process.versions.node}`);
  else bad("node", `v${process.versions.node} — mox needs Node 22.18+ to run TypeScript directly`);

  ok("platform", `${process.platform} ${process.arch}`);
  ok("working directory", cwd);
  if (source) ok("config", source);
  else warn("config", "no mox.config.json found; using defaults");

  const sandbox = detectSandbox();
  if (config.sandbox.mode === "off") warn("sandbox", "disabled in config");
  else if (sandbox.available) ok("sandbox", `${sandbox.kind} at ${sandbox.detail}`);
  else warn("sandbox", `${sandbox.detail} — commands will run with your full permissions`);

  ok("approvals", config.policy.mode === "ask" ? "ask before mutating calls" : config.policy.mode);

  const model = new OpenAIModel(config);
  try {
    const models = await model.listModels();
    if (models.length === 0) {
      bad("model server", `${config.model.baseUrl} is reachable but has no models loaded`);
      console.log(dim("   Try: ollama pull qwen3:8b"));
    } else {
      ok("model server", `${config.model.baseUrl} (${models.length} model${models.length === 1 ? "" : "s"})`);
      const chosen = config.model.name || models[0]!.id;
      if (config.model.name && !models.some((m) => m.id === config.model.name)) {
        warn("model", `${chosen} is not in the server's list — it will be sent anyway`);
      } else {
        ok("model", chosen + (config.model.name ? "" : " (auto-selected)"));
      }
      for (const m of models.slice(0, 8)) console.log(dim(`   · ${m.id}`));
    }
  } catch (err) {
    bad("model server", (err as Error).message);
    console.log(dim("   Start one of:"));
    console.log(dim("     ollama serve                         (http://127.0.0.1:11434/v1)"));
    console.log(dim("     lm-studio                            (http://127.0.0.1:1234/v1)"));
    console.log(dim("     llama-server -m model.gguf --port 8080 (http://127.0.0.1:8080/v1)"));
  }

  try {
    require.resolve("playwright");
    ok("browser", "playwright installed");
  } catch {
    warn("browser", "playwright not installed — `npm i playwright && npx playwright install chromium`");
  }

  const tools = builtinTools(config);
  ok("tools", `${tools.length} built in: ${tools.map((t) => t.name).slice(0, 8).join(", ")}…`);
  const servers = Object.keys(config.mcpServers);
  if (servers.length > 0) ok("mcp", `${servers.length} server(s): ${servers.join(", ")}`);
  else console.log(dim("· mcp: none configured (add mcpServers to mox.config.json)"));

  ok("trace", config.trace.enabled ? path.resolve(cwd, config.trace.dir) : "disabled");
  const runs = listRuns(path.resolve(cwd, config.trace.dir));
  if (runs.length > 0) console.log(dim(`   ${runs.length} past run(s); view with mox runs`));

  console.log("");
  return 0;
}

function cmdInit(): number {
  const target = path.join(process.cwd(), "mox.config.json");
  if (fs.existsSync(target)) {
    console.log(yellow(`mox.config.json already exists at ${target}`));
    return 1;
  }
  const starter: Config = {
    ...DEFAULT_CONFIG,
    agent: {
      ...DEFAULT_CONFIG.agent,
      systemPromptExtra: "",
    },
  };
  fs.writeFileSync(target, JSON.stringify(starter, null, 2) + "\n", "utf8");
  console.log(green(`wrote ${target}`));
  console.log(dim("Edit policy.rules to pre-approve the commands you run often."));
  return 0;
}

function cmdTools(flags: Flags): number {
  const { config, cwd } = loadConfig(process.cwd(), flags.overrides);
  const tools = builtinTools(config);
  console.log(`\n${bold("built-in tools")}\n`);
  for (const tool of tools) {
    const badge = tool.readOnly ? dim("read-only") : yellow("mutating");
    console.log(`  ${bold(tool.name.padEnd(14))} ${badge}`);
    console.log(`  ${dim(tool.description.split(". ")[0] + ".")}`);
  }
  const servers = Object.keys(config.mcpServers);
  if (servers.length > 0) {
    console.log(`\n${bold("mcp servers")} ${dim("(tools appear as mcp__<server>__<tool>)")}\n`);
    for (const [name, server] of Object.entries(config.mcpServers)) {
      console.log(`  ${bold(name)} ${dim(`${server.command} ${(server.args ?? []).join(" ")}`)}`);
    }
  }
  void cwd;
  console.log("");
  return 0;
}

function cmdRuns(flags: Flags): number {
  const { config, cwd } = loadConfig(process.cwd(), flags.overrides);
  const dir = path.resolve(cwd, config.trace.dir);
  const runs = listRuns(dir);
  if (runs.length === 0) {
    console.log(dim(`no runs yet in ${dir}`));
    return 0;
  }
  console.log(`\n${bold("recent runs")} ${dim(dir)}\n`);
  for (const run of runs.slice(0, 20)) {
    const stamp = run.startedAt.replace("T", " ").slice(0, 19);
    const status = run.errors > 0 ? red(`${run.errors} err`) : green("ok");
    console.log(
      `  ${dim(stamp)}  ${String(run.steps).padStart(2)} steps  ${String(run.toolCalls).padStart(2)} calls  ${status}  ${dim(oneLine(run.finalText || run.cwd, 80))}`,
    );
    console.log(dim(`    ${path.basename(run.file, ".jsonl")}`));
  }
  console.log(dim("\nview one with: mox show <id>  (or: mox show latest)\n"));
  return 0;
}

function cmdShow(flags: Flags): number {
  const { config, cwd } = loadConfig(process.cwd(), flags.overrides);
  const dir = path.resolve(cwd, config.trace.dir);
  const runs = listRuns(dir);
  if (runs.length === 0) {
    console.log(dim("no runs recorded"));
    return 1;
  }
  const target =
    !flags.showTarget || flags.showTarget === "latest"
      ? runs[0]!
      : runs.find((run) => run.file.includes(flags.showTarget!)) ?? null;
  if (!target) {
    console.log(red(`no run matching "${flags.showTarget}"`));
    return 1;
  }
  console.log(`\n${bold(target.startedAt)} ${dim(target.cwd)}\n`);
  for (const record of readRun(target.file)) {
    const time = String(record.ts).slice(11, 19);
    if (record.type === "task") console.log(`${dim(time)} ${bold("task")} ${String(record["task"])}`);
    else if (record.type === "step") console.log(`${dim(time)} ${dim(`step ${record["step"]}`)}`);
    else if (record.type === "assistant") console.log(`${dim(time)} ${magenta("say")} ${String(record["text"])}`);
    else if (record.type === "tool_start") {
      console.log(`${dim(time)} ${blue("call")} ${bold(String(record["name"]))} ${dim(JSON.stringify(record["args"]))}`);
    } else if (record.type === "tool_end") {
      const mark = record["isError"] ? red("err") : green("ok ");
      console.log(`${dim(time)} ${mark} ${dim(formatMs(Number(record["ms"] ?? 0)))} ${oneLine(String(record["content"]), 200)}`);
    } else if (record.type === "notice") console.log(`${dim(time)} ${yellow("note")} ${String(record["message"])}`);
    else if (record.type === "approval") console.log(`${dim(time)} ${yellow(String(record["decision"]))} ${String(record["reason"])}`);
    else if (record.type === "final") {
      console.log(`\n${bold("result")}\n${String(record["text"])}\n`);
      console.log(dim(`${record["steps"]} steps, ${formatMs(Number(record["ms"] ?? 0))}, ${JSON.stringify(record["usage"] ?? {})}`));
    }
  }
  console.log("");
  return 0;
}

function cmdConfig(flags: Flags): number {
  const { config, source } = loadConfig(process.cwd(), flags.overrides);
  console.log(dim(source ? `# from ${source}` : "# defaults"));
  console.log(JSON.stringify(redactConfig(config), null, 2));
  return 0;
}


// ---------------------------------------------------------------- self (a folder is the AI)

const SELF_HELP = `${bold("mox self")} — an assistant that is just a folder you can edit

  mox self init <dir> [--name X]     create it
  mox self chat <dir>                talk to it (your local model, with tools)
  mox self ask <dir> "<task>"        one-shot task with that identity
  mox self train <dir>               train a tiny model from the folder, from scratch
  mox self talk <dir>                talk to that tiny model
  mox self info <dir>                what is in the folder

${dim("Everything it is lives in <dir>: SELF.md, knowledge/, skills/, memory/, config.json.")}`;

function resolveSelfDir(flags: Flags): string {
  const explicit = flags.selfDir;
  if (explicit) return path.resolve(process.cwd(), explicit);
  const here = path.join(process.cwd(), SELF_FILES.identity);
  if (fs.existsSync(here)) return process.cwd();
  return path.resolve(process.cwd(), "brain");
}

function describeSelfDir(self: Self): void {
  const rel = (p: string) => path.relative(self.dir, p) || ".";
  const size = (p: string) => {
    try {
      return formatBytes(fs.statSync(p).size);
    } catch {
      return "-";
    }
  };
  console.log(`${bold(self.config.name)} ${dim(self.dir)}`);
  console.log(`  ${bold(SELF_FILES.identity.padEnd(18))} ${size(path.join(self.dir, SELF_FILES.identity))}  ${dim("identity")}`);
  for (const entry of self.knowledge) {
    const p = path.join(self.dir, SELF_FILES.knowledgeDir, entry.file);
    console.log(`  ${("knowledge/" + entry.file).padEnd(18)} ${size(p)}  ${dim("knowledge")}`);
  }
  for (const entry of self.skills) {
    const p = path.join(self.dir, SELF_FILES.skillsDir, entry.file);
    console.log(`  ${("skills/" + entry.file).padEnd(18)} ${size(p)}  ${dim("procedure")}`);
  }
  console.log(`  ${SELF_FILES.notes.padEnd(18)} ${size(path.join(self.dir, SELF_FILES.notes))}  ${dim("memory")}`);
  if (self.hasTiny) {
    console.log(`  ${SELF_FILES.tiny.padEnd(18)} ${size(tinyPath(self))}  ${dim("from-scratch model")}`);
  } else {
    console.log(`  ${SELF_FILES.tiny.padEnd(18)} ${dim("not trained yet (mox self train .)")}`);
  }
  void rel;
}

function cmdSelfInit(flags: Flags): number {
  const dir = resolveSelfDir(flags);
  try {
    const result = initSelf(dir, { name: flags.nameOpt, force: flags.force });
    console.log(`\n${green("created")} ${bold(result.dir)}`);
    for (const file of result.created) console.log(`  ${dim("+")} ${file}`);
    console.log(`\n${bold("next")}`);
    console.log(`  edit ${path.join(result.dir, SELF_FILES.identity)}`);
    console.log(`  ${dim("then:")} mox self chat ${path.relative(process.cwd(), result.dir) || "."}`);
    console.log(`  ${dim("offline, from scratch:")} mox self train ${path.relative(process.cwd(), result.dir) || "."}`);
    console.log("");
    return 0;
  } catch (err) {
    console.error(red((err as Error).message));
    return 1;
  }
}

function cmdSelfInfo(flags: Flags): number {
  let self: Self;
  try {
    self = loadSelf(resolveSelfDir(flags));
  } catch (err) {
    console.error(red((err as Error).message));
    return 1;
  }
  const summary = summarizeSelf(self);
  console.log("");
  describeSelfDir(self);
  console.log("");
  console.log(
    `  identity ${summary.identityChars} chars · knowledge ${summary.knowledgeFiles} file(s), ${summary.knowledgeChars} chars · memory ${summary.memoryChars} chars · history ${summary.historyEntries} line(s)`,
  );
  if (summary.tiny) {
    console.log(
      `  tiny model: ${summary.tiny.steps} steps, loss ${Number(summary.tiny.loss).toFixed(3)} (${lossVerdict(Number(summary.tiny.loss))})`,
    );
  }
  const corpusChars = corpusFor(self).length;
  console.log(`  training corpus: ${formatBytes(corpusChars)} of text`);
  console.log(
    `\n  ${dim("talk with the real model:")} mox self chat ${path.relative(process.cwd(), self.dir) || "."}`,
  );
  console.log(
    `  ${dim("talk with the tiny model:")} mox self talk ${path.relative(process.cwd(), self.dir) || "."}\n`,
  );
  return 0;
}

type SelfAgent = {
  agent: Agent;
  tracer: Tracer;
  mcpClients: McpClient[];
  config: Config;
};

async function prepareSelfAgent(
  flags: Flags,
  self: Self,
  ask?: (question: string) => Promise<string>,
): Promise<SelfAgent> {
  const { config, cwd } = loadConfig(process.cwd(), flags.overrides);
  // The folder's config wins over project defaults, but CLI flags win over both.
  if (!flags.overrides.baseUrl && self.config.baseUrl) config.model.baseUrl = self.config.baseUrl;
  if (!flags.overrides.model && self.config.model) config.model.name = self.config.model;
  if (self.config.temperature !== undefined && flags.temp === undefined) {
    config.model.temperature = self.config.temperature;
  }
  if (self.config.maxTokens) config.model.maxTokens = self.config.maxTokens;

  const built = await buildAgent(flags, config, cwd, {
    ask,
    persona: personaBlock(self),
    memoryPath: memoryPath(self),
  });
  return { ...built, config };
}

async function cmdSelfAsk(flags: Flags): Promise<number> {
  let self: Self;
  try {
    self = loadSelf(resolveSelfDir(flags));
  } catch (err) {
    console.error(red((err as Error).message));
    return 1;
  }
  const task = flags.prompt.join(" ").trim();
  if (!task) {
    console.error(red("what should it do?"));
    console.error(dim(`example: mox self ask ${path.relative(process.cwd(), self.dir) || "."} "what do you know about batteries?"`));
    return 2;
  }
  const { agent, tracer, mcpClients } = await prepareSelfAgent(flags, self);
  try {
    appendHistory(self, "user", task);
    const result = await agent.run(task);
    appendHistory(self, "assistant", result.text);
    process.stdout.write(result.text + "\n");
    return 0;
  } finally {
    tracer.close();
    for (const client of mcpClients) client.close();
    await closeBrowser();
  }
}

async function cmdSelfChat(flags: Flags): Promise<number> {
  let self: Self;
  try {
    self = loadSelf(resolveSelfDir(flags));
  } catch (err) {
    console.error(red((err as Error).message));
    return 1;
  }
  if (!process.stdin.isTTY) {
    console.error(red("mox self chat needs a terminal. Use --prompt with 'mox self ask' instead."));
    return 2;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: blue(`${self.config.name}> `) });
  const ask = (question: string) => new Promise<string>((resolve) => rl.question(question, resolve));

  const { agent, tracer, mcpClients, config } = await prepareSelfAgent(flags, self, ask);

  let history = loadHistory(self, 20);
  console.log(`${bold(self.config.name)} ${dim(`— ${self.dir}`)}`);
  console.log(
    dim(
      `identity ${self.identity.length} chars · ${self.knowledge.length} knowledge file(s) · tools on · model ${config.model.name || "auto"}`,
    ),
  );
  console.log(dim(`/new forgets the conversation · /info shows the folder · /exit quits\n`));

  rl.prompt();
  for await (const line of rl) {
    const input = String(line).trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input === "/exit" || input === "/quit") break;
    if (input === "/new") {
      clearHistory(self);
      history = [];
      console.log(dim("conversation forgotten (old log kept as .bak)"));
      rl.prompt();
      continue;
    }
    if (input === "/info") {
      describeSelfDir(self);
      rl.prompt();
      continue;
    }

    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.on("SIGINT", onSigint);
    try {
      appendHistory(self, "user", input);
      const result = await agent.run(input, { history });
      history = result.messages;
      appendHistory(self, "assistant", result.text);
      console.log(`\n${result.text}\n`);
    } catch (err) {
      console.error(red(`error: ${(err as Error).message}`));
    } finally {
      process.off("SIGINT", onSigint);
    }
    rl.prompt();
  }

  rl.close();
  tracer.close();
  for (const client of mcpClients) client.close();
  await closeBrowser();
  return 0;
}

function cmdSelfTrain(flags: Flags): number {
  let self: Self;
  try {
    self = loadSelf(resolveSelfDir(flags));
  } catch (err) {
    console.error(red((err as Error).message));
    return 1;
  }
  const corpus = corpusFor(self);
  if (corpus.trim().length < 400) {
    console.error(red("not enough text in the folder to learn from yet"));
    console.error(dim("write a few paragraphs in SELF.md or knowledge/, then train again"));
    return 1;
  }

  const steps = flags.steps ?? 500;
  console.log(
    `${bold("training")} ${dim(`${formatBytes(corpus.length)} of text, ${flags.sizeOpt ?? "small"} model, ${steps} steps, from scratch`)}`,
  );

  let lastPrint = 0;
  const started = Date.now();
  let result;
  try {
    result = trainTiny({
      text: corpus,
      size: (flags.sizeOpt as "nano" | "small" | "medium" | undefined) ?? "small",
      steps,
      seed: 1337,
      onStep: ({ step, loss, lr }) => {
        const pct = Math.floor((step / steps) * 100);
        if (pct >= lastPrint + 10 || step === steps) {
          lastPrint = Math.floor(pct / 10) * 10;
          process.stderr.write(
            `  ${dim(`${String(step).padStart(4)}/${steps}`)} ${dim(`${pct}%`.padStart(4))}  loss ${loss.toFixed(3)}  lr ${lr.toFixed(5)}  ${dim(formatMs(Date.now() - started))}\n`,
          );
        }
      },
    });
  } catch (err) {
    console.error(red((err as Error).message));
    return 1;
  }

  const target = tinyPath(self);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const json = result.model.toJSON({
    steps: result.steps,
    loss: result.finalLoss,
    bytes: result.bytes,
  });
  fs.writeFileSync(target, JSON.stringify(json), "utf8");

  console.log("");
  console.log(`${green("trained")} ${bold(`${(result.model.parameterCount / 1000).toFixed(1)}k parameters`)} in ${formatMs(result.ms)}`);
  console.log(`  loss ${result.initialLoss.toFixed(3)} → ${result.finalLoss.toFixed(3)}  ${dim(lossVerdict(result.finalLoss))}`);
  console.log(`  saved ${formatBytes(fs.statSync(target).size)} to ${target}`);
  console.log(`\n${bold("sample")} ${dim("(this is the whole mind, warts and all)")}`);
  console.log(dim(result.sample.replace(/\s+/g, " ").slice(0, 500)));
  console.log(`\n  ${dim("talk to it:")} mox self talk ${path.relative(process.cwd(), self.dir) || "."}\n`);
  return 0;
}

function cmdSelfTalk(flags: Flags): number {
  let self: Self;
  try {
    self = loadSelf(resolveSelfDir(flags));
  } catch (err) {
    console.error(red((err as Error).message));
    return 1;
  }
  const file = tinyPath(self);
  if (!fs.existsSync(file)) {
    console.error(red(`${self.config.name} has no tiny model yet`));
    console.error(dim(`train one with: mox self train ${path.relative(process.cwd(), self.dir) || "."}`));
    return 1;
  }

  let model: TinyLM;
  let json: ModelJson;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8")) as ModelJson;
    model = TinyLM.fromJSON(json);
  } catch (err) {
    console.error(red(`could not load ${file}: ${(err as Error).message}`));
    return 1;
  }

  const name = self.config.name;
  const stats = model.stats;
  console.log(`${bold(name)} ${dim("(tiny model, built from this folder)")}`);
  console.log(
    dim(
      `${(model.parameterCount / 1000).toFixed(1)}k parameters · ${stats.steps} steps · loss ${Number(stats.loss).toFixed(3)}`,
    ),
  );
  console.log(
    dim(
      "This is a real neural network trained from scratch, not a chatbot. It continues text in",
    ),
  );
  console.log(dim("the style of your folder; it does not reason, and it is not the assistant from"));
  console.log(dim("`mox self chat`. It is a window into what a model learns from your writing.\n"));

  const temperature = flags.temp ?? 0.8;
  const maxTokens = flags.tokens ?? 120;
  const seedPrefix = `${self.identity.slice(0, 280)}\n\n`;

  const reply = (input: string): string => {
    const seed = `${seedPrefix}User: ${input}\n${name}:`;
    const bytes = model.generate(new TextEncoder().encode(seed), {
      maxTokens,
      temperature,
      topK: 40,
      seed: Date.now() % 100000,
    });
    let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    text = text.replace(/\u0000/g, "");
    // The model does not know it is in a dialogue; stop it when it invents the
    // next turn, rather than letting it answer itself for 200 bytes.
    const stop = text.search(new RegExp(`\\n(User|You|${name})\\s*:`));
    if (stop > 10) text = text.slice(0, stop);
    return text.replace(/\s+/g, " ").trim() || "(silence)";
  };

  if (flags.samplePrompt) {
    console.log(`${blue("you>")} ${flags.samplePrompt}`);
    console.log(`${magenta(name + ">")} ${reply(flags.samplePrompt)}\n`);
    return 0;
  }
  if (!process.stdin.isTTY) {
    console.error(red("mox self talk needs a terminal, or use --prompt \"…\""));
    return 2;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: blue("you> ") });
  rl.prompt();
  rl.on("line", (line) => {
    const input = String(line).trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input === "/exit" || input === "/quit") {
      rl.close();
      return;
    }
    const started = Date.now();
    const answer = reply(input);
    console.log(`${magenta(name + ">")} ${answer}`);
    console.log(dim(`  ${formatMs(Date.now() - started)}\n`));
    rl.prompt();
  });
  rl.on("close", () => {
    console.log(dim("\nbye"));
  });
  return 0;
}

async function cmdSelf(flags: Flags): Promise<number> {
  const sub = flags.selfSub ?? "";
  switch (sub) {
    case "init":
      return cmdSelfInit(flags);
    case "info":
      return cmdSelfInfo(flags);
    case "train":
      return cmdSelfTrain(flags);
    case "talk":
      return cmdSelfTalk(flags);
    case "chat":
      return await cmdSelfChat(flags);
    case "ask":
      return await cmdSelfAsk(flags);
    case "help":
    case "--help":
      console.log(SELF_HELP);
      return 0;
    default:
      console.error(red(`unknown self subcommand "${sub}"`));
      console.log(SELF_HELP);
      return 2;
  }
}


// ---------------------------------------------------------------- app (a real window)

const APP_LOG = () => path.join(process.env.HOME ?? ".", ".local/share/mox/app.log");

function moxExecutable(): string {
  const explicit = process.env["MOX_EXEC"];
  if (explicit && explicit.trim()) return explicit.trim();
  const candidates = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of candidates) {
    const candidate = path.join(dir, "mox");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  const cli = path.join(HERE, "cli.ts");
  return `${process.execPath} --disable-warning=ExperimentalWarning ${cli}`;
}

/** Prefer a chromeless Chromium window, fall back to the default browser. */
function openWindow(url: string): void {
  if (process.env["MOX_NO_BROWSER"]) return;
  const browsers = [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "brave-browser",
    "microsoft-edge",
  ];
  const which = (bin: string): string | null => {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      if (!dir) continue;
      const candidate = path.join(dir, bin);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        /* keep looking */
      }
    }
    return null;
  };

  for (const browser of browsers) {
    const bin = which(browser);
    if (!bin) continue;
    try {
      const child = spawn(bin, [`--app=${url}`, "--window-size=1100,780", "--class=mox"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return;
    } catch {
      /* try the next one */
    }
  }
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    const child = spawn(opener, [url], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    /* the URL is printed anyway */
  }
}

function installShortcut(flags: Flags): number {
  const home = process.env.HOME ?? "";
  const appsDir = path.join(home, ".local/share/applications");
  const iconDir = path.join(home, ".local/share/icons/hicolor/scalable/apps");
  const iconSrc = path.join(HERE, "app", "icon.svg");
  const iconDest = path.join(iconDir, "mox.svg");
  const explicitDir = flags.selfDir ?? flags.prompt[0];
  const target = explicitDir ? path.resolve(process.cwd(), explicitDir) : null;

  try {
    fs.mkdirSync(appsDir, { recursive: true });
    fs.mkdirSync(iconDir, { recursive: true });
    if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, iconDest);
  } catch (err) {
    console.error(red(`could not write the menu entry: ${(err as Error).message}`));
    return 1;
  }

  const exec = moxExecutable();
  const args = ["app"];
  if (target) args.push(`"${target}"`);
  const entry = `[Desktop Entry]
Type=Application
Version=1.0
Name=mox
GenericName=AI Assistant
Comment=Talk to your local AI assistant
Exec=${exec} ${args.join(" ")}
Icon=${iconDest}
Terminal=false
Categories=Utility;Development;Office;
Keywords=ai;assistant;chat;llm;local;
StartupNotify=true
StartupWMClass=mox
`;
  const entryPath = path.join(appsDir, "mox.desktop");
  fs.writeFileSync(entryPath, entry, "utf8");
  try {
    fs.chmodSync(entryPath, 0o755);
  } catch {
    /* not fatal */
  }

  for (const cmd of ["update-desktop-database", "gtk-update-icon-cache"]) {
    try {
      const dir = cmd === "gtk-update-icon-cache" ? iconDir : appsDir;
      const child = spawn(cmd, [dir], { stdio: "ignore", detached: true });
      child.on("error", () => undefined);
      child.unref();
    } catch {
      /* optional tools, mint has them but do not depend on it */
    }
  }

  console.log(`${green("✓")} added ${bold("mox")} to your application menu`);
  console.log(dim(`  ${entryPath}`));
  console.log(dim("  look under Menu → Accessories/Office, or search for \"mox\""));
  return 0;
}

async function cmdApp(flags: Flags): Promise<number> {
  if (flags.installShortcut) return installShortcut(flags);

  const { config, cwd } = loadConfig(process.cwd(), flags.overrides);
  const selfDir = resolveAppTarget(cwd, flags.selfDir);
  let self = null;
  if (selfDir) {
    try {
      self = loadSelf(selfDir);
    } catch (err) {
      console.error(red(`could not read the self folder: ${(err as Error).message}`));
      return 1;
    }
  }
  if (self && self.config.baseUrl && !flags.overrides.baseUrl) config.model.baseUrl = self.config.baseUrl;
  if (self && self.config.model && !flags.overrides.model) config.model.name = self.config.model;
  if (self && self.config.temperature !== undefined) config.model.temperature = self.config.temperature;

  const shouldOpen = flags.open !== false && !flags.host;
  const demo = Boolean(flags.demo);

  if (flags.host && flags.host !== "127.0.0.1" && flags.host !== "localhost") {
    console.error(yellow(`! listening on ${flags.host} — this window will be reachable from your network`));
    console.error(dim("  the URL contains a secret token; do not leave this running on a shared network"));
  }
  if (demo) {
    console.error(yellow("! demo mode: canned replies, no model, nothing is really executed"));
  }

  const demoModel = (): Model => {
    if (!demo) return new OpenAIModel(config);
    // A tiny scripted brain so the window can be shown (screenshots, a shop
    // demo) without a 5 GB model download. It never touches a real file.
    let turn = 0;
    const folder = self ? path.relative(cwd, self.dir) || "." : ".";
    return new ScriptedModel([
      scriptedCall("list_dir", { path: folder, depth: 1 }, ""),
      scriptedCall("recall", {}, ""),
      scriptedText(
        "This is demo mode, so I am showing you how I would work rather than doing it.\n\n" +
          "In a real session I would read your folder, run the command you approved, and answer with the output. " +
          "Start a local model with `ollama serve` and relaunch without --demo to talk to the real thing.",
      ),
      scriptedText("Demo complete."),
    ]);
    void turn;
  };

  let server: Awaited<ReturnType<typeof startAppServer>>;
  try {
    server = await startAppServer({
      config,
      cwd,
      self,
      port: flags.port ?? 0,
      openBrowser: shouldOpen ? openWindow : undefined,
      demo,
      host: flags.host,
      makeAgent: async ({ approve, onEvent }) => {
        const built = await buildAgent(flags, config, cwd, {
          approve,
          onEvent,
          persona: self ? personaBlock(self) : undefined,
          memoryPath: self ? memoryPath(self) : undefined,
          modelOverride: demo ? demoModel() : undefined,
        });
        return {
          agent: built.agent,
          close: async () => {
            built.tracer.close();
            for (const client of built.mcpClients) client.close();
            await closeBrowser();
          },
        };
      },
      log: (message) => {
        try {
          fs.mkdirSync(path.dirname(APP_LOG()), { recursive: true });
          fs.appendFileSync(APP_LOG(), `${new Date().toISOString()} ${message}\n`);
        } catch {
          /* logging must never break the app */
        }
      },
    });
  } catch (err) {
    console.error(red(`could not start the app: ${(err as Error).message}`));
    return 1;
  }

  console.log(`${bold(self?.config.name ?? "mox")} ${dim("is open in a window")}`);
  console.log(dim(`  ${server.url.replace(/token=[^&]+/, "token=…")}`));
  console.log(dim("  Ctrl-C to close."));

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  await new Promise<void>(() => undefined);
  return 0;
}

// ---------------------------------------------------------------- main

async function main(argv: string[]): Promise<number> {
  let flags: Flags;
  try {
    flags = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(red(err.message));
      console.error(dim("run `mox --help`"));
      return 2;
    }
    throw err;
  }

  if (flags.version) {
    console.log(readVersion());
    return 0;
  }
  if (flags.help) {
    console.log(HELP);
    return 0;
  }

  switch (flags.command) {
    case "doctor":
      return await cmdDoctor(flags);
    case "init":
      return cmdInit();
    case "tools":
      return cmdTools(flags);
    case "runs":
      return cmdRuns(flags);
    case "show":
      return cmdShow(flags);
    case "config":
      return cmdConfig(flags);
    case "chat":
      return await cmdChat(flags);
    case "self":
      return await cmdSelf(flags);
    case "app":
      return await cmdApp(flags);
    default: {
      const task = flags.prompt.join(" ").trim();
      if (!task) {
        console.error(red("no task given"));
        console.error(dim("example: mox \"add a test for parseToolArgs\""));
        return 2;
      }
      return await cmdRun(flags, task);
    }
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof ConfigError) {
      console.error(red(`config error: ${err.message}`));
      process.exitCode = 2;
      return;
    }
    if (err instanceof ModelError) {
      console.error(red(`model error: ${err.message}`));
      process.exitCode = 1;
      return;
    }
    if (err instanceof ToolError) {
      console.error(red(`tool error: ${err.message}`));
      process.exitCode = 1;
      return;
    }
    console.error(red(`fatal: ${(err as Error)?.stack ?? String(err)}`));
    process.exitCode = 1;
  });
