import type { Config, JsonSchema } from "../types.ts";
import type { SandboxStatus } from "../sandbox.ts";

export type ToolContext = {
  cwd: string;
  config: Config;
  sandbox: SandboxStatus;
  signal?: AbortSignal;
  notice: (message: string) => void;
};

export type ToolDef = {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Read-only tools never need approval in "ask" mode. */
  readOnly: boolean;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  /**
   * Optional extra check that can force approval even for read-only tools
   * (e.g. HTTP requests to private network addresses).
   */
  escalate?: (args: Record<string, unknown>) => string | null;
  /** Short one-line preview of the call for the UI. */
  summarize?: (args: Record<string, unknown>) => string;
};

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function str(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function num(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

export function bool(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = args[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  return fallback;
}

export function requireStr(args: Record<string, unknown>, key: string): string {
  const value = str(args, key);
  if (!value) throw new ToolError(`missing required argument "${key}"`);
  return value;
}
