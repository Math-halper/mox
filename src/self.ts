import fs from "node:fs";
import path from "node:path";
import type { ChatMessage } from "./types.ts";

/**
 * A "self" is a folder. Everything the AI is — its identity, what it knows,
 * how it behaves, what it remembers — lives in plain files you can edit.
 * Nothing is hidden in a database or a vendor's cloud.
 *
 *   brain/
 *     SELF.md            identity: who it is, how it talks, what it refuses
 *     config.json        name + optional model backend overrides
 *     HOW-TO-EDIT.md     notes for the human
 *     knowledge/         facts: markdown or text, one topic per file
 *     skills/            procedures: how to do recurring jobs
 *     memory/
 *       notes.md         long-term notes the agent can write (and you can edit)
 *       chat.jsonl       conversation history, one JSON object per line
 *     tiny/
 *       model.json       a small model trained from this folder, from scratch
 */

export type SelfConfig = {
  name: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type SelfFile = { file: string; text: string };

export type Self = {
  dir: string;
  config: SelfConfig;
  identity: string;
  knowledge: SelfFile[];
  skills: SelfFile[];
  memory: string;
  hasTiny: boolean;
};

export const SELF_FILES = {
  identity: "SELF.md",
  config: "config.json",
  howto: "HOW-TO-EDIT.md",
  knowledgeDir: "knowledge",
  skillsDir: "skills",
  memoryDir: "memory",
  notes: "memory/notes.md",
  chat: "memory/chat.jsonl",
  tiny: "tiny/model.json",
} as const;

const MAX_IDENTITY_CHARS = 6000;
const MAX_KNOWLEDGE_CHARS = 12_000;
const MAX_SKILL_CHARS = 4000;

function readIfExists(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readDir(dir: string): SelfFile[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: SelfFile[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) continue;
    if (!/\.(md|txt|markdown)$/i.test(entry.name)) continue;
    files.push({ file: entry.name, text: readIfExists(path.join(dir, entry.name)) });
  }
  return files;
}

export function loadSelf(dir: string): Self {
  const root = path.resolve(dir);
  const identityPath = path.join(root, SELF_FILES.identity);
  if (!fs.existsSync(identityPath)) {
    throw new Error(
      `no ${SELF_FILES.identity} in ${root}. Create one with: mox self init ${dir} --name <name>`,
    );
  }
  let config: SelfConfig = { name: path.basename(root) };
  const rawConfig = readIfExists(path.join(root, SELF_FILES.config));
  if (rawConfig.trim()) {
    try {
      const parsed = JSON.parse(rawConfig) as Partial<SelfConfig>;
      config = { name: path.basename(root), ...parsed } as SelfConfig;
    } catch (err) {
      throw new Error(`${SELF_FILES.config} is not valid JSON: ${(err as Error).message}`);
    }
  }

  return {
    dir: root,
    config,
    identity: readIfExists(identityPath).trim(),
    knowledge: readDir(path.join(root, SELF_FILES.knowledgeDir)),
    skills: readDir(path.join(root, SELF_FILES.skillsDir)),
    memory: readIfExists(path.join(root, SELF_FILES.notes)).trim(),
    hasTiny: fs.existsSync(path.join(root, SELF_FILES.tiny)),
  };
}

export function memoryPath(self: Self): string {
  return path.join(self.dir, SELF_FILES.notes);
}

export function tinyPath(self: Self): string {
  return path.join(self.dir, SELF_FILES.tiny);
}

/** Everything in the folder that the tiny model learns from. */
export function corpusFor(self: Self): string {
  const parts: string[] = [];
  if (self.identity) parts.push(self.identity);
  for (const entry of self.knowledge) parts.push(`# ${entry.file}\n\n${entry.text.trim()}`);
  for (const entry of self.skills) parts.push(`# ${entry.file}\n\n${entry.text.trim()}`);
  if (self.memory) parts.push(`# Notes\n\n${self.memory}`);
  return parts.join("\n\n");
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n… [truncated; the full file is on disk]";
}

/**
 * The block that turns a generic agent into *this* assistant. Kept short on
 * purpose: small local models lose the thread with long preambles, so the
 * identity is inlined and the rest points at files it can read on demand.
 */
export function personaBlock(self: Self): string {
  const lines: string[] = [];
  lines.push(`You are ${self.config.name}.`);
  if (self.identity) lines.push(clip(self.identity, MAX_IDENTITY_CHARS));

  if (self.knowledge.length > 0) {
    lines.push(`\n# What you know`);
    lines.push(
      `Your knowledge lives in ${path.join(self.dir, SELF_FILES.knowledgeDir)}. Read those files with your tools when a task needs more detail than below.`,
    );
    let budget = MAX_KNOWLEDGE_CHARS;
    for (const entry of self.knowledge) {
      if (budget <= 0) {
        lines.push(`\n(there are more files in knowledge/ — read them if needed)`);
        break;
      }
      const text = entry.text.trim();
      const piece = clip(text, Math.min(budget, text.length));
      lines.push(`\n## ${entry.file}\n${piece}`);
      budget -= piece.length;
    }
  }

  if (self.skills.length > 0) {
    lines.push(`\n# How you work`);
    lines.push(
      `Written procedures live in ${path.join(self.dir, SELF_FILES.skillsDir)}. Follow them when the task matches.`,
    );
    let budget = MAX_SKILL_CHARS;
    for (const entry of self.skills) {
      if (budget <= 0) break;
      const text = entry.text.trim();
      const piece = clip(text, Math.min(budget, text.length));
      lines.push(`\n## ${entry.file}\n${piece}`);
      budget -= piece.length;
    }
  }

  return lines.join("\n");
}

// ------------------------------------------------------------------ history

export type HistoryEntry = { ts: string; role: "user" | "assistant"; text: string };

export function appendHistory(self: Self, role: "user" | "assistant", text: string): void {
  const file = path.join(self.dir, SELF_FILES.chat);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry: HistoryEntry = { ts: new Date().toISOString(), role, text };
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
}

export function loadHistory(self: Self, limitTurns = 20): ChatMessage[] {
  const file = path.join(self.dir, SELF_FILES.chat);
  const raw = readIfExists(file);
  if (!raw.trim()) return [];
  const entries: HistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as HistoryEntry;
      if (parsed.role === "user" || parsed.role === "assistant") entries.push(parsed);
    } catch {
      /* skip malformed line rather than losing the whole history */
    }
  }
  const recent = entries.slice(-limitTurns * 2);
  return recent.map((entry) =>
    entry.role === "user"
      ? ({ role: "user", content: entry.text } as ChatMessage)
      : ({ role: "assistant", content: entry.text } as ChatMessage),
  );
}

