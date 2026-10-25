import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { Agent } from "../src/agent.ts";
import { ScriptedModel, scriptedCall, scriptedText } from "../src/model.ts";
import { Tracer } from "../src/trace.ts";
import { startAppServer, resolveAppTarget } from "../src/app/server.ts";
import { initSelf, loadSelf, personaBlock } from "../src/self.ts";
import type { ToolDef } from "../src/tools/types.ts";

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mox-app-"));
}

type Harness = Awaited<ReturnType<typeof boot>>;

async function boot(opts: {
  steps: ConstructorParameters<typeof ScriptedModel>[0];
  selfDir?: string;
}) {
  const cwd = workspace();
  const config = structuredClone(DEFAULT_CONFIG);
  config.trace.enabled = false;
  config.policy.mode = "ask";
  config.memory.enabled = false;

  const ran: string[] = [];
  const echo: ToolDef = {
    name: "echo",
    description: "read-only",
    readOnly: true,
    parameters: { type: "object", properties: { text: { type: "string" } } },
    async execute(args) {
      return `echo:${String(args["text"])}`;
    },
  };
  const touch: ToolDef = {
    name: "touch_file",
    description: "mutating",
    readOnly: false,
    parameters: { type: "object", properties: { path: { type: "string" } } },
    async execute(args) {
      ran.push(String(args["path"]));
      return `wrote ${String(args["path"])}`;
    },
  };

  const prompts: string[] = [];
  const server = await startAppServer({
    config,
    cwd,
    self: opts.selfDir ? loadSelf(opts.selfDir) : null,
    port: 0,
    makeAgent: async ({ approve, onEvent }) => {
      // Mirrors cmdApp: the folder is re-read for every message.
      const live = opts.selfDir ? loadSelf(opts.selfDir) : null;
      const persona = live ? personaBlock(live) : "test";
      prompts.push(persona);
      const agent = new Agent({
        config,
        model: new ScriptedModel(opts.steps),
        tools: [echo, touch],
        cwd,
        sandbox: { kind: "none", available: false, detail: "test" },
        tracer: new Tracer(path.join(cwd, ".mox/runs"), false, cwd),
        approve,
        onEvent,
        systemPrompt: persona,
      });
      return { agent, close: async () => undefined };
    },
  });
  return { server, ran, cwd, prompts, token: server.token, url: server.url };
}

function apiUrl(harness: Harness, route: string): string {
  return `http://127.0.0.1:${harness.server.port}${route}`;
}

type EventLog = {
  events: Array<Record<string, unknown>>;
  stop: () => Promise<void>;
};

/**
 * One long-lived SSE connection, like a browser tab. Events are collected in an
 * array that the test can poll; opening a second connection mid-run would miss
 * anything already broadcast.
 */
