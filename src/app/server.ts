import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import type { AgentEvent, ChatMessage, Config } from "../types.ts";
import type { Agent, ApprovalRequest } from "../agent.ts";
import { ToolError } from "../tools/index.ts";
import { appendHistory, loadSelf, memoryPath, type Self } from "../self.ts";
import { oneLine } from "../util.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_HTML = path.join(HERE, "ui.html");
const UI_ICON = path.join(HERE, "icon.svg");

const APPROVAL_TIMEOUT_MS = 5 * 60_000;
const MAX_BODY_BYTES = 256 * 1024;

export type AppServerOptions = {
  /** Agent factory: a fresh agent per message, already wired to the model. */
  makeAgent: (opts: {
    approve: (req: ApprovalRequest) => Promise<boolean>;
    onEvent: (event: AgentEvent) => void;
  }) => Promise<{ agent: Agent; close: () => Promise<void> }>;
  config: Config;
  cwd: string;
  self?: Self | null;
  port?: number;
  /** Default 127.0.0.1. Anything else disables the Host check — see the warning. */
  host?: string;
  demo?: boolean;
  openBrowser?: (url: string) => void;
  log?: (message: string) => void;
};

export type AppServer = {
  url: string;
  port: number;
  token: string;
  close: () => Promise<void>;
  clients: number;
};

type Pending = {
  id: string;
  request: ApprovalRequest;
  resolve: (allowed: boolean) => void;
  timer: NodeJS.Timeout;
};

type Client = { id: number; res: http.ServerResponse };

function securityHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    ...extra,
  };
}

/**
 * A local-only HTTP server that serves the chat window and bridges it to the
 * agent. Deliberately small and locked down:
 *
 *  - binds 127.0.0.1 only
 *  - every API call needs a per-launch random token, so other pages/apps on
 *    the machine cannot drive your agent
 *  - Host header is checked (DNS rebinding)
 *  - approval prompts happen in the window, and the same policy engine
 *    decides what needs one
 */