export function clearHistory(self: Self): void {
  const file = path.join(self.dir, SELF_FILES.chat);
  if (fs.existsSync(file)) fs.renameSync(file, `${file}.${Date.now()}.bak`);
}

// ------------------------------------------------------------------ scaffold

const STARTER_IDENTITY = (name: string) => `# ${name}

You are ${name}, a local assistant that lives in this folder.

## Voice
- Direct and plain. No filler, no flattery, no "great question".
- Short by default; go long only when the task needs it.
- Say "I don't know" instead of inventing something.

## Rules
- Prefer doing over describing: use your tools rather than telling me what to type.
- Ask before anything destructive or irreversible.
- Never pretend to have done something you did not do.

## Edit this file
Everything here is yours to change. Rewrite the voice, swap the rules, give
the assistant a backstory — then run \`mox self chat .\` again. It reads this
file fresh every time.
`;

const STARTER_CONFIG = (name: string) =>
  JSON.stringify(
    {
      name,
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "",
      temperature: 0.3,
      maxTokens: 2048,
    },
    null,
    2,
  ) + "\n";

const STARTER_HOWTO = `# How to edit this assistant

Everything in this folder is the assistant. There is no hidden state.

| File | What it controls |
|---|---|
| \`SELF.md\` | Identity: name, voice, values, rules. The most important file. |
| \`knowledge/*.md\` | Facts it should know. One topic per file. Delete or edit freely. |
| \`skills/*.md\` | Written procedures for recurring jobs ("how I review a PR"). |
| \`memory/notes.md\` | Long-term notes. The assistant can write here; you can too. |
| \`memory/chat.jsonl\` | Conversation log. Delete it to forget the past, or edit lines. |
| \`config.json\` | Name, model backend, temperature. |
| \`tiny/model.json\` | A small model trained from these files with \`mox self train\`. |

## Two ways to talk to it

\`\`\`bash
mox self chat .    # real capability: uses your local model + tools, reads this folder
mox self talk .    # the from-scratch tiny model: babbles in this folder's voice
\`\`\`

## After editing

- \`self chat\` picks up your changes immediately (files are read on every run).
- \`self talk\` needs a retrain: \`mox self train .\`
`;

