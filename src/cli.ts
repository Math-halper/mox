import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { AgentEvent, ChatMessage, Config, ToolProtocol } from "./types.ts";
import { ConfigError, DEFAULT_CONFIG, loadConfig, redactConfig, type CliOverrides } from "./config.ts";
import { OpenAIModel, ModelError } from "./model.ts";
import { Agent, type ApprovalRequest } from "./agent.ts";
import { builtinTools, ToolError } from "./tools/index.ts";
import { detectSandbox } from "./sandbox.ts";
import { Tracer, listRuns, readRun } from "./trace.ts";
import { loadMcpTools, type McpClient } from "./mcp.ts";
import { closeBrowser } from "./tools/browser.ts";
import { formatMs, oneLine } from "./util.ts";

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
  --verbose                     stream full tool output
  --json                        machine-readable events on stdout
  -h, --help                    this text
  -v, --version                 version

${bold("EXAMPLES")}
  mox "find the flaky test and fix it"
  mox chat --model qwen3:8b
  mox "summarise README.md into 3 bullets" --yes
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
  command: "run" | "chat" | "doctor" | "init" | "tools" | "runs" | "show" | "config";
  showTarget?: string;
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

  const commands = new Set(["chat", "doctor", "init", "tools", "runs", "show", "config"]);
  let index = 0;
  if (argv[0] && commands.has(argv[0])) {
    flags.command = argv[0] as Flags["command"];
    index = 1;
    if (flags.command === "show" && argv[1] && !argv[1].startsWith("-")) {
      flags.showTarget = argv[1];
      index = 2;
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
    } else if (arg === "--protocol") {
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
          process.stderr.write(`\n${event.text}\n`);
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
  ask?: (question: string) => Promise<string>,
): Promise<{ agent: Agent; model: OpenAIModel; tracer: Tracer; mcpClients: McpClient[] }> {
  const model = new OpenAIModel(config);
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
  const approve = makeApprover({
    interactive,
    auto: config.policy.mode === "auto",
    json: flags.json,
    ask,
  });

  const render = renderer({ verbose: flags.verbose, json: flags.json });

  const agent = new Agent({
    config,
    model,
    tools,
    cwd,
    sandbox: detectSandbox(),
    tracer,
    approve,
    onEvent: render.handle,
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
  const { agent, tracer, mcpClients, model } = await buildAgent(flags, config, cwd, ask);

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
