import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, "src", "cli.ts");

type CapturedRequest = {
  path: string;
  body: Record<string, unknown>;
};

/**
 * A stand-in for Ollama/LM Studio: speaks just enough of the OpenAI
 * /chat/completions schema to prove the loop, tool execution, policy and
 * tracing work end to end.
 */
async function startFakeModel(
  respond: (body: Record<string, unknown>, history: CapturedRequest[]) => unknown,
): Promise<{ url: string; requests: CapturedRequest[]; close: () => Promise<void> }> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
        return;
      }
      const captured = { path: req.url ?? "", body };
      requests.push(captured);
      const payload = respond(body, requests);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function completion(message: Record<string, unknown>) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    choices: [{ index: 0, message, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function hasToolResult(body: Record<string, unknown>): boolean {
  const messages = (body["messages"] ?? []) as Array<{ role?: string }>;
  return messages.some((m) => m.role === "tool");
}

type CliResult = { code: number | null; stdout: string; stderr: string };

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", CLI, ...args],
      {
        cwd,
        env: { ...process.env, NO_COLOR: "1", ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("end to end: model asks for a shell command, gets the result, answers", async () => {
  const model = await startFakeModel((body) =>
    hasToolResult(body)
      ? completion({ role: "assistant", content: "The file says: hello from mox" })
      : completion({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "shell", arguments: '{"command": "cat greeting.txt"}' },
            },
          ],
        }),
  );

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mox-e2e-"));
  fs.writeFileSync(path.join(cwd, "greeting.txt"), "hello from mox\n");

  try {
    const result = await runCli(
      ["what does greeting.txt say?", "--base-url", model.url, "--yes", "--no-mcp"],
      cwd,
      { MOX_NO_SANDBOX: "1" },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /hello from mox/);
    assert.match(result.stderr, /cat greeting\.txt/);

    // The tool output really was sent back to the model.
    const followUp = model.requests.at(-1)!;
    const messages = followUp.body["messages"] as Array<{ role: string; content: string }>;
    const toolMessage = messages.find((m) => m.role === "tool");
    assert.ok(toolMessage);
    assert.match(toolMessage.content, /hello from mox/);

    // And the run was recorded.
    const runsDir = path.join(cwd, ".mox", "runs");
    const files = fs.readdirSync(runsDir);
    assert.equal(files.length, 1);
    const trace = fs.readFileSync(path.join(runsDir, files[0]!), "utf8");
    assert.match(trace, /"type":"tool_end"/);
    assert.match(trace, /"type":"final"/);
  } finally {
    await model.close();
  }
});

test("end to end: policy blocks a destructive command before it runs", async () => {
  const model = await startFakeModel((body) =>
    hasToolResult(body)
      ? completion({ role: "assistant", content: "I could not run that." })
      : completion({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "shell", arguments: '{"command": "rm -rf /"}' },
            },
          ],
        }),
  );
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mox-e2e-block-"));
  try {
    const result = await runCli(
      ["delete everything", "--base-url", model.url, "--yes", "--no-mcp"],
      cwd,
      { MOX_NO_SANDBOX: "1" },
    );
    assert.equal(result.code, 0, result.stderr);
    const messages = model.requests.at(-1)!.body["messages"] as Array<{ role: string; content: string }>;
    const toolMessage = messages.find((m) => m.role === "tool");
    assert.match(String(toolMessage?.content), /blocked by policy/);
  } finally {
    await model.close();
  }
});

test("end to end: without --yes and without a terminal, mutating calls are denied", async () => {
  const model = await startFakeModel((body) =>
    hasToolResult(body)
      ? completion({ role: "assistant", content: "denied, as expected" })
      : completion({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "write_file", arguments: '{"path": "out.txt", "content": "x"}' },
            },
          ],
        }),
  );
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mox-e2e-deny-"));
  try {
    const result = await runCli(["write out.txt", "--base-url", model.url, "--no-mcp"], cwd, {
      MOX_NO_SANDBOX: "1",
    });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(cwd, "out.txt")), "file must not be created without approval");
    assert.match(result.stderr, /stdin is not a terminal/);
  } finally {
    await model.close();
  }
});

test("end to end: a model that cannot do native tool calls falls back to the text protocol", async () => {
  let sawToolsField = false;
  const model = await startFakeModel((body) => {
    if (Array.isArray(body["tools"]) && (body["tools"] as unknown[]).length > 0) {
      sawToolsField = true;
      // Simulate a server that rejects tool schemas.
      return { error: { message: "this model does not support tools" } };
    }
    const messages = (body["messages"] ?? []) as Array<{ role: string; content: string }>;
    const alreadyUsed = messages.some((m) => m.role === "tool");
    if (!alreadyUsed) {
      return completion({
        role: "assistant",
        content:
          'I will check the directory.\n<tool_call>\n{"name": "shell", "arguments": {"command": "echo TEXT_PROTOCOL_OK"}}\n</tool_call>',
      });
    }
    return completion({ role: "assistant", content: "done via text protocol" });
  });

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mox-e2e-text-"));
  try {
    const result = await runCli(
      ["check", "--base-url", model.url, "--yes", "--no-mcp", "--json"],
      cwd,
      { MOX_NO_SANDBOX: "1" },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.ok(sawToolsField, "the first attempt should offer native tools");
    assert.match(result.stdout, /TEXT_PROTOCOL_OK|tool_start/);
    assert.match(result.stdout, /done via text protocol/);
  } finally {
    await model.close();
  }
});

test("end to end: doctor reports a working model server", async () => {
  const model = await startFakeModel(() => completion({ role: "assistant", content: "hi" }));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mox-e2e-doctor-"));
  try {
    const result = await runCli(["doctor", "--base-url", model.url], cwd, { MOX_NO_SANDBOX: "1" });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /model server/);
    assert.match(result.stdout, /fake-model/);
  } finally {
    await model.close();
  }
});
