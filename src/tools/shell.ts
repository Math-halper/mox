import { spawn } from "node:child_process";
import path from "node:path";
import type { ToolDef } from "./types.ts";
import { ToolError, num, requireStr, str } from "./types.ts";
import { planSandbox } from "../sandbox.ts";
import { truncateMiddle } from "../util.ts";

const KEEP_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TZ",
  "PWD",
  "NODE_PATH",
  "NVM_DIR",
  "PYTHONPATH",
  "VIRTUAL_ENV",
]);

/** Never hand the model your API keys through a stray `env` call. */
export function sanitizeEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (KEEP_ENV.has(key)) {
      out[key] = value;
      continue;
    }
    if (/(^|_)(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE)(_|$)/i.test(key)) {
      continue;
    }
    if (/(API|ACCESS|SECRET|BEARER)_?/i.test(key) && /KEY|TOKEN|SECRET/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export type ShellResult = {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
  confined: boolean;
};

export async function runShell(opts: {
  command: string;
  cwd: string;
  config: Parameters<typeof planSandbox>[0];
  sandbox: Parameters<typeof planSandbox>[1];
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ShellResult> {
  const plan = planSandbox(opts.config, opts.sandbox, opts.cwd, opts.command);
  // Sandboxed plans already end with `bash -lc <command>`; an unsandboxed plan
  // is empty, so build the argv explicitly in both cases.
  const argv = plan.prefix.length > 0 ? plan.prefix : ["bash", "-lc", opts.command];
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const started = Date.now();

  return await new Promise<ShellResult>((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: opts.cwd,
      env: sanitizeEnv(),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const cap = 1_000_000;
    let timedOut = false;

    const killTree = () => {
      if (child.pid === undefined) return;
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);

    const onAbort = () => {
      timedOut = false;
      killTree();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < cap) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < cap) stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(
        new ToolError(
          `failed to start command${plan.warning ? ` (${plan.warning})` : ""}: ${err.message}`,
        ),
      );
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
        ms: Date.now() - started,
        confined: plan.confined,
      });
    });
  });
}

function formatResult(result: ShellResult, maxChars: number, command: string): string {
  const parts: string[] = [];
  if (result.timedOut) parts.push(`[timed out] command: ${command}`);
  parts.push(`exit code: ${result.code ?? "null"}${result.signal ? ` (signal ${result.signal})` : ""}`);
  const combined = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join("\n");
  if (!combined) parts.push("(no output)");
  else parts.push(truncateMiddle(combined, maxChars));
  return parts.join("\n");
}

export const shellTool: ToolDef = {
  name: "shell",
  description:
    "Run a bash command with `bash -lc` and return its exit code plus combined stdout/stderr. " +
    "Use it for builds, tests, git, package managers, and reading system state. " +
    "Runs in the project directory unless `cwd` is given. Long output is truncated in the middle.",
  readOnly: false,
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The bash command to run." },
      cwd: { type: "string", description: "Working directory, relative to the project root." },
      timeout_ms: {
        type: "integer",
        description: "Kill the command after this many milliseconds (default 120000).",
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  summarize: (args) => str(args, "command"),
  async execute(args, ctx) {
    const command = requireStr(args, "command");
    const cwdArg = str(args, "cwd");
    const cwd = cwdArg ? path.resolve(ctx.cwd, cwdArg) : ctx.cwd;
    const timeoutMs = Math.min(num(args, "timeout_ms", 120_000), 15 * 60_000);

    const result = await runShell({
      command,
      cwd,
      config: ctx.config,
      sandbox: ctx.sandbox,
      timeoutMs,
      signal: ctx.signal,
    });
    if (!result.confined && ctx.config.sandbox.mode !== "off") {
      ctx.notice(
        `ran unsandboxed (${ctx.sandbox.detail}). Install bubblewrap for kernel-level confinement.`,
      );
    }
    return formatResult(result, ctx.config.agent.maxToolOutputChars, command);
  },
};
