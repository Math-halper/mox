import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "./types.ts";
import { ToolError, requireStr, str } from "./types.ts";
import { resolveUserPath, truncateEnd } from "../util.ts";

const HEADER = `# mox memory

Notes this agent has been asked to keep. Edit freely — it is read at the start of every run.
`;

type MemoryConfig = { memory: { path: string; enabled: boolean } };

function memoryPath(cwd: string, config: MemoryConfig): string {
  return resolveUserPath(cwd, config.memory.path);
}

export function readMemory(cwd: string, config: MemoryConfig): string {
  if (!config.memory.enabled) return "";
  const file = memoryPath(cwd, config);
  try {
    const text = fs.readFileSync(file, "utf8");
    return truncateEnd(text.trim(), 6000);
  } catch {
    return "";
  }
}

export const rememberTool: ToolDef = {
  name: "remember",
  description:
    "Append a durable note to the project memory file for future runs. " +
    "Use for user preferences, environment quirks, and decisions. Keep entries short.",
  readOnly: false,
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The note to store, one or two lines." },
    },
    required: ["text"],
    additionalProperties: false,
  },
  summarize: (args) => str(args, "text", "").slice(0, 80),
  async execute(args, ctx) {
    if (!ctx.config.memory.enabled) throw new ToolError("memory is disabled in config");
    const text = requireStr(args, "text").replace(/\s+/g, " ").trim();
    const file = memoryPath(ctx.cwd, ctx.config);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, HEADER, "utf8");
    const stamp = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(file, `\n- (${stamp}) ${text}\n`, "utf8");
    return `remembered: ${text}`;
  },
};

export const recallTool: ToolDef = {
  name: "recall",
  description: "Read back the project memory file (all remembered notes).",
  readOnly: true,
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute(_args, ctx) {
    const text = readMemory(ctx.cwd, ctx.config);
    return text || "(memory is empty)";
  },
};

export const memoryTools = [rememberTool, recallTool];