export async function startAppServer(opts: AppServerOptions): Promise<AppServer> {
  const host = opts.host ?? "127.0.0.1";
  const loopbackOnly = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const token = randomBytes(32).toString("hex");
  const log = opts.log ?? (() => undefined);

  let messages: ChatMessage[] = [];
  let busy = false;
  let closed = false;
  let aborted = false;
  const clients = new Set<Client>();
  const pending = new Map<string, Pending>();
  let clientSeq = 0;

  const broadcast = (payload: Record<string, unknown>) => {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) {
      try {
        client.res.write(line);
      } catch {
        clients.delete(client);
      }
    }
  };

  const html = fs.readFileSync(UI_HTML, "utf8");
  const icon = fs.readFileSync(UI_ICON, "utf8");

  const statePayload = () => ({
    demo: Boolean(opts.demo),
    name: opts.self?.config.name ?? "mox",
    selfDir: opts.self?.dir ?? null,
    hasSelf: Boolean(opts.self),
    knowledge: opts.self?.knowledge.map((entry) => entry.file) ?? [],
    skills: opts.self?.skills.map((entry) => entry.file) ?? [],
    model: opts.config.model.name || "(auto)",
    baseUrl: opts.config.model.baseUrl,
    policyMode: opts.config.policy.mode,
    cwd: opts.cwd,
    tools: {
      shell: opts.config.tools.shell,
      files: opts.config.tools.files,
      http: opts.config.tools.http,
      browser: opts.config.tools.browser,
      memory: opts.config.tools.memory,
    },
  });

  const readBody = (req: http.IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error("request body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  const authorised = (req: http.IncomingMessage, url: URL): boolean => {
    const header = req.headers["x-mox-token"];
    const provided = (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get("token") ?? "";
    if (provided !== token) return false;
    if (!loopbackOnly) return true; // explicit opt-in: see the warning at startup
    // DNS rebinding: a page on evil.com can point its hostname at 127.0.0.1.
    const hostHeader = String(req.headers.host ?? "");
    const hostname = hostHeader.split(":")[0] ?? "";
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  };

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    const text = JSON.stringify(body);
    res.writeHead(status, securityHeaders({ "content-type": "application/json; charset=utf-8" }));
    res.end(text);
  };

  const requestApproval = (req: ApprovalRequest): Promise<boolean> => {
    const id = randomBytes(8).toString("hex");
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        broadcast({ type: "approval_resolved", id, allowed: false, reason: "timed out" });
        resolve(false);
      }, APPROVAL_TIMEOUT_MS);
      pending.set(id, { id, request: req, resolve, timer });
      broadcast({
        type: "approval_request",
        id,
        tool: req.tool,
        args: req.args,
        summary: req.summary,
        reason: req.reason,
      });
      log(`waiting for approval: ${req.tool} (${req.reason})`);
    });
  };

  const handleMessage = async (text: string) => {
    // busy is already set by the request handler, synchronously, so two
    // messages in the same tick cannot both start a run.
    aborted = false;
    const started = Date.now();
    let built: Awaited<ReturnType<AppServerOptions["makeAgent"]>> | null = null;
    try {
      broadcast({ type: "user", text });
      if (opts.self) appendHistory(opts.self, "user", text);

      built = await opts.makeAgent({
        approve: requestApproval,
        onEvent: (event) => {
          if (closed) return;
          switch (event.type) {
            case "step":
              broadcast({ type: "status", busy: true, step: event.step });
              break;
            case "assistant":
              broadcast({ type: "assistant_note", text: event.text });
              break;
            case "tool_start":
              broadcast({ type: "tool_start", name: event.name, args: event.args });
              break;
            case "tool_end":
              broadcast({
                type: "tool_end",
                name: event.name,
                content: oneLine(event.content, 1200),
                isError: event.isError,
                ms: event.ms,
              });
              break;
            case "notice":
              broadcast({ type: "notice", message: event.message });
              break;
            case "approval":
              if (event.decision === "deny") {
                broadcast({ type: "notice", message: `blocked: ${event.reason}` });
              }
              break;
            default:
              break;
          }
        },
      });

      const result = await built.agent.run(text, { history: messages });
      messages = result.messages;
      if (opts.self) appendHistory(opts.self, "assistant", result.text);
      broadcast({
        type: "answer",
        text: result.text,
        steps: result.steps,
        ms: Date.now() - started,
        usage: result.usage,
        aborted: result.aborted,
      });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      broadcast({ type: "error", message });
    } finally {
      busy = false;
      broadcast({ type: "status", busy: false });
      if (built) await built.close().catch(() => undefined);
    }
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      const route = url.pathname;

      // --- static, no auth needed for the page itself (it holds no secrets)
      if (req.method === "GET" && (route === "/" || route === "/index.html")) {
        const nonceToken = token;
        const page = html.replace("__MOX_TOKEN__", nonceToken);
        res.writeHead(
          200,
          securityHeaders({
            "content-type": "text/html; charset=utf-8",
            "content-security-policy":
              "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
          }),
        );
        res.end(page);
        return;
      }
      if (req.method === "GET" && route === "/icon.svg") {
        res.writeHead(200, securityHeaders({ "content-type": "image/svg+xml" }));
        res.end(icon);
        return;
      }

      // --- everything else requires the token
      if (!authorised(req, url)) {
        json(res, 403, { error: "unauthorised" });
        return;
      }

      if (req.method === "GET" && route === "/api/state") {
        json(res, 200, { ...statePayload(), busy });
        return;
      }

      if (req.method === "GET" && route === "/api/events") {
        res.writeHead(
          200,
          securityHeaders({
            "content-type": "text/event-stream",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          }),
        );
        res.write("retry: 2000\n\n");
        const client: Client = { id: ++clientSeq, res };
        clients.add(client);
        res.write(`data: ${JSON.stringify({ type: "state", ...statePayload(), busy })}\n\n`);
        const heartbeat = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch {
            clearInterval(heartbeat);
          }
        }, 20_000);
        req.on("close", () => {
          clearInterval(heartbeat);
          clients.delete(client);
        });
        return;
      }

      if (req.method === "POST" && route === "/api/message") {
        if (busy) {
          json(res, 409, { error: "already working on something" });
          return;
        }
        let parsed: { text?: unknown };
        try {
          parsed = JSON.parse(await readBody(req)) as { text?: unknown };
        } catch {
          json(res, 400, { error: "invalid JSON" });
          return;
        }
        const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
        if (!text) {
          json(res, 400, { error: "empty message" });
          return;
        }
        busy = true;
        json(res, 202, { ok: true });
        void handleMessage(text);
        return;
      }

      if (req.method === "POST" && route === "/api/approve") {
        let parsed: { id?: unknown; allow?: unknown };
        try {
          parsed = JSON.parse(await readBody(req)) as { id?: unknown; allow?: unknown };
        } catch {
          json(res, 400, { error: "invalid JSON" });
          return;
        }
        const id = String(parsed.id ?? "");
        const entry = pending.get(id);
        if (!entry) {
          json(res, 404, { error: "no such approval (it may have timed out)" });
          return;
        }
        const allow = parsed.allow === true;
        pending.delete(id);
        clearTimeout(entry.timer);
        broadcast({ type: "approval_resolved", id, allowed: allow });
        entry.resolve(allow);
        json(res, 200, { ok: true, allowed: allow });
        return;
      }

      if (req.method === "POST" && route === "/api/new") {
        messages = [];
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && route === "/api/abort") {
        aborted = true;
        for (const [id, entry] of pending) {
          clearTimeout(entry.timer);
          entry.resolve(false);
          pending.delete(id);
          broadcast({ type: "approval_resolved", id, allowed: false, reason: "aborted" });
        }
        json(res, 200, { ok: true, aborted });
        return;
      }

      json(res, 404, { error: "not found" });
    })().catch((err) => {
      if (!res.headersSent) json(res, 500, { error: (err as Error).message });
      else res.end();
    });
  });

  const port = opts.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const displayHost = loopbackOnly ? host : "127.0.0.1";
  const url = `http://${displayHost}:${actualPort}/?token=${token}`;

  const close = async () => {
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(false);
    }
    pending.clear();
    for (const client of clients) {
      try {
        client.res.end();
      } catch {
        /* gone */
      }
    }
    clients.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  opts.openBrowser?.(url);

  return { url, port: actualPort, token, close, get clients() { return clients.size; } };
}

/** Pick a sensible default folder: a self next to you, else none. */
export function resolveAppTarget(cwd: string, explicit?: string): string | null {
  if (explicit) {
    // An explicit folder must really be a self; silently falling back to "no
    // folder" is how the menu entry ended up ignoring its argument.
    const resolved = path.resolve(cwd, explicit);
    return fs.existsSync(path.join(resolved, "SELF.md")) ? resolved : null;
  }
  const candidates = [path.join(cwd, "brain"), cwd];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "SELF.md"))) return candidate;
  }
  return null;
}

export function selfOrNull(dir: string | null): Self | null {
  if (!dir) return null;
  try {
    return loadSelf(dir);
  } catch (err) {
    if (err instanceof ToolError) return null;
    throw err;
  }
}

export { memoryPath };
