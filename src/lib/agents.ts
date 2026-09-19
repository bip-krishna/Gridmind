import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { nanoid } from "nanoid";

export type AgentStatus = "starting" | "running" | "thinking" | "done" | "error" | "stopped";

export type AgentMessage = {
  type: "status" | "output" | "final";
  step: string;
  text: string;
  sessionID?: string;
};

export type SpawnOptions = {
  repoPath: string;
  prompt: string;
  title: string;
  cwd?: string;
  env?: Record<string, string>;
};

export type SpawnedAgent = {
  proc: ChildProcess;
  ready: Promise<void>;
};

/**
 * AgentAdapter: the single seam between GridMind and a coding agent.
 * Each adapter knows how to launch its CLI in headless mode and how to
 * translate raw output into AgentMessage events consumed by the runner.
 */
export interface AgentAdapter {
  readonly type: string;
  readonly label: string;
  isAvailable(): boolean;
  spawn(options: SpawnOptions): SpawnedAgent;
  /** Map an output line / chunk to zero or more AgentMessages. */
  onLine(line: string, emit: (m: AgentMessage) => void): void;
}

export const AGENT_TYPES = ["opencode", "codex"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

function resolveBinary(name: string): string | null {
  return name;
}

export function byteLen(s: string): number {
  return Buffer.byteLength(s);
}

/** OpenCode adapter: `opencode run --format json`. */
export class OpenCodeAdapter implements AgentAdapter {
  readonly type = "opencode";
  readonly label = "OpenCode";

  isAvailable(): boolean {
    try {
      execSync("opencode --version", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  spawn(options: SpawnOptions): SpawnedAgent {
    const bin = resolveBinary("opencode")!;
    const cwd = options.cwd ?? options.repoPath;
    const args = ["run", "--format", "json", "--title", options.title, options.prompt];
    const proc = spawn(bin, args, {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { proc, ready: Promise.resolve() };
  }

  onLine(line: string, emit: (m: AgentMessage) => void): void {
    if (line.trim().length === 0) return;
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      emit({ type: "output", step: "output", text: line });
      return;
    }
    const obj = data as {
      type?: string;
      part?: { type?: string; text?: string };
    };
    const t = obj.type ?? obj.part?.type;
    switch (t) {
      case "step_start":
        emit({ type: "status", step: "working", text: "Agent is working…" });
        break;
      case "text": {
        const text = obj.part?.text ?? "";
        if (text.trim().length > 0) emit({ type: "output", step: "responding", text });
        break;
      }
      case "step_finish":
        emit({ type: "final", step: "done", text: "" });
        break;
      default:
        break;
    }
  }
}

/** Codex adapter: `codex exec --json`. */
export class CodexAdapter implements AgentAdapter {
  readonly type = "codex";
  readonly label = "Codex";

  isAvailable(): boolean {
    try {
      execSync("codex --version", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  spawn(options: SpawnOptions): SpawnedAgent {
    const bin = resolveBinary("codex")!;
    const cwd = options.cwd ?? options.repoPath;
    const args = ["exec", "--json", "--skip-git-repo-check", options.prompt];
    const proc = spawn(bin, args, {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { proc, ready: Promise.resolve() };
  }

  onLine(line: string, emit: (m: AgentMessage) => void): void {
    if (line.trim().length === 0) return;
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      emit({ type: "output", step: "output", text: line });
      return;
    }
    const obj = data as {
      type?: string;
      message?: { content?: { text?: string }[]; role?: string };
      step?: string;
    };
    const t = obj.type;
    switch (t) {
      case "result":
        emit({ type: "final", step: "done", text: "" });
        break;
      case "message": {
        const text = obj.message?.content?.[0]?.text ?? "";
        if (text.trim().length > 0) emit({ type: "output", step: "responding", text });
        break;
      }
      default:
        break;
    }
  }
}

export function getAdapter(type: string): AgentAdapter {
  switch (type) {
    case "opencode":
      return new OpenCodeAdapter();
    case "codex":
      return new CodexAdapter();
    default:
      throw new Error(`unknown agent type: ${type}`);
  }
}

export function adaptersStatus(): Record<AgentType, { available: boolean; label: string }> {
  const out = {} as Record<AgentType, { available: boolean; label: string }>;
  for (const t of AGENT_TYPES) {
    const a = getAdapter(t);
    out[t] = { available: a.isAvailable(), label: a.label };
  }
  return out;
}

export function newId(): string {
  return nanoid(14);
}