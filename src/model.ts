import type { ChatMessage, Config, Model, ModelRequest, ModelResponse, ToolCall } from "./types.ts";
import { extractJsonObjects, sleep, uid } from "./util.ts";

export class ModelError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ModelError";
    this.retryable = retryable;
  }
}

type OpenAIToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAIMessage = {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
};

type ChatCompletion = {
  choices?: Array<{ message?: OpenAIMessage; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string };
};

function normalizeToolCalls(raw: OpenAIToolCall[] | undefined): ToolCall[] {
  if (!raw?.length) return [];
  const out: ToolCall[] = [];
  for (const call of raw) {
    const name = call.function?.name?.trim();
    if (!name) continue;
    let args = call.function?.arguments ?? "{}";
    if (typeof args !== "string") args = JSON.stringify(args);
    if (args.trim() === "") args = "{}";
    out.push({
      id: call.id ?? uid("call-"),
      type: "function",
      function: { name, arguments: args },
    });
  }
  return out;
}

/**
 * Local models are inconsistent about tool calling. Some return the OpenAI
 * `tool_calls` field, some inline JSON in the content, some both. Recover the
 * intent from either shape rather than trusting one.
 */
export function recoverInlineToolCalls(content: string): ToolCall[] {
  if (!content.includes("{")) return [];
  const candidates = extractJsonObjects(content);
  const calls: ToolCall[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const obj = candidate as Record<string, unknown>;
    const fn = (obj["function"] ?? obj) as Record<string, unknown>;
    const name = fn["name"] ?? fn["tool"] ?? fn["tool_name"];
    if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) continue;
    const args = fn["arguments"] ?? fn["args"] ?? fn["parameters"] ?? {};
    calls.push({
      id: uid("call-"),
      type: "function",
      function: {
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args),
      },
    });
  }
  return calls;
}

export type ModelInfo = {
  id: string;
  contextLength?: number;
};

export class OpenAIModel implements Model {
  readonly name: string;
  private readonly config: Config;
  private readonly base: string;
  private _supportsNativeTools: boolean;
  private _resolved = false;

  constructor(config: Config) {
    this.config = config;
    this.base = config.model.baseUrl.replace(/\/+$/, "");
    this.name = config.model.name || "(auto)";
    this._supportsNativeTools = config.model.protocol !== "text";
  }

  get supportsNativeTools(): boolean {
    return this._supportsNativeTools;
  }

