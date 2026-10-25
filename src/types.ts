/**
 * Shared types. Everything here is a `type` or `interface` so that Node's
 * type-stripping can run the sources directly with no build step.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name?: string; content: string };

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolSchema = {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
};

export type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type ModelResponse = {
  content: string;
  toolCalls: ToolCall[];
  usage?: Usage;
  finishReason?: string;
};

export type ModelRequest = {
  messages: ChatMessage[];
  tools: ToolSchema[];
  signal?: AbortSignal;
};

export interface Model {
  readonly name: string;
  /** False when the server rejected native tool calling and we fell back to text. */
  readonly supportsNativeTools: boolean;
  chat(req: ModelRequest): Promise<ModelResponse>;
}

/** How a single tool invocation was judged by the policy engine. */
export type Decision = "allow" | "ask" | "deny";

export type PolicyMode = "ask" | "auto" | "readonly";

export type ToolProtocol = "auto" | "native" | "text";

export type PolicyRule = {
  /** Tool name, or "*" for every tool. */
  tool?: string;
  /** Optional regex tested against the JSON-encoded arguments. */
  match?: string;
  decision: Decision;
  reason?: string;
};

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout_ms?: number;
};

export type Config = {
  model: {
    /** OpenAI-compatible base URL. Default: Ollama. */
    baseUrl: string;
    /** Empty string => auto-detect the first model the server reports. */
    name: string;
    apiKey: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    protocol: ToolProtocol;
  };
  agent: {
    maxSteps: number;
    maxToolOutputChars: number;
    systemPromptExtra: string;
  };
  policy: {
    mode: PolicyMode;
    rules: PolicyRule[];
    /** If true, commands matching the danger list are escalated to "ask" instead of "deny". */
    allowDangerous: boolean;
    /** If true, writing outside the working directory does not require approval. */
    allowOutsideRoots: boolean;
  };
  sandbox: {
    /** "auto" uses bwrap/firejail/sandbox-exec when available. "off" disables. */
    mode: "auto" | "off";
    allowNetwork: boolean;
    /** Mask the real home directory inside the sandbox (blocks ~/.ssh reads). */
    maskHome: boolean;
    /** Fail instead of silently running unsandboxed when no sandbox is available. */
    required: boolean;
  };
  trace: {
    dir: string;
    enabled: boolean;
  };
  memory: {
    enabled: boolean;
    path: string;
  };
  tools: {
    shell: boolean;
    files: boolean;
    http: boolean;
    browser: boolean;
    memory: boolean;
  };
  mcpServers: Record<string, McpServerConfig>;
};

export type AgentEvent =
  | { type: "step"; step: number }
  | { type: "assistant"; text: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | {
      type: "tool_end";
      name: string;
      content: string;
      isError: boolean;
      ms: number;
    }
  | { type: "approval"; name: string; decision: Exclude<Decision, "allow">; reason: string }
  | { type: "notice"; message: string }
  | { type: "done"; text: string; steps: number; ms: number }
  | { type: "usage"; usage: Usage };

export type AgentResult = {
  text: string;
  steps: number;
  ms: number;
  messages: ChatMessage[];
  usage: Usage;
  aborted: boolean;
};
