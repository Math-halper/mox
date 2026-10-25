import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { McpServerConfig } from "./types.ts";
import type { ToolDef } from "./tools/types.ts";
import { ToolError, type ToolContext } from "./tools/types.ts";
import { truncateMiddle } from "./util.ts";

/**
 * Minimal MCP (Model Context Protocol) stdio client.
 *
 * MCP is what makes "everything" tractable: each app exposes its own tools over
 * one protocol, so mox does not need a bespoke integration per service.
 * Transport: newline-delimited JSON-RPC 2.0 over a child process's stdio.
 */

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
};

export type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

const CLIENT_INFO = { name: "mox", version: "0.1.0" };
const PROTOCOL_VERSION = "2024-11-05";

export class McpClient {
  readonly name: string;
  private readonly config: McpServerConfig;
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private buffer = "";
  private stderrTail = "";
  private closed = false;

  constructor(name: string, config: McpServerConfig) {
    this.name = name;
    this.config = config;
  }

  async start(): Promise<void> {
    const [command, ...rest] = [this.config.command, ...(this.config.args ?? [])];
    if (!command) throw new ToolError(`mcp server "${this.name}" has no command`);
    this.child = spawn(command, rest, {
      cwd: this.config.cwd,
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.child.on("error", (err) => this.failAll(new Error(`mcp "${this.name}" failed: ${err.message}`)));
    this.child.on("exit", (code) => {
      this.closed = true;
      this.failAll(new Error(`mcp "${this.name}" exited with code ${code}${this.stderrTail ? `: ${this.stderrTail}` : ""}`));
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-2000);
    });

    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    }, 20_000);
    this.notify("notifications/initialized", {});
  }

  private failAll(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.onLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return; // servers sometimes log to stdout; ignore non-JSON
    }
    if (message.id === undefined) return; // notification
    const entry = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
    if (!entry) return;
    this.pending.delete(message.id as number);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new ToolError(`mcp error ${message.error.code}: ${message.error.message}`));
    else entry.resolve(message.result);
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.child || this.closed) throw new ToolError(`mcp "${this.name}" is not running`);
    this.child.stdin.write(JSON.stringify(payload) + "\n");
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method: string, params: unknown, timeoutMs = this.config.timeout_ms ?? 60_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ToolError(`mcp "${this.name}" timed out on ${method} after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.request("tools/list", {})) as { tools?: McpToolInfo[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    const parts: string[] = [];
    for (const item of result.content ?? []) {
      if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
      else if (item.type) parts.push(`[${item.type} content]`);
    }
    return { text: parts.join("\n") || "(empty result)", isError: result.isError === true };
  }

  close(): void {
    this.closed = true;
    this.failAll(new Error(`mcp "${this.name}" closed`));
    try {
      this.child?.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
}

/**
 * Start every configured MCP server and expose its tools as first-class tools
 * named `mcp__<server>__<tool>`.
 */
export async function loadMcpTools(
  servers: Record<string, McpServerConfig>,
  onWarning: (message: string) => void,
): Promise<{ tools: ToolDef[]; clients: McpClient[]; warnings: string[] }> {
  const tools: ToolDef[] = [];
  const clients: McpClient[] = [];
  const warnings: string[] = [];

  for (const [serverName, config] of Object.entries(servers)) {
    const client = new McpClient(serverName, config);
    try {
      await client.start();
      const infos = await client.listTools();
      clients.push(client);
      for (const info of infos) {
        const toolName = `mcp__${sanitize(serverName)}__${sanitize(info.name)}`;
        const schema = (info.inputSchema ?? {
          type: "object",
          properties: {},
        }) as ToolDef["parameters"];
        if (schema.type !== "object") {
          schema.type = "object";
          schema.properties ??= {};
        }
        tools.push({
          name: toolName,
          description: `${info.description ?? info.name} (from MCP server "${serverName}")`,
          parameters: schema,
          readOnly: false,
          summarize: (args) =>
            Object.entries(args)
              .slice(0, 2)
              .map(([k, v]) => `${k}=${truncateMiddle(String(v), 40)}`)
              .join(" "),
          async execute(args: Record<string, unknown>, _ctx: ToolContext) {
            const result = await client.callTool(info.name, args);
            if (result.isError) throw new ToolError(result.text);
            return result.text;
          },
        });
      }
    } catch (err) {
      client.close();
      const message = `MCP server "${serverName}" unavailable: ${(err as Error).message}`;
      warnings.push(message);
      onWarning(message);
    }
  }
  return { tools, clients, warnings };
}
