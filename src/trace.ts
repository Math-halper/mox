import fs from "node:fs";
import path from "node:path";
import { uid } from "./util.ts";

export type TraceRecord = {
  ts: string;
  run: string;
  type: string;
  [key: string]: unknown;
};

/**
 * Append-only JSONL run log. One file per run, flushed per record so that a
 * crash or Ctrl-C still leaves you a readable history of what the agent did.
 */
export class Tracer {
  readonly runId: string;
  readonly file: string | null;
  private enabled: boolean;

  constructor(dir: string, enabled: boolean, cwd: string) {
    this.runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${uid()}`;
    this.enabled = enabled;
    this.file = enabled ? path.resolve(cwd, dir, `${this.runId}.jsonl`) : null;
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.write({ type: "run.start", cwd });
    }
  }

  write(record: Record<string, unknown> & { type: string }): void {
    if (!this.enabled || !this.file) return;
    const line: TraceRecord = { ts: new Date().toISOString(), run: this.runId, ...record };
    try {
      fs.appendFileSync(this.file, JSON.stringify(line) + "\n", "utf8");
    } catch {
      /* tracing must never break the agent */
    }
  }

  close(): void {
    this.write({ type: "run.end" });
  }
}

export type RunSummary = {
  file: string;
  startedAt: string;
  cwd: string;
  steps: number;
  toolCalls: number;
  errors: number;
  finalText: string;
};

export function listRuns(dir: string): RunSummary[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const runs: RunSummary[] = [];
  for (const file of files.sort().reverse()) {
    const full = path.join(dir, file);
    let content: string;
    try {
      content = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n").filter(Boolean);
    let startedAt = file;
    let cwd = "";
    let steps = 0;
    let toolCalls = 0;
    let errors = 0;
    let finalText = "";
    for (const line of lines) {
      let rec: TraceRecord;
      try {
        rec = JSON.parse(line) as TraceRecord;
      } catch {
        continue;
      }
      if (rec.type === "run.start") {
        startedAt = rec.ts;
        cwd = String(rec.cwd ?? "");
      } else if (rec.type === "step") {
        steps = Math.max(steps, Number(rec.step ?? 0));
      } else if (rec.type === "tool_start") {
        toolCalls++;
      } else if (rec.type === "tool_end") {
        if (rec.isError) errors++;
      } else if (rec.type === "approval") {
        if (rec.decision === "deny") errors++;
      } else if (rec.type === "final") {
        finalText = String(rec.text ?? "");
      }
    }
    runs.push({ file: full, startedAt, cwd, steps, toolCalls, errors, finalText });
  }
  return runs;
}

export function readRun(file: string): TraceRecord[] {
  const content = fs.readFileSync(file, "utf8");
  const out: TraceRecord[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as TraceRecord);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}
