import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "./types.ts";
import { ToolError, bool, num, requireStr, str } from "./types.ts";
import { formatBytes, globToRegExp, resolveUserPath, truncateMiddle, truncateEnd, walkFiles } from "../util.ts";

const MAX_READ_BYTES = 2 * 1024 * 1024;

function resolvePath(ctx: { cwd: string }, p: string): string {
  return resolveUserPath(ctx.cwd, p);
}

function looksBinary(buffer: Buffer): boolean {
  const len = Math.min(buffer.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function withLineNumbers(text: string, startLine: number): string {
  return text
    .split("\n")
    .map((line, i) => `${String(startLine + i).padStart(5)} | ${line}`)
    .join("\n");
}

export const readFileTool: ToolDef = {
  name: "read_file",
  description:
    "Read a UTF-8 text file and return it with line numbers. " +
    "Use `offset` (1-based start line) and `limit` (max lines) for large files. " +
    "Binary files are refused.",
  readOnly: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path, absolute or relative to the project root." },
      offset: { type: "integer", description: "First line to return (1-based)." },
      limit: { type: "integer", description: "Maximum number of lines (default 2000)." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  summarize: (args) => str(args, "path"),
  async execute(args, ctx) {
    const target = resolvePath(ctx, requireStr(args, "path"));
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      throw new ToolError(`no such file: ${target}`);
    }
    if (stat.isDirectory()) throw new ToolError(`${target} is a directory — use list_dir`);
    if (stat.size > MAX_READ_BYTES) {
      throw new ToolError(
        `${formatBytes(stat.size)} is too large to read in one go; use grep or read a slice`,
      );
    }
    const buffer = fs.readFileSync(target);
    if (looksBinary(buffer)) {
      throw new ToolError(`${path.basename(target)} looks binary (${formatBytes(stat.size)})`);
    }
    const text = buffer.toString("utf8");
    const allLines = text.split("\n");
    const offset = Math.max(1, num(args, "offset", 1));
    const limit = Math.max(1, num(args, "limit", 2000));
    const slice = allLines.slice(offset - 1, offset - 1 + limit);
    const header =
      offset > 1 || offset - 1 + limit < allLines.length
        ? `[${path.relative(ctx.cwd, target) || target} lines ${offset}-${offset - 1 + slice.length} of ${allLines.length}]\n`
        : "";
    return header + withLineNumbers(slice.join("\n"), offset);
  },
};

export const writeFileTool: ToolDef = {
  name: "write_file",
  description:
    "Create or overwrite a text file with the given content. " +
    "Prefer `edit_file` for small changes to existing files; overwriting loses anything not included.",
  readOnly: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write." },
      content: { type: "string", description: "Full file content." },
      create_dirs: { type: "boolean", description: "Create missing parent directories (default true)." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  summarize: (args) => `${str(args, "path")} (${formatBytes(Buffer.byteLength(str(args, "content")))} )`,
  async execute(args, ctx) {
    const target = resolvePath(ctx, requireStr(args, "path"));
    const content = str(args, "content");
    if (typeof args["content"] !== "string") throw new ToolError(`"content" must be a string`);
    if (bool(args, "create_dirs", true)) fs.mkdirSync(path.dirname(target), { recursive: true });
    const existed = fs.existsSync(target);
    fs.writeFileSync(target, content, "utf8");
    const lines = content === "" ? 0 : content.split("\n").length;
    return `${existed ? "overwrote" : "created"} ${path.relative(ctx.cwd, target)} (${lines} lines, ${formatBytes(Buffer.byteLength(content))})`;
  },
};

export const editFileTool: ToolDef = {
  name: "edit_file",
  description:
    "Replace an exact string in a text file. `old` must appear exactly once unless replace_all is true. " +
    "Include enough surrounding context to make the match unique.",
  readOnly: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to edit." },
      old: { type: "string", description: "Exact text to replace." },
      new: { type: "string", description: "Replacement text (empty string deletes)." },
      replace_all: { type: "boolean", description: "Replace every occurrence (default false)." },
    },
    required: ["path", "old", "new"],
    additionalProperties: false,
  },
  summarize: (args) => str(args, "path"),
  async execute(args, ctx) {
    const target = resolvePath(ctx, requireStr(args, "path"));
    const oldText = str(args, "old");
    const newText = str(args, "new");
    if (!oldText) throw new ToolError(`"old" must not be empty`);
    if (!fs.existsSync(target)) throw new ToolError(`no such file: ${target}`);
    const original = fs.readFileSync(target, "utf8");
    const occurrences = original.split(oldText).length - 1;
    if (occurrences === 0) throw new ToolError(`text not found in ${path.basename(target)}`);
    const replaceAll = bool(args, "replace_all", false);
    if (occurrences > 1 && !replaceAll) {
      throw new ToolError(
        `text appears ${occurrences} times in ${path.basename(target)}; add context or set replace_all`,
      );
    }
    const updated = replaceAll
      ? original.split(oldText).join(newText)
      : original.replace(oldText, newText);
    fs.writeFileSync(target, updated, "utf8");
    return `edited ${path.relative(ctx.cwd, target)} (${occurrences} replacement${occurrences === 1 ? "" : "s"})`;
  },
};

export const listDirTool: ToolDef = {
  name: "list_dir",
  description:
    "List files and directories under a path. Skips node_modules, .git and other noise by default.",
  readOnly: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory (default: project root)." },
      depth: { type: "integer", description: "How deep to recurse (default 1)." },
      limit: { type: "integer", description: "Maximum entries (default 400)." },
    },
    additionalProperties: false,
  },
  summarize: (args) => str(args, "path", "."),
  async execute(args, ctx) {
    const target = args["path"] ? resolvePath(ctx, str(args, "path")) : ctx.cwd;
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      throw new ToolError(`not a directory: ${target}`);
    }
    const depth = Math.max(0, num(args, "depth", 1));
    const limit = Math.max(1, num(args, "limit", 400));
    const entries: string[] = [];

    const walk = (dir: string, level: number) => {
      if (entries.length >= limit) return;
      let dirents: fs.Dirent[];
      try {
        dirents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        entries.push(`${path.relative(target, dir)}/ [permission denied]`);
        return;
      }
      dirents.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const dirent of dirents) {
        if (entries.length >= limit) return;
        if (dirent.name === "node_modules" || dirent.name === ".git") continue;
        const rel = path.relative(target, path.join(dir, dirent.name));
        if (dirent.isDirectory()) {
          entries.push(`${rel}/`);
          if (level < depth) walk(path.join(dir, dirent.name), level + 1);
        } else {
          entries.push(rel);
        }
      }
    };
    walk(target, 1);
    const suffix = entries.length >= limit ? `\n… capped at ${limit} entries` : "";
    return `${path.relative(ctx.cwd, target) || "."}:\n${entries.join("\n")}${suffix}`;
  },
};