const STARTER_KNOWLEDGE = `# About me

Replace this with things worth knowing. The assistant reads this file.

- Timezone: (yours)
- I work on:
- Tools I use daily:
- Things that annoy me in a reply:

## Project notes

Add one file per topic in this folder, for example \`project-x.md\`,
\`server-setup.md\`, \`glossary.md\`. They are all loaded into the assistant's
context (up to a budget) and can be read in full with its file tools.
`;

const STARTER_SKILLS = `# How I like code reviewed

1. Read the diff and the tests before commenting.
2. Flag correctness bugs first, style last.
3. Prefer one clear suggestion over three vague ones.
4. Say explicitly when something looks fine.

(Replace with your own procedures. Delete this file if you do not want any.)
`;

export type InitOptions = { name?: string; force?: boolean };

export function initSelf(dir: string, opts: InitOptions = {}): { dir: string; created: string[] } {
  const root = path.resolve(dir);
  const name = opts.name?.trim() || path.basename(root) || "Ada";

  if (fs.existsSync(root) && fs.readdirSync(root).length > 0 && !opts.force) {
    const hasIdentity = fs.existsSync(path.join(root, SELF_FILES.identity));
    if (hasIdentity) throw new Error(`${root} already contains a self (${SELF_FILES.identity})`);
    throw new Error(`${root} is not empty; use --force to write into it anyway`);
  }

  const created: string[] = [];
  const write = (rel: string, content: string) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    created.push(rel);
  };

  write(SELF_FILES.identity, STARTER_IDENTITY(name));
  write(SELF_FILES.config, STARTER_CONFIG(name));
  write(SELF_FILES.howto, STARTER_HOWTO);
  write(`${SELF_FILES.knowledgeDir}/about-me.md`, STARTER_KNOWLEDGE);
  write(`${SELF_FILES.skillsDir}/example.md`, STARTER_SKILLS);
  write(SELF_FILES.notes, `# Notes\n`);
  fs.mkdirSync(path.join(root, SELF_FILES.memoryDir), { recursive: true });

  return { dir: root, created };
}

export type SelfSummary = {
  name: string;
  identityChars: number;
  knowledgeFiles: number;
  knowledgeChars: number;
  skillFiles: number;
  memoryChars: number;
  historyEntries: number;
  tiny: { steps: number; loss: number; bytes: number; trainedAt: string; params: number } | null;
};

export function summarizeSelf(self: Self): SelfSummary {
  const chat = readIfExists(path.join(self.dir, SELF_FILES.chat));
  const historyEntries = chat.split("\n").filter((line) => line.trim()).length;
  let tiny: SelfSummary["tiny"] = null;
  const raw = readIfExists(tinyPath(self));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as {
        steps?: number;
        loss?: number;
        bytes?: number;
        trainedAt?: string;
        config?: { d?: number; layers?: number; ctx?: number };
      };
      tiny = {
        steps: parsed.steps ?? 0,
        loss: parsed.loss ?? Number.NaN,
        bytes: parsed.bytes ?? 0,
        trainedAt: parsed.trainedAt ?? "",
        params: 0,
      };
    } catch {
      tiny = null;
    }
  }
  return {
    name: self.config.name,
    identityChars: self.identity.length,
    knowledgeFiles: self.knowledge.length,
    knowledgeChars: self.knowledge.reduce((n, k) => n + k.text.length, 0),
    skillFiles: self.skills.length,
    memoryChars: self.memory.length,
    historyEntries,
    tiny,
  };
}
