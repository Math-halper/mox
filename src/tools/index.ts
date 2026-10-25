import type { Config } from "../types.ts";
import type { ToolDef } from "./types.ts";
import { shellTool } from "./shell.ts";
import { fileTools } from "./files.ts";
import { httpTools } from "./http.ts";
import { memoryTools } from "./memory.ts";
import { browserTools } from "./browser.ts";

export function builtinTools(config: Config): ToolDef[] {
  const tools: ToolDef[] = [];
  if (config.tools.shell) tools.push(shellTool);
  if (config.tools.files) tools.push(...fileTools);
  if (config.tools.http) tools.push(...httpTools);
  if (config.tools.browser) tools.push(...browserTools);
  if (config.tools.memory) tools.push(...memoryTools);
  return tools;
}

export type { ToolDef, ToolContext } from "./types.ts";
export { ToolError } from "./types.ts";
export { shellTool, runShell, sanitizeEnv } from "./shell.ts";
export { fileTools, readFileTool, writeFileTool, editFileTool, grepTool, globTool, listDirTool } from "./files.ts";
export { httpTools, httpTool, isPrivateUrl } from "./http.ts";
export { memoryTools, readMemory } from "./memory.ts";
export { browserTools } from "./browser.ts";
