import path from "node:path";
import type { Config, Decision, PolicyRule } from "./types.ts";
import { isInside, resolveUserPath } from "./util.ts";

export type PolicyRequest = {
  /** Tool name, e.g. "shell", "write_file". */
  name: string;
  args: Record<string, unknown>;
  readOnly: boolean;
};

export type PolicyVerdict = { decision: Decision; reason: string };

type DangerPattern = { pattern: RegExp; reason: string };

/**
 * Commands that are almost never what the user meant. These are denied even in
 * "auto" mode unless policy.allowDangerous is set (e.g. a throwaway container).
 */
const DANGEROUS: DangerPattern[] = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/(?!tmp\b)|~\/?|\$HOME)(\s|$)/, reason: "recursive delete of / or home" },
  { pattern: /\brm\s+-[a-zA-Z]*\s*\/(\s|$)/, reason: "delete from filesystem root" },
  { pattern: /\bmkfs(\.|\s)/, reason: "format a filesystem" },
  { pattern: /\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|disk|hd)/, reason: "overwrite a block device" },
  { pattern: /:\s*\(\s*\)\s*\{[^}]*\}\s*;\s*:/, reason: "fork bomb" },
  { pattern: /(^|\s)>\s*\/dev\/(sd|nvme|disk)/, reason: "overwrite a block device" },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/, reason: "power state change" },
  { pattern: /\bsudo\b|\bsu\s+-/, reason: "privilege escalation" },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\/(\s|$)/, reason: "open permissions on /" },
  { pattern: /\bchown\s+-R\s+\S+\s+\/(\s|$)/, reason: "change ownership of /" },
  { pattern: /\bgit\s+push\b[^\n]*(\s--force\b|\s-f\b)/, reason: "force push" },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: "discard uncommitted work" },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/, reason: "delete untracked files" },
  { pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(bash|sh|zsh|python[0-9.]*)\b/, reason: "pipe remote script into a shell" },
  { pattern: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/, reason: "publish a package" },
  { pattern: /\b(kill|pkill|killall)\s+(-9\s+)?1(\s|$)/, reason: "kill init" },
  { pattern: /\bsystemctl\s+(disable|mask)\b/, reason: "disable a system service" },
  { pattern: /\b(crontab|at)\s+-r\b/, reason: "delete scheduled jobs" },
  { pattern: /\bhistory\s+-c\b/, reason: "wipe shell history" },
  { pattern: /\b(reqwest|base64\s+-d)[^\n]*\|\s*(ba)?sh\b/, reason: "obfuscated remote execution" },
];

/** Credential paths the agent may not read or copy, regardless of mode. */
const SENSITIVE: DangerPattern[] = [
  { pattern: /(^|[/\\])\.ssh[/\\](id_[^/\\]+|[^/\\]+_key)$/, reason: "SSH private key" },
  { pattern: /(^|[/\\])\.ssh[/\\]config$/, reason: "SSH config (host inventory)" },
  { pattern: /(^|[/\\])\.aws[/\\]credentials$/, reason: "AWS credentials" },
  { pattern: /(^|[/\\])\.config[/\\]gh[/\\]hosts\.ya?ml$/, reason: "GitHub CLI token" },
  { pattern: /(^|[/\\])\.netrc$/, reason: "netrc credentials" },
  { pattern: /(^|[/\\])\.docker[/\\]config\.json$/, reason: "Docker registry credentials" },
  { pattern: /(^|[/\\])\.kube[/\\]config$/, reason: "Kubernetes credentials" },
  { pattern: /(^|[/\\])\.gnupg[/\\]/, reason: "GPG keyring" },
  { pattern: /(^|[/\\])\.config[/\\]mox[/\\]/, reason: "mox credentials" },
];

function shellCommand(req: PolicyRequest): string | null {
  if (req.name !== "shell") return null;
  const command = req.args["command"];
  return typeof command === "string" ? command : null;
}

function matchDanger(list: DangerPattern[], text: string): DangerPattern | null {
  for (const entry of list) {
    if (entry.pattern.test(text)) return entry;
  }
  return null;
}

function sensitivePath(args: Record<string, unknown>): string | null {
  for (const key of ["path", "file", "target", "save_to"]) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function matchRule(rules: PolicyRule[], req: PolicyRequest): PolicyRule | null {
  const encoded = JSON.stringify(req.args);
  for (const rule of rules) {
    if (rule.tool && rule.tool !== "*" && rule.tool !== req.name) continue;
    if (rule.match) {
      let re: RegExp;
      try {
        re = new RegExp(rule.match);
      } catch {
        continue;
      }
      if (!re.test(encoded)) continue;
    }
    return rule;
  }
  return null;
}

/**
 * Decide whether a tool call may run.
 *
 * Order matters: hard blocks and explicit user rules beat the mode, and the
 * mode beats tool defaults. "ask" is resolved by the caller (the CLI prompt).
 */
export function evaluatePolicy(
  config: Config,
  req: PolicyRequest,
  cwd: string,
): PolicyVerdict {
  const { policy } = config;
  const command = shellCommand(req);
  const target = sensitivePath(req.args);

  // 1. Credentials are off-limits even when the model was told to read them.
  const sensitive = matchDanger(SENSITIVE, target ?? "");
  if (sensitive) {
    return { decision: "deny", reason: `blocked ${sensitive.reason}` };
  }
  if (command) {
    const commandSensitive = matchDanger(SENSITIVE, command);
    if (commandSensitive) {
      return { decision: "deny", reason: `blocked ${commandSensitive.reason} in command` };
    }
  }

  // 2. Destructive shell commands.
  if (command) {
    const danger = matchDanger(DANGEROUS, command);
    if (danger) {
      return {
        decision: policy.allowDangerous ? "ask" : "deny",
        reason: `looks like ${danger.reason}`,
      };
    }
  }

  // 3. Explicit user rules.
  const rule = matchRule(policy.rules, req);
  if (rule) {
    return {
      decision: rule.decision,
      reason: rule.reason ?? `matched policy rule for ${req.name}`,
    };
  }

  if (policy.mode === "readonly") {
    return req.readOnly
      ? { decision: "allow", reason: "read-only tool" }
      : { decision: "deny", reason: "read-only mode" };
  }

  // 4. Writes outside the project need a human, unless explicitly allowed.
  if (!req.readOnly && !policy.allowOutsideRoots && target) {
    const resolved = resolveUserPath(cwd, target);
    if (!isInside(cwd, resolved) && !isInside(path.dirname(resolved), cwd)) {
      return { decision: "ask", reason: `writes outside ${cwd}` };
    }
  }

  if (policy.mode === "auto") {
    return { decision: "allow", reason: "auto mode" };
  }
  if (req.readOnly) {
    return { decision: "allow", reason: "read-only tool" };
  }
  return { decision: "ask", reason: `${req.name} modifies state` };
}

/** Natural-language summary used in the system prompt. */
export function describePolicy(config: Config): string {
  const mode = config.policy.mode;
  const base =
    mode === "auto"
      ? "Approval mode: auto. Calls run without prompting, except destructive commands and credential reads, which are blocked."
      : mode === "readonly"
        ? "Approval mode: read-only. Mutating tools are denied."
        : "Approval mode: ask. Read-only tools run freely; anything that changes state pauses for the user's approval.";
  const rules = config.policy.rules.length
    ? `\nExplicit rules (first match wins): ${config.policy.rules
        .map((r) => `${r.tool ?? "*"}${r.match ? ` ~ /${r.match}/` : ""} -> ${r.decision}`)
        .join("; ")}`
    : "";
  return base + rules;
}
