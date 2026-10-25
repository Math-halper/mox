import type {
  AgentEvent,
  AgentResult,
  ChatMessage,
  Config,
  Model,
  ToolCall,
  Usage,
} from "./types.ts";
import type { PolicyRequest } from "./policy.ts";
import type { ToolDef, ToolContext } from "./tools/types.ts";
import { evaluatePolicy } from "./policy.ts";
import type { SandboxStatus } from "./sandbox.ts";
import type { Tracer } from "./trace.ts";
import { truncateEnd, truncateMiddle, uid } from "./util.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { readMemory } from "./tools/memory.ts";

export type ApprovalRequest = {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  reason: string;
};

export type ApprovalHandler = (req: ApprovalRequest) => Promise<boolean>;

export type AgentOptions = {
  config: Config;
  model: Model;
  tools: ToolDef[];
  cwd: string;
  sandbox: SandboxStatus;
  tracer: Tracer;
  approve: ApprovalHandler;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
  /** Pre-loaded conversation (used by chat mode). */
  history?: ChatMessage[];
  /** Override the system prompt (tests). */
  systemPrompt?: string;
};

export type RunOptions = {
  /** Reuse the conversation from a previous run (chat mode). */
  history?: ChatMessage[];
};

function emptyUsage(): Usage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function addUsage(total: Usage, next: Usage | undefined): void {
  if (!next) return;
  total.prompt_tokens = (total.prompt_tokens ?? 0) + (next.prompt_tokens ?? 0);
  total.completion_tokens = (total.completion_tokens ?? 0) + (next.completion_tokens ?? 0);
  total.total_tokens = (total.total_tokens ?? 0) + (next.total_tokens ?? 0);
}

/**
 * Local models mangle JSON in predictable ways. Try hard, then give the model a
 * readable error instead of crashing the run.
 */
export function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.trim() === "") return {};
  const attempts: string[] = [raw.trim()];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) attempts.push(fenced[1].trim());
  attempts.push(
    raw
      .trim()
      .replace(/^[^{]*/, "")
      .replace(/[^}]*$/, ""),
  );
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      const parsed: unknown = JSON.parse(attempt);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* next attempt */
    }
    // Single quotes and trailing commas are the two most common breakages.
    try {
      const repaired = attempt
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner: string) =>
          JSON.stringify(inner.replace(/\\'/g, "'")),
        );
      const parsed: unknown = JSON.parse(repaired);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* give up on this attempt */
    }
  }
  throw new Error(`arguments were not valid JSON: ${truncateEnd(raw, 200)}`);
}

export class Agent {
  private readonly opts: AgentOptions;
  private readonly emit: (event: AgentEvent) => void;

  constructor(opts: AgentOptions) {
    this.opts = opts;
    this.emit = (event) => {
      this.opts.tracer.write(event as unknown as Record<string, unknown> & { type: string });
      this.opts.onEvent?.(event);
    };
  }

  private toolContext(): ToolContext {
    return {
      cwd: this.opts.cwd,
      config: this.opts.config,
      sandbox: this.opts.sandbox,
      signal: this.opts.signal,
      notice: (message) => this.emit({ type: "notice", message }),
    };
  }

