import test from "node:test";
import assert from "node:assert/strict";

import {
  extractJsonObjects,
  globToRegExp,
  htmlToText,
  isInside,
  stripAnsi,
  truncateEnd,
  truncateMiddle,
} from "../src/util.ts";
import { parseToolArgs } from "../src/agent.ts";

test("truncateMiddle keeps both ends and reports the loss", () => {
  const input = "start" + "x".repeat(5000) + "end";
  const out = truncateMiddle(input, 200);
  assert.ok(out.length <= 200);
  assert.ok(out.startsWith("start"));
  assert.ok(out.endsWith("end"));
  assert.match(out, /truncated/);
  assert.equal(truncateMiddle("short", 200), "short");
});

test("truncateEnd never exceeds the budget", () => {
  const out = truncateEnd("y".repeat(1000), 50);
  assert.ok(out.length <= 50);
  assert.match(out, /truncated/);
});

test("htmlToText drops scripts, keeps structure", () => {
  const html = `<html><head><style>p{color:red}</style></head>
  <body><h1>Title</h1><p>Hello &amp; welcome.</p>
  <script>alert("nope")</script><ul><li>one</li><li>two</li></ul></body></html>`;
  const text = htmlToText(html);
  assert.match(text, /Title/);
  assert.match(text, /Hello & welcome\./);
  assert.ok(!text.includes("alert"));
  assert.ok(!text.includes("color:red"));
  assert.match(text, /• one/);
});

test("extractJsonObjects finds balanced objects inside prose", () => {
  const text = `sure! here you go:
<tool_call>
{"name": "shell", "arguments": {"command": "echo \\"hi\\""}}
</tool_call>
and {"nested": {"a": "}"}} trailing`;
  const objects = extractJsonObjects(text) as Array<Record<string, unknown>>;
  assert.equal(objects.length, 2);
  assert.equal(objects[0]!["name"], "shell");
});

test("globToRegExp handles ** and *", () => {
  assert.ok(globToRegExp("src/**/*.ts").test("src/a/b/c.ts"));
  assert.ok(globToRegExp("*.md").test("README.md"));
  assert.ok(!globToRegExp("*.md").test("docs/README.md"));
  assert.ok(globToRegExp("**/test_*.py").test("pkg/tests/test_a.py"));
});

test("isInside rejects traversal", () => {
  assert.ok(isInside("/home/user/project", "/home/user/project/src/a.ts"));
  assert.ok(!isInside("/home/user/project", "/home/user/project-evil/a.ts"));
  assert.ok(!isInside("/home/user/project", "/etc/passwd"));
});

test("stripAnsi removes color codes", () => {
  assert.equal(stripAnsi("\u001b[31mred\u001b[0m"), "red");
});

test("parseToolArgs survives the ways local models break JSON", () => {
  assert.deepEqual(parseToolArgs('{"path": "a.ts"}'), { path: "a.ts" });
  assert.deepEqual(parseToolArgs("```json\n{\"path\": \"a.ts\"}\n```"), { path: "a.ts" });
  assert.deepEqual(parseToolArgs("{'path': 'a.ts',}"), { path: "a.ts" });
  assert.deepEqual(parseToolArgs(""), {});
  assert.throws(() => parseToolArgs("not json at all"), /valid JSON/);
});
