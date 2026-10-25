import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Config } from "./types.ts";

export type SandboxKind = "bwrap" | "sandbox-exec" | "none";

export type SandboxStatus = {
  kind: SandboxKind;
  available: boolean;
  detail: string;
};

function which(bin: string): string | null {
  const paths = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

export function detectSandbox(): SandboxStatus {
  if (process.platform === "darwin") {
    const bin = which("sandbox-exec");
    return bin
      ? { kind: "sandbox-exec", available: true, detail: bin }
      : { kind: "none", available: false, detail: "sandbox-exec not found" };
  }
  if (process.platform === "linux") {
    const bin = which("bwrap");
    if (!bin) {
      return {
        kind: "none",
        available: false,
        detail: "bwrap not installed (apt install bubblewrap / pacman -S bubblewrap)",
      };
    }
    try {
      execFileSync("bwrap", ["--version"], { stdio: "ignore", timeout: 5000 });
      // A real check: can we actually create a namespaced sandbox here?
      execFileSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--", "true"], {
        stdio: "ignore",
        timeout: 5000,
      });
      return { kind: "bwrap", available: true, detail: bin };
    } catch (err) {
      return {
        kind: "bwrap",
        available: false,
        detail: `bwrap is installed but unusable (${(err as Error).message.split("\n")[0]}) — kernel user namespaces may be disabled`,
      };
    }
  }
  return { kind: "none", available: false, detail: `no sandbox backend for ${process.platform}` };
}

const SBPL_RULES = (opts: { cwd: string; home: string; allowNetwork: boolean }) => {
  const escape = (p: string) => p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const credDirs = [
    ".ssh",
    ".aws",
    ".gnupg",
    ".netrc",
    ".docker/config.json",
    ".kube",
    ".config/gh",
  ];
  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    ...credDirs.map((d) => `(deny file-read* (subpath "${escape(path.join(opts.home, d))}"))`),
    '(deny file-write* (subpath "/"))',
    `(allow file-write* (subpath "${escape(opts.cwd)}"))`,
    '(allow file-write* (subpath "/tmp"))',
    '(allow file-write* (subpath "/private/tmp"))',
    '(allow file-write* (subpath "/dev"))',
  ];
  if (opts.allowNetwork) lines.splice(2, 1);
  return lines.join("\n");
};

export type SandboxPlan = {
  /** argv prefix to prepend to the command. Empty when unsandboxed. */
  prefix: string[];
  /** True when the command will actually run inside an OS sandbox. */
  confined: boolean;
  /** Human-readable description for the UI. */
  label: string;
  /** Non-empty when the user asked for a sandbox we cannot provide. */
  warning?: string;
};

/**
 * Build the argv prefix that confines `command`.
 *
 * bubblewrap (Linux): read-only system dirs, read-write project dir, private
 * /tmp, no /proc leaks, optional network namespace, home replaced by an empty
 * dir so ~/.ssh is unreachable.
 */
export function planSandbox(
  config: Config,
  status: SandboxStatus,
  cwd: string,
  command: string,
): SandboxPlan {
  if (config.sandbox.mode === "off") {
    return { prefix: [], confined: false, label: "unsandboxed (config)" };
  }

  if (!status.available) {
    const warning = config.sandbox.required
      ? `sandbox unavailable: ${status.detail}`
      : `running unsandboxed — ${status.detail}`;
    if (config.sandbox.required) {
      throw new Error(`sandbox required but unavailable: ${status.detail}`);
    }
    return { prefix: [], confined: false, label: "unsandboxed", warning };
  }

  const home = os.homedir();
  const shell = "/bin/bash";

  if (status.kind === "sandbox-exec") {
    const profile = SBPL_RULES({ cwd, home, allowNetwork: config.sandbox.allowNetwork });
    return {
      prefix: ["sandbox-exec", "-p", profile, shell, "-lc", command],
      confined: true,
      label: "sandbox-exec (macOS seatbelt)",
    };
  }

  const prefix: string[] = ["bwrap", "--die-with-parent", "--new-session", "--unshare-pid", "--unshare-ipc"];
  if (!config.sandbox.allowNetwork) prefix.push("--unshare-net");
  prefix.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");
  for (const dir of ["/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32", "/etc", "/opt", "/nix", "/run"]) {
    if (fs.existsSync(dir)) prefix.push("--ro-bind", dir, dir);
  }
  if (config.sandbox.maskHome) {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "mox-home-"));
    prefix.push("--bind", empty, home);
  } else {
    prefix.push("--bind", home, home);
  }
  prefix.push("--bind", cwd, cwd, "--chdir", cwd, "--setenv", "HOME", home);
  prefix.push(shell, "-lc", command);
  return { prefix, confined: true, label: "bubblewrap" };
}