  private async runOne(call: ToolCall): Promise<{ content: string; isError: boolean; ms: number }> {
    const started = Date.now();
    const tool = this.opts.tools.find((t) => t.name === call.function.name);
    if (!tool) {
      const known = this.opts.tools.map((t) => t.name).join(", ");
      return {
        content: `Error: unknown tool "${call.function.name}". Available tools: ${known}`,
        isError: true,
        ms: Date.now() - started,
      };
    }

    let args: Record<string, unknown>;
    try {
      args = parseToolArgs(call.function.arguments);
    } catch (err) {
      return {
        content: `Error: ${(err as Error).message}. Send valid JSON in "arguments".`,
        isError: true,
        ms: Date.now() - started,
      };
    }

    this.emit({ type: "tool_start", name: tool.name, args });

    const policyRequest: PolicyRequest = {
      name: tool.name,
      args,
      readOnly: tool.readOnly,
    };
    let verdict = evaluatePolicy(this.opts.config, policyRequest, this.opts.cwd);
    const escalation = tool.escalate?.(args);
    if (escalation && verdict.decision === "allow") {
      verdict = { decision: "ask", reason: escalation };
    }

    if (verdict.decision === "deny") {
      this.emit({ type: "approval", name: tool.name, decision: "deny", reason: verdict.reason });
      const content = `Error: blocked by policy — ${verdict.reason}. Do not retry this; choose another approach or ask the user.`;
      this.emit({ type: "tool_end", name: tool.name, content, isError: true, ms: Date.now() - started });
      return { content, isError: true, ms: Date.now() - started };
    }

    if (verdict.decision === "ask") {
      this.emit({ type: "approval", name: tool.name, decision: "ask", reason: verdict.reason });
      const approved = await this.opts.approve({
        tool: tool.name,
        args,
        summary: tool.summarize?.(args) ?? "",
        reason: verdict.reason,
      });
      if (!approved) {
        const content = `Error: the user declined this call (${verdict.reason}). Do not retry it; propose an alternative or explain what you need.`;
        this.emit({ type: "tool_end", name: tool.name, content, isError: true, ms: Date.now() - started });
        return { content, isError: true, ms: Date.now() - started };
      }
    }

    let content: string;
    let isError = false;
    try {
      content = await tool.execute(args, this.toolContext());
    } catch (err) {
      content = `Error: ${(err as Error).message}`;
      isError = true;
    }
    const ms = Date.now() - started;
    const capped = isError
      ? truncateMiddle(content, this.opts.config.agent.maxToolOutputChars)
      : truncateMiddle(content, this.opts.config.agent.maxToolOutputChars);
    this.emit({ type: "tool_end", name: tool.name, content: capped, isError, ms });
    return { content: capped, isError, ms };
  }

  private async guardedRun(call: ToolCall): Promise<{ content: string; isError: boolean; ms: number }> {
    const key = `${call.function.name}:${call.function.arguments}`;
    const count = (this.repeatCount.get(key) ?? 0) + 1;
    this.repeatCount.set(key, count);
    if (count === 3) {
      this.emit({
        type: "notice",
        message: `the model has called ${call.function.name} with identical arguments ${count} times; nudging it to change approach`,
      });
    }
    if (count > 3) {
      return {
        content:
          "Error: you have already run this exact call three times. Do not repeat it. Read the earlier result, change the command or arguments, or explain what blocks you.",
        isError: true,
        ms: 0,
      };
    }
    return await this.runOne(call);
  }

  private repeatCount = new Map<string, number>();