function startReader(harness: Harness): EventLog {
  const events: Array<Record<string, unknown>> = [];
  const controller = new AbortController();
  const run = (async () => {
    const response = await fetch(apiUrl(harness, `/api/events?token=${harness.token}`), {
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          const chunk = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 2);
          if (chunk.startsWith("data: ")) {
            try {
              events.push(JSON.parse(chunk.slice(6)) as Record<string, unknown>);
            } catch {
              /* ignore keep-alives */
            }
          }
          index = buffer.indexOf("\n\n");
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return {
    events,
    stop: async () => {
      controller.abort();
      await run.catch(() => undefined);
    },
  };
}

async function waitFor(
  log: EventLog,
  type: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = log.events.find((event) => event["type"] === type);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${type}; saw ${JSON.stringify(log.events.map((e) => e["type"]))}`);
}

function post(harness: Harness, route: string, body: unknown, token = harness.token) {
  return fetch(apiUrl(harness, `${route}?token=${token}`), {
    method: "POST",
    headers: { "content-type": "application/json", "x-mox-token": token },
    body: JSON.stringify(body),
  });
}

test("the server rejects requests without the token", async () => {
  const harness = await boot({ steps: [scriptedText("hi")] });
  try {
    const state = await fetch(apiUrl(harness, "/api/state"));
    assert.equal(state.status, 403);

    const wrong = await fetch(apiUrl(harness, "/api/state?token=deadbeef"));
    assert.equal(wrong.status, 403);

    const good = await fetch(apiUrl(harness, "/api/state?token=" + harness.token));
    assert.equal(good.status, 200);
    const body = (await good.json()) as Record<string, unknown>;
    assert.equal(body["policyMode"], "ask");
    assert.equal(body["hasSelf"], false);
  } finally {
    await harness.server.close();
  }
});

test("the server refuses requests whose Host header is not loopback (DNS rebinding)", async () => {
  const harness = await boot({ steps: [scriptedText("hi")] });
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: harness.server.port,
          path: `/api/state?token=${harness.token}`,
          method: "GET",
          headers: { host: "evil.example.com" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);

    // ...and the same request with a loopback Host is fine.
    const ok = await fetch(apiUrl(harness, "/api/state?token=" + harness.token));
    assert.equal(ok.status, 200);
  } finally {
    await harness.server.close();
  }
});

test("the page is served with the token injected and a strict CSP", async () => {
  const harness = await boot({ steps: [scriptedText("hi")] });
  try {
    const response = await fetch(apiUrl(harness, "/"));
    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'none'/);
    const html = await response.text();
    assert.ok(html.includes(harness.token), "token should be embedded for the page");
    assert.match(html, /mox/);
  } finally {
    await harness.server.close();
  }
});

test("a message produces a streamed answer", async () => {
  const harness = await boot({ steps: [scriptedCall("echo", { text: "hi" }), scriptedText("all done")] });
  const log = startReader(harness);
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const accepted = await post(harness, "/api/message", { text: "say hi" });
    assert.equal(accepted.status, 202);

    const answer = await waitFor(log, "answer");
    assert.equal(answer["text"], "all done");
    const types = log.events.map((event) => event["type"]);
    assert.ok(types.includes("user"));
    assert.ok(types.includes("tool_start"));
    assert.ok(types.includes("tool_end"));
  } finally {
    await log.stop();
    await harness.server.close();
  }
});

test("a mutating tool waits for approval, and approving runs it", async () => {
  const harness = await boot({
    steps: [scriptedCall("touch_file", { path: "a.txt" }), scriptedText("done")],
  });
  const log = startReader(harness);
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await post(harness, "/api/message", { text: "write" });

    const prompt = await waitFor(log, "approval_request");
    assert.deepEqual(harness.ran, [], "the tool must not run before approval");
    assert.equal(prompt["tool"], "touch_file");

    const approved = await post(harness, "/api/approve", { id: prompt["id"], allow: true });
    assert.equal(approved.status, 200);
    await waitFor(log, "answer");
    assert.deepEqual(harness.ran, ["a.txt"]);
  } finally {
    await log.stop();
    await harness.server.close();
  }
});

test("denying an approval blocks the tool and the agent is told", async () => {
  const harness = await boot({
    steps: [scriptedCall("touch_file", { path: "b.txt" }), scriptedText("understood")],
  });
  const log = startReader(harness);
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await post(harness, "/api/message", { text: "write" });
    const prompt = await waitFor(log, "approval_request");
    await post(harness, "/api/approve", { id: prompt["id"], allow: false });
    const answer = await waitFor(log, "answer");
    assert.deepEqual(harness.ran, [], "a denied tool must never run");
    assert.equal(answer["text"], "understood");
  } finally {
    await log.stop();
    await harness.server.close();
  }
});

test("a second message while a run is in flight is rejected", async () => {
  const harness = await boot({
    steps: [scriptedCall("touch_file", { path: "slow.txt" }), scriptedText("one")],
  });
  const log = startReader(harness);
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await post(harness, "/api/message", { text: "first" });
    await waitFor(log, "approval_request"); // the run is now parked, definitely busy
    const second = await post(harness, "/api/message", { text: "second" });
    assert.equal(second.status, 409);
    const prompt = log.events.find((event) => event["type"] === "approval_request")!;
    await post(harness, "/api/approve", { id: prompt["id"], allow: false });
    await waitFor(log, "answer");
  } finally {
    await log.stop();
    await harness.server.close();
  }
});

test("resolveAppTarget honours an explicit folder (what the menu entry passes)", () => {
  const cwd = workspace();
  const brain = path.join(cwd, "ada");
  initSelf(brain, { name: "Ada" });

  assert.equal(resolveAppTarget(cwd, "./ada"), brain);
  assert.equal(resolveAppTarget(cwd, brain), brain);
  // With no argument it finds ./brain or the cwd.
  assert.equal(resolveAppTarget(brain), brain);
  // A folder that is not a self must not be treated as one.
  const empty = workspace();
  assert.equal(resolveAppTarget(empty, empty), null);
});

test("editing SELF.md takes effect on the next message, without a restart", async () => {
  const cwd = workspace();
  const brain = path.join(cwd, "ada");
  initSelf(brain, { name: "Ada" });
  fs.writeFileSync(path.join(brain, "SELF.md"), "# Ada\n\nYou speak in haiku.\n");

  const harness = await boot({ steps: [scriptedText("ok")], selfDir: brain });
  const log = startReader(harness);
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await post(harness, "/api/message", { text: "one" });
    await waitFor(log, "answer");

    fs.writeFileSync(path.join(brain, "SELF.md"), "# Ada\n\nYou only answer in riddles.\n");
    await post(harness, "/api/message", { text: "two" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(harness.prompts.length, 2);
    assert.match(harness.prompts[0]!, /haiku/);
    assert.match(harness.prompts[1]!, /riddles/);
    assert.ok(!harness.prompts[1]!.includes("haiku"), "the old identity must be gone");
  } finally {
    await log.stop();
    await harness.server.close();
  }
});

test("an unknown approval id is reported, not silently accepted", async () => {
  const harness = await boot({ steps: [scriptedText("x")] });
  try {
    const response = await post(harness, "/api/approve", { id: "nope", allow: true });
    assert.equal(response.status, 404);
  } finally {
    await harness.server.close();
  }
});
