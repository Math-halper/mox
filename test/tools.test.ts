import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG } from "../src/config.ts";
import {
  editFileTool,
  grepTool,
  listDirTool,
  readFileTool,
  writeFileTool,
} from "../src/tools/files.ts";
import { sanitizeEnv } from "../src/tools/shell.ts";
import { isPrivateUrl } from "../src/tools/http.ts";
import type { ToolContext } from "../src/tools/types.ts";

function workspace(): { dir: string; ctx: ToolContext } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mox-test-"));
  const ctx: ToolContext = {
    cwd: dir,
    config: structuredClone(DEFAULT_CONFIG),
    sandbox: { kind: "none", available: false, detail: "test" },
    notice: () => undefined,
  };
  return { dir, ctx };
}

test("write, read, edit round-trip", async () => {
  const { ctx, dir } = workspace();
  const write = await writeFileTool.execute({ path: "src/hello.txt", content: "one\ntwo\nthree\n" }, ctx);
  assert.match(write, /created src\/hello\.txt/);
  assert.ok(fs.existsSync(path.join(dir, "src/hello.txt")));

  const read = await readFileTool.execute({ path: "src/hello.txt" }, ctx);
  assert.match(read, /one/);
  assert.match(read, /\s1 \| one/);

  const edit = await editFileTool.execute({ path: "src/hello.txt", old: "two", new: "TWO" }, ctx);
  assert.match(edit, /1 replacement/);
  assert.equal(fs.readFileSync(path.join(dir, "src/hello.txt"), "utf8"), "one\nTWO\nthree\n");
});

test("edit refuses ambiguous matches", async () => {
  const { ctx } = workspace();
  await writeFileTool.execute({ path: "a.txt", content: "x\nx\n" }, ctx);
  await assert.rejects(
    () => editFileTool.execute({ path: "a.txt", old: "x", new: "y" }, ctx),
    /appears 2 times/,
  );
  const result = await editFileTool.execute({ path: "a.txt", old: "x", new: "y", replace_all: true }, ctx);
  assert.match(result, /2 replacements/);
});

test("edit reports a miss instead of silently doing nothing", async () => {
  const { ctx } = workspace();
  await writeFileTool.execute({ path: "a.txt", content: "abc" }, ctx);
  await assert.rejects(() => editFileTool.execute({ path: "a.txt", old: "zzz", new: "y" }, ctx), /not found/);
});

test("read refuses binary files and missing paths", async () => {
  const { ctx, dir } = workspace();
  fs.writeFileSync(path.join(dir, "bin.dat"), Buffer.from([0, 1, 2, 3, 0, 5]));
  await assert.rejects(() => readFileTool.execute({ path: "bin.dat" }, ctx), /binary/);
  await assert.rejects(() => readFileTool.execute({ path: "nope.txt" }, ctx), /no such file/);
});

test("list_dir skips node_modules and hides noise", async () => {
  const { ctx, dir } = workspace();
  fs.mkdirSync(path.join(dir, "node_modules/pkg"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/a.ts"), "");
  fs.writeFileSync(path.join(dir, "README.md"), "");
  const listing = await listDirTool.execute({ depth: 2 }, ctx);
  assert.match(listing, /src\//);
  assert.match(listing, /src\/a\.ts/);
  assert.ok(!listing.includes("node_modules"));
});

test("grep respects glob and caps results", async () => {
  const { ctx, dir } = workspace();
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/a.ts"), "const TODO = 1;\n");
  fs.writeFileSync(path.join(dir, "src/b.md"), "TODO in docs\n");
  const hits = await grepTool.execute({ pattern: "TODO", glob: "*.ts" }, ctx);
  assert.match(hits, /src\/a\.ts:1/);
  assert.ok(!hits.includes("b.md"));
});

test("grep rejects an invalid regex with a readable error", async () => {
  const { ctx } = workspace();
  await assert.rejects(() => grepTool.execute({ pattern: "([unclosed" }, ctx), /invalid regex/);
});

test("sanitizeEnv strips secrets but keeps PATH", () => {
  const env = sanitizeEnv({
    PATH: "/usr/bin",
    HOME: "/home/user",
    OPENAI_API_KEY: "sk-secret",
    GITHUB_TOKEN: "ghp_secret",
    MY_PASSWORD: "hunter2",
    AWS_SECRET_ACCESS_KEY: "abc",
    NORMAL_VAR: "fine",
  });
  assert.equal(env["PATH"], "/usr/bin");
  assert.equal(env["NORMAL_VAR"], "fine");
  assert.equal(env["OPENAI_API_KEY"], undefined);
  assert.equal(env["GITHUB_TOKEN"], undefined);
  assert.equal(env["MY_PASSWORD"], undefined);
  assert.equal(env["AWS_SECRET_ACCESS_KEY"], undefined);
});

test("isPrivateUrl flags local and RFC1918 targets", () => {
  assert.ok(isPrivateUrl("http://localhost:3000/api"));
  assert.ok(isPrivateUrl("http://127.0.0.1:8080"));
  assert.ok(isPrivateUrl("http://192.168.1.1/admin"));
  assert.ok(isPrivateUrl("http://10.0.0.5"));
  assert.ok(!isPrivateUrl("https://example.com"));
  assert.ok(!isPrivateUrl("https://api.github.com/repos"));
});