export const globTool: ToolDef = {
  name: "glob",
  description: "Find files by glob pattern, e.g. `src/**/*.ts` or `**/test_*.py`.",
  readOnly: true,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern using * and **." },
      path: { type: "string", description: "Directory to search from (default: project root)." },
      limit: { type: "integer", description: "Maximum results (default 200)." },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  summarize: (args) => str(args, "pattern"),
  async execute(args, ctx) {
    const pattern = requireStr(args, "pattern");
    const root = args["path"] ? resolvePath(ctx, str(args, "path")) : ctx.cwd;
    const limit = Math.max(1, num(args, "limit", 200));
    const matcher = globToRegExp(pattern);
    const { files } = walkFiles(root, { maxFiles: 50_000, signal: ctx.signal });
    const matches = files.filter((file) => matcher.test(file.replaceAll(path.sep, "/"))).slice(0, limit);
    if (matches.length === 0) return `no files matched ${pattern} in ${root}`;
    const capped = matches.length === limit ? `\n… showing first ${limit}` : "";
    return matches.join("\n") + capped;
  },
};

export const grepTool: ToolDef = {
  name: "grep",
  description:
    "Search file contents with a JavaScript regular expression and return matching lines " +
    "as `path:line: text`.",
  readOnly: true,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "JavaScript regex source." },
      path: { type: "string", description: "Directory or file to search (default: project root)." },
      glob: { type: "string", description: "Only search files matching this glob, e.g. `*.ts`." },
      ignore_case: { type: "boolean", description: "Case-insensitive search (default false)." },
      max_results: { type: "integer", description: "Maximum matching lines (default 100)." },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  summarize: (args) => str(args, "pattern"),
  async execute(args, ctx) {
    const source = requireStr(args, "pattern");
    let regex: RegExp;
    try {
      regex = new RegExp(source, bool(args, "ignore_case", false) ? "i" : "");
    } catch (err) {
      throw new ToolError(`invalid regex: ${(err as Error).message}`);
    }
    const root = args["path"] ? resolvePath(ctx, str(args, "path")) : ctx.cwd;
    const maxResults = Math.max(1, num(args, "max_results", 100));
    const glob = str(args, "glob");
    const globMatcher = glob ? globToRegExp(glob) : null;
    // `*.ts` should behave like grep --include, matching the basename too.
    const baseMatcher = glob && !glob.includes("/") ? globToRegExp(glob) : null;
    const isFile = fs.existsSync(root) && fs.statSync(root).isFile();
    const files = isFile
      ? [path.relative(path.dirname(root), root)]
      : walkFiles(root, { signal: ctx.signal }).files;
    const baseDir = isFile ? path.dirname(root) : root;

    const results: string[] = [];
    for (const rel of files) {
      if (ctx.signal?.aborted) break;
      const normalized = rel.replaceAll(path.sep, "/");
      const matchesGlob =
        !globMatcher ||
        globMatcher.test(normalized) ||
        (baseMatcher ? baseMatcher.test(path.basename(rel)) : false);
      if (!matchesGlob) continue;
      const full = path.join(baseDir, rel);
      let buffer: Buffer;
      try {
        const stat = fs.statSync(full);
        if (stat.size > MAX_READ_BYTES) continue;
        buffer = fs.readFileSync(full);
      } catch {
        continue;
      }
      if (looksBinary(buffer)) continue;
      const lines = buffer.toString("utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          results.push(`${path.relative(ctx.cwd, full)}:${i + 1}: ${truncateEnd(lines[i]!, 300)}`);
          if (results.length >= maxResults) break;
        }
      }
      if (results.length >= maxResults) break;
    }
    if (results.length === 0) return `no matches for /${source}/`;
    const suffix = results.length >= maxResults ? `\n… capped at ${maxResults} matches` : "";
    return results.join("\n") + suffix;
  },
};

export const fileTools = [readFileTool, writeFileTool, editFileTool, listDirTool, globTool, grepTool];

export { truncateMiddle };
