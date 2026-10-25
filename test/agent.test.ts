import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { Agent } from "../src/agent.ts";
import { ScriptedModel, scriptedCall, scriptedText } from "../src/model.ts";
import { Tracer } from "../src/trace.ts";
import type { AgentEvent, Config } from "../src/types.ts";
import type { ToolDef } from "../src/tools/types.ts";
import { ToolError } from "../src/tools/types.ts";

function setup(opts: {
  steps: ConstructorParameters<typeof ScriptedModel>[0];
  config?: (c: Config) => void;
  tools?: ToolDef[];
  approve?: boolean;
}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mox-agent-"));
  const config = structuredClone(DEFAULT_CONFIG);
  config.trace.enabled = false;
  config.memory.enabled = false;
  config.policy.mode = "ask";
  opts.config?.(config);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const echo: ToolDef = {
    name: "echo",
    description: "echo text",
    readOnly: true,
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    async execute(args) {
      return `echo:${String(args["text"])}`;
    },
  };
  const touch: ToolDef = {
    name: "touch_file",
    description: "pretend to write",
    readOnly: false,
    parameters: { type: "object", properties: { path: { type: "string" } } },
    async execute(args) {
      calls.push({ name: "touch_file", args });
      return `wrote ${String(args["path"])}`;
    },
  };
  const failing: ToolDef = {
    name: "explode",
    description: "always throws",
    readOnly: true,
    parameters: { type: "object", properties: {} },
    async execute() {
      throw new ToolError("kaboom");
    },
  };
  const tools = opts.tools ?? [echo, touch, failing];
  const model = new ScriptedModel(opts.steps);
  const events: AgentEvent[] = [];
  const approvals: string[] = [];
  const agent = new Agent({
    config,
    model,
    tools,
    cwd,
    sandbox: { kind: "none", available: false, detail: "test" },
    tracer: new Tracer(path.join(cwd, ".mox/runs"), false, cwd),
    approve: async (req) => {
      approvals.push(req.tool);
      return opts.approve ?? true;
    },
    onEvent: (event) => events.push(event),
    systemPrompt: "test system prompt",
  });
  return { agent, cwd, model, events, approvals, calls };
}

test("runs a tool, feeds the result back, then answers", async () => {
  const { agent, model } = setup({
    steps: [scriptedCall("echo", { text: "hi" }), scriptedText("all done")],
  });
  const result = await agent.run("say hi");
  assert.equal(result.text, "all done");
  assert.equal(result.steps, 2);

  const second = model.requests[1]!;
  const toolMessage = second.messages.find((m) => m.role === "tool");
  assert.ok(toolMessage);
  assert.equal(toolMessage.role === "tool" && toolMessage.content, "echo:hi");
  const assistant = second.messages.find((m) => m.role === "assistant");
  assert.ok(assistant && assistant.role === "assistant" && assistant.tool_calls?.length === 1);
});

test("mutating tools ask for approval in ask mode", async () => {
  const { agent, approvals } = setup({
    steps: [scriptedCall("touch_file", { path: "a.txt" }), scriptedText("ok")],
  });
  await agent.run("write");
  assert.deepEqual(approvals, ["touch_file"]);
});

test("a denied approval is reported to the model, not hidden", async () => {
  const { agent, model, calls } = setup({
    steps: [scriptedCall("touch_file", { path: "a.txt" }), scriptedText("understood")],
    approve: false,
  });
  const result = await agent.run("write");
  assert.equal(result.text, "understood");
  assert.equal(calls.length, 0);
  const toolMessage = model.requests[1]!.messages.find((m) => m.role === "tool");
  assert.match(String(toolMessage && "content" in toolMessage ? toolMessage.content : ""), /declined/);
});

test("unknown tools come back as an error the model can recover from", async () => {
  const { agent, model } = setup({
    steps: [scriptedCall("does_not_exist", {}), scriptedText("sorry")],
  });
  const result = await agent.run("x");
  assert.equal(result.text, "sorry");
  const toolMessage = model.requests[1]!.messages.find((m) => m.role === "tool");
  const content = String(toolMessage && "content" in toolMessage ? toolMessage.content : "");
  assert.match(content, /unknown tool/i);
  assert.match(content, /echo/);
});

test("malformed JSON arguments become an error instead of a crash", async () => {
  const { agent, model } = setup({
    steps: [
      { content: "", toolCalls: [{ id: "1", type: "function", function: { name: "echo", arguments: "{oops" } }] },
      scriptedText("fixed"),
    ],
  });
  const result = await agent.run("x");
  assert.equal(result.text, "fixed");
  const toolMessage = model.requests[1]!.messages.find((m) => m.role === "tool");
  assert.match(String(toolMessage && "content" in toolMessage ? toolMessage.content : ""), /valid JSON/);
});

test("tool exceptions are caught and surfaced", async () => {
  const { agent, events } = setup({ steps: [scriptedCall("explode", {}), scriptedText("that broke")] });
  const result = await agent.run("x");
  assert.equal(result.text, "that broke");
  const ended = events.find((e) => e.type === "tool_end");
  assert.ok(ended && ended.type === "tool_end" && ended.isError);
});

test("repeating the exact same call is cut off", async () => {
  const steps = Array.from({ length: 6 }, () => scriptedCall("echo", { text: "same" }));
  const { agent, events } = setup({ steps: [...steps, scriptedText("giving up")] });
  const result = await agent.run("loop");
  assert.equal(result.text, "giving up");
  const toolEnds = events.filter((e) => e.type === "tool_end");
  // 3 real calls run, the rest are blocked with an explanatory error.
  assert.ok(toolEnds.length < 6, `expected the loop guard to fire, got ${toolEnds.length}`);
  const notices = events.filter((e) => e.type === "notice");
  assert.ok(notices.length >= 1);
});

test("the step limit stops runaway runs and asks for a summary", async () => {
  const steps = Array.from({ length: 50 }, () => scriptedCall("echo", { text: "again" }));
  const { agent, model } = setup({
    steps,
    config: (c) => {
      c.agent.maxSteps = 3;
    },
  });
  const result = await agent.run("loop forever");
  assert.equal(result.steps, 3);
  assert.match(result.text, /step limit/);
  const last = model.requests.at(-1)!;
  assert.match(String(last.messages.at(-1)?.content), /Step limit reached/);
});

test("destructive commands never reach the approver", async () => {
  const { agent, events, approvals } = setup({
    steps: [scriptedCall("shell", { command: "rm -rf /" }), scriptedText("blocked")],
    tools: [
      {
        name: "shell",
        description: "shell",
        readOnly: false,
        parameters: { type: "object", properties: { command: { type: "string" } } },
        async execute() {
          throw new Error("should not run");
        },
      },
    ],
  });
  await agent.run("delete everything");
  assert.deepEqual(approvals, []);
  const denial = events.find((e) => e.type === "approval");
  assert.ok(denial && denial.type === "approval" && denial.decision === "deny");
});