  async run(task: string, runOpts: RunOptions = {}): Promise<AgentResult> {
    const { config, model, cwd, tracer, tools } = this.opts;
    const started = Date.now();
    const usage = emptyUsage();
    const memory = config.memory.enabled ? readMemory(cwd, config) : "";

    const systemPrompt =
      this.opts.systemPrompt ??
      buildSystemPrompt({
        config,
        cwd,
        toolNames: tools.map((t) => t.name),
        sandbox: this.opts.sandbox,
        memory,
        nativeTools: model.supportsNativeTools,
      });

    const history = runOpts.history ?? this.opts.history;
    const messages: ChatMessage[] = history?.length
      ? [...history]
      : [
          { role: "system", content: systemPrompt },
          { role: "user", content: task },
        ];
    if (history?.length) messages.push({ role: "user", content: task });

    if (history?.length) {
      const first = messages[0];
      if (first?.role === "system") messages[0] = { role: "system", content: systemPrompt };
    }

    tracer.write({ type: "task", task, model: model.name });
    const schemas = tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    let finalText = "";
    let step = 0;
    let aborted = false;
    let lastAssistantText = "";
    let exhausted = false;
    let nativeFlag = model.supportsNativeTools;

    while (step < config.agent.maxSteps) {
      step++;
      if (this.opts.signal?.aborted) {
        aborted = true;
        break;
      }
      this.emit({ type: "step", step });

      // If the model server rejected native tool calls, the system prompt must
      // switch to the text protocol so the model knows how to act.
      if (model.supportsNativeTools !== nativeFlag && messages[0]?.role === "system") {
        nativeFlag = model.supportsNativeTools;
        messages[0] = {
          role: "system",
          content: buildSystemPrompt({
            config,
            cwd,
            toolNames: tools.map((t) => t.name),
            sandbox: this.opts.sandbox,
            memory,
            nativeTools: nativeFlag,
          }),
        };
        this.emit({
          type: "notice",
          message: "model server does not support native tool calls — switched to the text protocol",
        });
      }

      let response;
      try {
        response = await model.chat({ messages, tools: schemas, signal: this.opts.signal });
      } catch (err) {
        const message = (err as Error).message;
        if ((err as Error).name === "AbortError" || this.opts.signal?.aborted) {
          aborted = true;
          break;
        }
        this.emit({ type: "notice", message: `model error: ${message}` });
        finalText = lastAssistantText
          ? `${lastAssistantText}\n\n(stopped: ${message})`
          : `(stopped: ${message})`;
        break;
      }

      addUsage(usage, response.usage);
      if (response.usage) this.emit({ type: "usage", usage: response.usage });
      if (response.content.trim()) {
        lastAssistantText = response.content.trim();
        this.emit({ type: "assistant", text: response.content.trim() });
      }

      if (response.toolCalls.length === 0) {
        finalText = response.content.trim() || lastAssistantText;
        messages.push({ role: "assistant", content: finalText });
        break;
      }

      messages.push({
        role: "assistant",
        content: response.content || null,
        tool_calls: response.toolCalls.map((call) => ({
          ...call,
          id: call.id || uid("call-"),
        })),
      });

      for (const call of response.toolCalls) {
        if (this.opts.signal?.aborted) {
          aborted = true;
          break;
        }
        const result = await this.guardedRun(call);
        if (aborted) break;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: result.content,
        });
      }
      if (aborted) break;

    }

    // Out of steps without an answer: ask once, without tools, for a wrap-up.
    if (!finalText && !aborted && lastAssistantText === "" && step >= config.agent.maxSteps) {
      exhausted = true;
      try {
        const wrapUp = await model.chat({
          messages: [
            ...messages,
            {
              role: "user",
              content:
                "Step limit reached. Do not call more tools. Summarize what you found and what remains, in a few lines.",
            },
          ],
          tools: [],
          signal: this.opts.signal,
        });
        addUsage(usage, wrapUp.usage);
        if (wrapUp.content.trim()) {
          lastAssistantText = wrapUp.content.trim();
          this.emit({ type: "assistant", text: wrapUp.content.trim() });
        }
      } catch {
        /* the summary is best-effort */
      }
    } else if (!finalText && !aborted && step >= config.agent.maxSteps) {
      exhausted = true;
    }

    if (!finalText) {
      finalText = lastAssistantText
        ? `${lastAssistantText}\n\n(step limit of ${config.agent.maxSteps} reached)`
        : aborted
          ? "(interrupted)"
          : exhausted
            ? `(step limit of ${config.agent.maxSteps} reached)`
            : `(no answer after ${config.agent.maxSteps} steps)`;
    }

    const result: AgentResult = {
      text: finalText,
      steps: step,
      ms: Date.now() - started,
      messages,
      usage,
      aborted,
    };
    tracer.write({
      type: "final",
      text: finalText,
      steps: result.steps,
      ms: result.ms,
      usage,
      aborted,
    });
    this.emit({ type: "done", text: finalText, steps: result.steps, ms: result.ms });
    return result;
  }
}
