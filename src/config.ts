import fs from "node:fs";
import path from "node:path";
import type { Config, PolicyRule, ToolProtocol } from "./types.ts";
import { isPlainObject } from "./util.ts";

export const CONFIG_FILENAME = "mox.config.json";

export const DEFAULT_CONFIG: Config = {
  model: {
    baseUrl: "http://127.0.0.1:11434/v1",
    name: "",
    apiKey: "local",
    temperature: 0.2,
    maxTokens: 4096,
    timeoutMs: 180_000,
    protocol: "auto",
  },
  agent: {
    maxSteps: 40,
    maxToolOutputChars: 12_000,
    systemPromptExtra: "",
  },
  policy: {
    mode: "ask",
    rules: [],
    allowDangerous: false,
    allowOutsideRoots: false,
  },
  sandbox: {
    mode: "auto",
    allowNetwork: true,
    maskHome: true,
    required: false,
  },
  trace: {
    dir: ".mox/runs",
    enabled: true,
  },
  memory: {
    enabled: true,
    path: ".mox/MEMORY.md",
  },
  tools: {
    shell: true,
    files: true,
    http: true,
    browser: true,
    memory: true,
  },
  mcpServers: {},
};

export class ConfigError extends Error {}

function merge<T>(base: T, override: unknown): T {
  if (!isPlainObject(override)) return base;
  if (!isPlainObject(base)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = (base as Record<string, unknown>)[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      out[key] = merge(current, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

/** Walk up from `start` looking for mox.config.json (project-local config). */
export function findConfigFile(start: string): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readConfigFile(file: string): Partial<Config> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new ConfigError(`cannot read ${file}: ${(err as Error).message}`);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw new ConfigError(`${file} must contain a JSON object`);
    }
    return parsed as Partial<Config>;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`${file} is not valid JSON: ${(err as Error).message}`);
  }
}

function envBool(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  return !["0", "false", "no", "off", ""].includes(raw.toLowerCase());
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ConfigError(`${name} must be a number, got "${raw}"`);
  return n;
}

export type CliOverrides = {
  cwd?: string;
  baseUrl?: string;
  model?: string;
  maxSteps?: number;
  protocol?: ToolProtocol;
  traceDir?: string;
  noSandbox?: boolean;
  approval?: "ask" | "auto" | "readonly";
};

export type LoadedConfig = {
  config: Config;
  /** Absolute path of the config file used, if any. */
  source: string | null;
  cwd: string;
};

export function loadConfig(cwd: string, overrides: CliOverrides = {}): LoadedConfig {
  const root = path.resolve(overrides.cwd ?? cwd);
  const file = findConfigFile(root);
  let config = DEFAULT_CONFIG;
  if (file) config = merge(config, readConfigFile(file));

  const env: Partial<Config> = {
    model: {
      ...config.model,
      baseUrl: process.env.MOX_BASE_URL ?? config.model.baseUrl,
      name: process.env.MOX_MODEL ?? config.model.name,
      apiKey: process.env.MOX_API_KEY ?? config.model.apiKey,
      protocol: (process.env.MOX_PROTOCOL as ToolProtocol | undefined) ?? config.model.protocol,
      maxTokens: envNumber("MOX_MAX_TOKENS") ?? config.model.maxTokens,
      timeoutMs: envNumber("MOX_TIMEOUT_MS") ?? config.model.timeoutMs,
      temperature: envNumber("MOX_TEMPERATURE") ?? config.model.temperature,
    },
    agent: {
      ...config.agent,
      maxSteps: envNumber("MOX_MAX_STEPS") ?? config.agent.maxSteps,
    },
    policy: {
      ...config.policy,
      mode:
        (process.env.MOX_APPROVAL as Config["policy"]["mode"] | undefined) ??
        config.policy.mode,
    },
    trace: {
      ...config.trace,
      dir: process.env.MOX_TRACE_DIR ?? config.trace.dir,
      enabled: envBool("MOX_TRACE") ?? config.trace.enabled,
    },
    sandbox: {
      ...config.sandbox,
      mode: envBool("MOX_NO_SANDBOX") ? "off" : config.sandbox.mode,
    },
  };
  config = merge(config, env);

  // CLI flags win over everything.
  config = merge(config, {
    model: {
      baseUrl: overrides.baseUrl ?? config.model.baseUrl,
      name: overrides.model ?? config.model.name,
      protocol: overrides.protocol ?? config.model.protocol,
    },
    agent: { maxSteps: overrides.maxSteps ?? config.agent.maxSteps },
    trace: { dir: overrides.traceDir ?? config.trace.dir },
    sandbox: { mode: overrides.noSandbox ? "off" : config.sandbox.mode },
    policy: { mode: overrides.approval ?? config.policy.mode },
  });

  validate(config);
  return { config, source: file, cwd: root };
}

function validate(config: Config): void {
  if (!["ask", "auto", "readonly"].includes(config.policy.mode)) {
    throw new ConfigError(
      `policy.mode must be "ask", "auto" or "readonly" (got "${config.policy.mode}")`,
    );
  }
  if (!["auto", "native", "text"].includes(config.model.protocol)) {
    throw new ConfigError(
      `model.protocol must be "auto", "native" or "text" (got "${config.model.protocol}")`,
    );
  }
  if (config.agent.maxSteps < 1) throw new ConfigError("agent.maxSteps must be >= 1");
  if (config.model.maxTokens < 1) throw new ConfigError("model.maxTokens must be >= 1");
  if (config.model.baseUrl && !/^https?:\/\//.test(config.model.baseUrl)) {
    throw new ConfigError(`model.baseUrl must start with http:// or https://`);
  }
  for (const [i, rule] of config.policy.rules.entries()) {
    if (!["allow", "ask", "deny"].includes(rule.decision)) {
      throw new ConfigError(`policy.rules[${i}].decision must be allow|ask|deny`);
    }
    if (rule.match) {
      try {
        new RegExp(rule.match);
      } catch {
        throw new ConfigError(`policy.rules[${i}].match is not a valid regex`);
      }
    }
  }
}

export function normalizeRules(rules: PolicyRule[]): PolicyRule[] {
  return rules.map((rule) => ({
    tool: rule.tool ?? "*",
    match: rule.match,
    decision: rule.decision,
    reason: rule.reason,
  }));
}

/** Never print the API key back out. */
export function redactConfig(config: Config): Config {
  return {
    ...config,
    model: { ...config.model, apiKey: config.model.apiKey ? "***" : "" },
  };
}
