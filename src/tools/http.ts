import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "./types.ts";
import { ToolError, bool, num, requireStr, str } from "./types.ts";
import { htmlToText, resolveUserPath, truncateEnd } from "../util.ts";

const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|.*\.local|.*\.internal)/i;

export function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return true;
    return PRIVATE_HOST.test(parsed.hostname);
  } catch {
    return true;
  }
}

export const httpTool: ToolDef = {
  name: "http_request",
  description:
    "Make an HTTP request and return the status, selected headers, and body. " +
    "HTML is converted to readable text. Use this for APIs and docs; use `browser` for sites that need JavaScript or login.",
  readOnly: true,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "http(s) URL." },
      method: { type: "string", description: "GET, POST, PUT, PATCH, DELETE, HEAD (default GET)." },
      headers: { type: "object", description: "Request headers as a flat object." },
      body: { type: "string", description: "Request body. Objects/arrays are sent as JSON." },
      as: { type: "string", description: "How to parse the response: auto, text, json (default auto)." },
      save_to: { type: "string", description: "Also write the body to this file." },
      timeout_ms: { type: "integer", description: "Timeout in milliseconds (default 30000)." },
    },
    required: ["url"],
    additionalProperties: false,
  },
  summarize: (args) => `${str(args, "method", "GET").toUpperCase()} ${str(args, "url")}`,
  escalate(args) {
    const url = str(args, "url");
    if (url && isPrivateUrl(url)) return `requests ${url} (private or local address)`;
    if (str(args, "save_to")) return "writes a file";
    return null;
  },
  async execute(args, ctx) {
    const rawUrl = requireStr(args, "url");
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new ToolError(`invalid URL: ${rawUrl}`);
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new ToolError(`only http and https are supported (got ${url.protocol})`);
    }
    const method = str(args, "method", "GET").toUpperCase();
    const headers: Record<string, string> = {};
    const rawHeaders = args["headers"];
    if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
      for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
        if (typeof value === "string") headers[key] = value;
      }
    }
    let body: string | undefined;
    const rawBody = args["body"];
    if (rawBody !== undefined && rawBody !== null && method !== "GET" && method !== "HEAD") {
      if (typeof rawBody === "string") body = rawBody;
      else {
        body = JSON.stringify(rawBody);
        headers["content-type"] ??= "application/json";
      }
    }
    headers["user-agent"] ??= "mox/0.1 (+local agent)";
    const timeoutMs = Math.min(num(args, "timeout_ms", 30_000), 120_000);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers,
        body,
        redirect: "follow",
        signal: AbortSignal.any([
          AbortSignal.timeout(timeoutMs),
          ...(ctx.signal ? [ctx.signal] : []),
        ]),
      });
    } catch (err) {
      throw new ToolError(`request failed: ${(err as Error).message}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    const isText =
      contentType.includes("json") ||
      contentType.includes("text") ||
      contentType.includes("xml") ||
      contentType.includes("javascript");
    const maxChars = ctx.config.agent.maxToolOutputChars;

    let rendered: string;
    if (!isText) {
      rendered = `[binary response: ${buffer.byteLength} bytes, ${contentType || "unknown type"}]`;
    } else {
      const text = buffer.toString("utf8");
      const as = str(args, "as", "auto");
      if (as === "json" || (as === "auto" && contentType.includes("json"))) {
        try {
          rendered = truncateEnd(JSON.stringify(JSON.parse(text), null, 2), maxChars);
        } catch {
          rendered = truncateEnd(text, maxChars);
        }
      } else if (contentType.includes("html")) {
        rendered = truncateEnd(htmlToText(text), maxChars);
      } else {
        rendered = truncateEnd(text, maxChars);
      }
    }

    const saveTo = str(args, "save_to");
    if (saveTo) {
      const target = resolveUserPath(ctx.cwd, saveTo);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer);
      rendered += `\n[saved ${buffer.byteLength} bytes to ${target}]`;
    }

    const interesting = ["content-type", "location", "etag", "last-modified", "x-ratelimit-remaining"];
    const headerLines = interesting
      .map((name) => [name, response.headers.get(name)] as const)
      .filter(([, value]) => Boolean(value))
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n");

    return [`HTTP ${response.status} ${response.statusText}`, headerLines, "", rendered]
      .filter((part) => part !== "")
      .join("\n");
  },
};

export const httpTools = [httpTool];
export { bool };