  get resolvedName(): string {
    return this.name;
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    attempts = 3,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const signal = AbortSignal.any([
        AbortSignal.timeout(this.config.model.timeoutMs),
        ...(init.signal ? [init.signal] : []),
      ]);
      try {
        const response = await fetch(url, { ...init, signal });
        if (response.status >= 500 && attempt < attempts) {
          await sleep(400 * attempt);
          continue;
        }
        return response;
      } catch (err) {
        lastError = err;
        const error = err as Error & { cause?: { code?: string } };
        if (error.name === "AbortError" || error.name === "TimeoutError") {
          throw new ModelError(
            `model server did not respond within ${this.config.model.timeoutMs}ms`,
            false,
          );
        }
        if (attempt < attempts) {
          await sleep(400 * attempt);
          continue;
        }
        const code = error.cause?.code ?? "";
        throw new ModelError(
          `cannot reach model server at ${this.base}${code ? ` (${code})` : ""}. ` +
            `Is it running? Check with: mox doctor`,
          true,
        );
      }
    }
    throw new ModelError(`model request failed: ${(lastError as Error)?.message}`, true);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const key = this.config.model.apiKey;
    if (key) headers["authorization"] = `Bearer ${key}`;
    return headers;
  }

  private endpoint(suffix: string): string {
    return `${this.base}${suffix}`;
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await this.fetchWithRetry(this.endpoint("/models"), {
      method: "GET",
      headers: this.headers(),
    }, 2);
    if (!response.ok) {
      throw new ModelError(`GET /models failed: HTTP ${response.status}`, false);
    }
    const body = (await response.json()) as {
      data?: Array<{ id?: string; context_length?: number; context_window?: number }>;
    };
    return (body.data ?? [])
      .filter((m): m is { id: string } => typeof m.id === "string")
      .map((m) => ({
        id: m.id,
        contextLength:
          (m as { context_length?: number }).context_length ??
          (m as { context_window?: number }).context_window,
      }));
  }

  async resolveModelName(): Promise<string> {
    if (this._resolved) return this.name;
    if (this.config.model.name) {
      this._resolved = true;
      return this.name;
    }
    const models = await this.listModels();
    // Prefer a chat model over embedding models when several are loaded.
    const chat = models.find((m) => !/embed|nomic|bge|e5-|minilm/i.test(m.id)) ?? models[0];
    if (!chat) {
      throw new ModelError(
        `no models found at ${this.base}. Pull one first, e.g. \`ollama pull qwen3:8b\``,
        false,
      );
    }
    (this as { name: string }).name = chat.id;
    this._resolved = true;
    return chat.id;
  }

  async chat(req: ModelRequest): Promise<ModelResponse> {
    const modelName = await this.resolveModelName();
    const useTools =
      this.config.model.protocol === "native" ||
      (this.config.model.protocol === "auto" && this._supportsNativeTools);

    if (useTools) {
      try {
        const response = await this.complete(modelName, req, true);
        return this.withInlineCalls(response);
      } catch (err) {
        if (this.config.model.protocol === "native") throw err;
        // The server does not support tool schemas. Switch permanently for this
        // process; the agent notices and rewrites the system prompt.
        this._supportsNativeTools = false;
      }
    }
    return this.withInlineCalls(await this.complete(modelName, req, false));
  }

  /** Trust native tool_calls, but recover calls a model puts inline in prose. */
  private withInlineCalls(response: ModelResponse): ModelResponse {
    if (response.toolCalls.length > 0) return response;
    const inline = recoverInlineToolCalls(response.content);
    return inline.length > 0 ? { ...response, toolCalls: inline } : response;
  }

  private async complete(
    modelName: string,
    req: ModelRequest,
    withTools: boolean,
  ): Promise<ModelResponse> {
    const body: Record<string, unknown> = {
      model: modelName,
      messages: req.messages,
      temperature: this.config.model.temperature,
      max_tokens: this.config.model.maxTokens,
      stream: false,
    };
    if (withTools && req.tools.length > 0) {
      body["tools"] = req.tools;
      body["tool_choice"] = "auto";
    }

    const response = await this.fetchWithRetry(this.endpoint("/chat/completions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      const lower = text.toLowerCase();
      if (lower.includes("tool") && withTools) {
        this._supportsNativeTools = false;
        throw new ModelError(`server rejected tool calling: HTTP ${response.status} ${text.slice(0, 300)}`, false);
      }
      throw new ModelError(
        `model returned HTTP ${response.status}: ${text.slice(0, 400)}`,
        response.status >= 500,
      );
    }

    let parsed: ChatCompletion;
    try {
      parsed = JSON.parse(text) as ChatCompletion;
    } catch {
      throw new ModelError(`model returned non-JSON: ${text.slice(0, 300)}`, false);
    }
    if (parsed.error) {
      throw new ModelError(`model error: ${parsed.error.message ?? "unknown"}`, false);
    }
    const choice = parsed.choices?.[0];
    if (!choice) throw new ModelError("model returned no choices", false);

    const content = choice.message?.content ?? "";
    return {
      content,
      toolCalls: normalizeToolCalls(choice.message?.tool_calls),
      usage: parsed.usage,
      finishReason: choice.finish_reason,
    };
  }
}

/** Used by tests and `mox replay` to exercise the loop without a model. */
export class ScriptedModel implements Model {
  readonly name = "scripted";
  readonly supportsNativeTools = true;
  private readonly steps: ModelResponse[];
  private index = 0;
  readonly requests: ModelRequest[] = [];

  constructor(steps: ModelResponse[]) {
    this.steps = steps;
  }

  async chat(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(req);
    const step = this.steps[Math.min(this.index, this.steps.length - 1)];
    this.index++;
    return step ?? { content: "done", toolCalls: [] };
  }
}

export function scriptedCall(name: string, args: Record<string, unknown>, text = ""): ModelResponse {
  return {
    content: text,
    toolCalls: [
      { id: uid("call-"), type: "function", function: { name, arguments: JSON.stringify(args) } },
    ],
  };
}

export function scriptedText(text: string): ModelResponse {
  return { content: text, toolCalls: [] };
}

export type { ChatMessage };
