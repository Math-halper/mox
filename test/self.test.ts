import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  appendHistory,
  clearHistory,
  corpusFor,
  initSelf,
  loadHistory,
  loadSelf,
  memoryPath,
  personaBlock,
  summarizeSelf,
} from "../src/self.ts";
import { buildSystemPrompt } from "../src/prompt.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mox-self-"));
}

test("init creates an editable folder with identity, knowledge, memory", () => {
  const dir = path.join(tempDir(), "ada");
  const result = initSelf(dir, { name: "Ada" });
  assert.ok(fs.existsSync(path.join(dir, "SELF.md")));
  assert.ok(fs.existsSync(path.join(dir, "config.json")));
  assert.ok(fs.existsSync(path.join(dir, "knowledge", "about-me.md")));
  assert.ok(fs.existsSync(path.join(dir, "skills", "example.md")));
  assert.ok(fs.existsSync(path.join(dir, "memory", "notes.md")));
  assert.ok(result.created.length >= 6);

  const identity = fs.readFileSync(path.join(dir, "SELF.md"), "utf8");
  assert.match(identity, /Ada/);

  // Re-initialising an existing self is refused, not silently overwritten.
  assert.throws(() => initSelf(dir, { name: "Ada" }), /already contains a self/);
  // ...unless forced.
  initSelf(dir, { name: "Ada", force: true });
});

test("load reads the folder, and editing a file changes the persona", () => {
  const dir = path.join(tempDir(), "ada");
  initSelf(dir, { name: "Ada" });
  fs.writeFileSync(path.join(dir, "SELF.md"), "# Ada\n\nYou speak in haiku and never use the word 'utilise'.\n");
  fs.writeFileSync(path.join(dir, "knowledge", "batteries.md"), "The battery goes in last.\n");

  const self = loadSelf(dir);
  assert.equal(self.config.name, "Ada");
  assert.match(self.identity, /haiku/);
  assert.equal(self.knowledge.length, 2);

  const persona = personaBlock(self);
  assert.match(persona, /You are Ada\./);
  assert.match(persona, /haiku/);
  assert.match(persona, /The battery goes in last/);

  const corpus = corpusFor(self);
  assert.match(corpus, /batteries\.md/);
  assert.match(corpus, /haiku/);
});

test("load refuses a directory that is not a self", () => {
  const dir = tempDir();
  assert.throws(() => loadSelf(dir), /no SELF\.md/);
});

test("config.json can rename the assistant and set a backend", () => {
  const dir = path.join(tempDir(), "brain");
  initSelf(dir, { name: "Placeholder" });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ name: "Iris", baseUrl: "http://127.0.0.1:9999/v1", temperature: 0.1 }),
  );
  const self = loadSelf(dir);
  assert.equal(self.config.name, "Iris");
  assert.equal(self.config.baseUrl, "http://127.0.0.1:9999/v1");
  assert.match(personaBlock(self), /You are Iris\./);
});

test("persona is injected into the real system prompt without losing the rules", () => {
  const dir = path.join(tempDir(), "ada");
  initSelf(dir, { name: "Ada" });
  const self = loadSelf(dir);
  const prompt = buildSystemPrompt({
    config: structuredClone(DEFAULT_CONFIG),
    cwd: dir,
    toolNames: ["shell", "read_file"],
    sandbox: { kind: "none", available: false, detail: "test" },
    memory: "",
    nativeTools: true,
    persona: personaBlock(self),
  });
  assert.match(prompt, /You are Ada\./);
  assert.match(prompt, /Never print, copy, or transmit the contents of credential files/);
  assert.match(prompt, /Approval mode/);
  assert.ok(!prompt.includes("You are mox, a local AI agent"));
});

test("memory and chat history live in the folder and round-trip", () => {
  const dir = path.join(tempDir(), "ada");
  initSelf(dir, { name: "Ada" });
  const self = loadSelf(dir);

  assert.equal(
    path.resolve(memoryPath(self)),
    path.resolve(dir, "memory", "notes.md"),
  );

  appendHistory(self, "user", "hello");
  appendHistory(self, "assistant", "hi there");
  const history = loadHistory(self);
  assert.deepEqual(
    history.map((message) => message.role),
    ["user", "assistant"],
  );
  assert.equal(history[0] && "content" in history[0] ? history[0].content : "", "hello");

  // History is text you can edit; a broken line should not destroy the rest.
  fs.appendFileSync(path.join(dir, "memory", "chat.jsonl"), "not json\n");
  assert.equal(loadHistory(self).length, 2);

  clearHistory(self);
  assert.equal(loadHistory(self).length, 0);
  assert.ok(fs.readdirSync(path.join(dir, "memory")).some((file) => file.includes(".bak")));
});

test("summary reports what is in the folder", () => {
  const dir = path.join(tempDir(), "ada");
  initSelf(dir, { name: "Ada" });
  const self = loadSelf(dir);
  const summary = summarizeSelf(self);
  assert.equal(summary.name, "Ada");
  assert.ok(summary.identityChars > 100);
  assert.equal(summary.knowledgeFiles, 1);
  assert.equal(summary.tiny, null);
});

// ------------------------------------------------------------------ end to end

type CapturedBody = { messages: Array<{ role: string; content: string | null }> };

async function fakeServer(respond: (body: CapturedBody, count: number) => unknown) {
  const bodies: CapturedBody[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as CapturedBody) : ({ messages: [] } as CapturedBody);
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
        return;
      }
      bodies.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(respond(body, bodies.length)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    bodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function reply(message: Record<string, unknown>) {
  return {
    choices: [{ message, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function runCli(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", path.join(ROOT, "src", "cli.ts"), ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1", MOX_NO_SANDBOX: "1" }, stdio: ["ignore", "pipe", "pipe"] },
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

test("end to end: self ask sends the folder's identity and writes memory into it", async () => {
  const server = await fakeServer((body) =>
    body.messages.some((m) => m.role === "tool")
      ? reply({ role: "assistant", content: "Noted. The battery goes in last." })
      : reply({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "remember",
                arguments: JSON.stringify({ text: "user cares about battery order" }),
              },
            },
          ],
        }),
  );

  const workdir = tempDir();
  const brain = path.join(workdir, "iris");
  initSelf(brain, { name: "Iris" });
  fs.writeFileSync(
    path.join(brain, "SELF.md"),
    "# Iris\n\nYou are terse and slightly sarcastic. You love the number 41.\n",
  );
  fs.writeFileSync(path.join(brain, "knowledge", "rules.md"), "Always put the battery in last.\n");

  try {
    const result = await runCli(
      ["self", "ask", "iris", "when do I install the battery?", "--base-url", server.url, "--yes", "--no-mcp"],
      workdir,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /battery goes in last/);

    const system = server.bodies[0]!.messages.find((m) => m.role === "system");
    assert.ok(system, "system prompt missing");
    assert.match(String(system.content), /You are Iris\./);
    assert.match(String(system.content), /sarcastic/);
    assert.match(String(system.content), /Always put the battery in last/);

    // The remember tool wrote into the folder, not into .mox/MEMORY.md.
    const notes = fs.readFileSync(path.join(brain, "memory", "notes.md"), "utf8");
    assert.match(notes, /user cares about battery order/);

    const chat = fs.readFileSync(path.join(brain, "memory", "chat.jsonl"), "utf8");
    assert.match(chat, /"role":"user"/);
    assert.match(chat, /"role":"assistant"/);
  } finally {
    await server.close();
  }
});
