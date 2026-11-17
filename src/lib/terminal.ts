import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

export class TerminalError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "TerminalError"; }
}
export type TerminalLauncher = "shell" | "opencode" | "codex" | "claude" | "hermes";
export type TerminalSummary = {
  id: string; projectId: string; launcher: TerminalLauncher; title: string; cwd: string;
  status: "running" | "exited" | "stopped"; startedAt: number; endedAt: number | null;
  cols: number; rows: number; exitCode: number | null; signal: number | null; lastSeq: number;
};
export type TerminalEvent = { seq: number; type: "output"; data: string } | { seq: number; type: "exit"; terminal: TerminalSummary };
type Disposable = { dispose(): void };
export type TerminalPty = {
  pid: number; write(data: string): void; resize(cols: number, rows: number): void; kill(signal?: string): void;
  onData(callback: (data: string) => void): Disposable;
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): Disposable;
};
export type TerminalSpawn = (file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }) => TerminalPty;
type Session = { summary: TerminalSummary; owner: string; pty: TerminalPty | null; events: TerminalEvent[]; bytes: number;
  listeners: Set<(event: TerminalEvent) => void>; touched: number; detachedAt: number | null; inputWindow: number; inputBytes: number; disposables: Disposable[]; stopping?: Promise<void> };
const MAX_OUTPUT = 1024 * 1024;
const MAX_EVENTS = 4000;
const MAX_SESSIONS = 8;
const MAX_PROJECT_SESSIONS = 4;
const MAX_STORED_SESSIONS = 40;
const MAX_INPUT = 16 * 1024;
const INPUT_RATE = 256 * 1024;
const IDLE_MS = 2 * 60 * 60 * 1000;
const RETAIN_MS = 30 * 60 * 1000;
const COOKIE = "gridmind_terminal_owner";
const knownLaunchers: { id: TerminalLauncher; label: string; binary?: string }[] = [
  { id: "shell", label: "Shell" }, { id: "opencode", label: "OpenCode", binary: "opencode" },
  { id: "codex", label: "Codex", binary: "codex" }, { id: "claude", label: "Claude Code", binary: "claude" },
  { id: "hermes", label: "Hermes", binary: "hermes" },
];

function executable(file: string) {
  try { fs.accessSync(file, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK); return fs.statSync(file).isFile(); }
  catch { return false; }
}
function binary(name: string, env: NodeJS.ProcessEnv) {
  const extensions = process.platform === "win32" ? ["", ...(env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")] : [""];
  for (const directory of (env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const file = path.resolve(directory, name + extension);
      if (executable(file)) return file;
    }
  }
  return null;
}
function shell(env: NodeJS.ProcessEnv) {
  if (process.platform === "win32") {
    const file = env.ComSpec || env.COMSPEC || binary("powershell", env) || binary("cmd", env);
    return file && executable(file) ? { file, args: /(?:^|[\\/])cmd(?:\.exe)?$/i.test(file) ? [] : ["-NoLogo"] } : null;
  }
  const file = [env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].find((candidate) => candidate && path.isAbsolute(candidate) && executable(candidate));
  return file ? { file, args: ["-l"] } : null;
}
function launchCommand(id: TerminalLauncher, env: NodeJS.ProcessEnv) {
  if (id === "shell") return shell(env);
  const name = knownLaunchers.find((launcher) => launcher.id === id)?.binary;
  const file = name ? binary(name, env) : null;
  if (!file) return null;
  // Windows npm launchers are .cmd files; cmd runs the resolved launcher, without
  // interpolating a project path or user command. Windows filenames cannot contain ".
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(file)) {
    const interpreter = env.ComSpec || env.COMSPEC || binary("cmd", env);
    if (!interpreter || !executable(interpreter)) return null;
    return { file: interpreter, args: ["/d", "/s", "/c", `"${file}"`] };
  }
  return { file, args: [] };
}
export function terminalDimensions(cols: unknown, rows: unknown) {
  if (!Number.isInteger(cols) || Number(cols) < 20 || Number(cols) > 300 || !Number.isInteger(rows) || Number(rows) < 5 || Number(rows) > 120) {
    throw new TerminalError("Terminal size must be 20–300 columns and 5–120 rows.");
  }
  return { cols: Number(cols), rows: Number(rows) };
}
async function nativeSpawn(): Promise<TerminalSpawn> {
  try {
    const pty = await import("node-pty");
    return (file, args, options) => pty.spawn(file, args, options);
  } catch { throw new TerminalError("The terminal runtime is unavailable. Run npm install in Gridmind, then restart the server.", 503); }
}
const execFileAsync = promisify(execFile);
type OwnedProcess = { pid: number; started: string };
function parseProcessSnapshot(stdout: string) {
  const processes = new Map<number, { parent: number; started: string }>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match) processes.set(Number(match[1]), { parent: Number(match[2]), started: match[3] });
  }
  return processes;
}
function ownedFromSnapshot(parent: number, snapshot: ReturnType<typeof parseProcessSnapshot>): OwnedProcess[] {
  const children = new Map<number, number[]>();
  for (const [pid, process] of snapshot) children.set(process.parent, [...(children.get(process.parent) || []), pid]);
  const result: OwnedProcess[] = [], seen = new Set([parent]);
  const visit = (pid: number) => { for (const child of children.get(pid) || []) { if (seen.has(child)) continue; seen.add(child); visit(child); result.push({ pid: child, started: snapshot.get(child)!.started }); } };
  visit(parent);
  if (snapshot.has(parent)) result.push({ pid: parent, started: snapshot.get(parent)!.started });
  return result;
}
async function processSnapshot() {
  if (process.platform === "win32") return parseProcessSnapshot("");
  try {
    const ps = fs.existsSync("/bin/ps") ? "/bin/ps" : "/usr/bin/ps";
    const { stdout } = await execFileAsync(ps, ["-axo", "pid=,ppid=,lstart="], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
    return parseProcessSnapshot(stdout);
  } catch { /* Native PTY cleanup remains the fallback when process enumeration is unavailable. */ }
  return parseProcessSnapshot("");
}
async function ownedProcesses(parent: number): Promise<OwnedProcess[]> {
  return ownedFromSnapshot(parent, await processSnapshot());
}

/** In-memory PTYs are intentionally not persisted or restarted after a server restart. */
export class TerminalManager {
  private sessions = new Map<string, Session>();
  private creating = 0;
  private reservations = new Map<string, number>();
  private spawnPromise?: Promise<TerminalSpawn>;
  constructor(private loadSpawn: () => Promise<TerminalSpawn> = nativeSpawn,
    private env: NodeJS.ProcessEnv = process.env, private now: () => number = Date.now,
    private killDescendants = true) {}

  launchers() { return knownLaunchers.map(({ id, label }) => ({ id, label, available: !!launchCommand(id, this.env) })); }
  private session(projectId: string, owner: string, id: string) {
    const session = this.sessions.get(id);
    if (!session || session.summary.projectId !== projectId || session.owner !== owner) throw new TerminalError("Terminal session not found in this browser and project.", 404);
    return session;
  }
  private summary(session: Session): TerminalSummary { return { ...session.summary }; }
  list(projectId: string, owner: string) {
    return [...this.sessions.values()].filter((session) => session.summary.projectId === projectId && session.owner === owner)
      .sort((a, b) => b.summary.startedAt - a.summary.startedAt).map((session) => this.summary(session));
  }
  get(projectId: string, owner: string, id: string) { return this.summary(this.session(projectId, owner, id)); }
  private emit(session: Session, event: TerminalEvent) {
    session.events.push(event);
    session.bytes += event.type === "output" ? Buffer.byteLength(event.data) : 256;
    while (session.events.length > MAX_EVENTS || session.bytes > MAX_OUTPUT) {
      const removed = session.events.shift()!;
      session.bytes -= removed.type === "output" ? Buffer.byteLength(removed.data) : 256;
    }
    for (const listener of [...session.listeners]) { try { listener(event); } catch { session.listeners.delete(listener); } }
    if (!session.listeners.size && session.detachedAt === null) session.detachedAt = this.now();
  }
  async create(projectId: string, owner: string, cwd: string, input: { launcher?: unknown; cols?: unknown; rows?: unknown }) {
    const launcher = input.launcher ?? "shell";
    if (!knownLaunchers.some((item) => item.id === launcher)) throw new TerminalError("Choose Shell or an available agent launcher.");
    const dimensions = terminalDimensions(input.cols ?? 100, input.rows ?? 28);
    let directory: string;
    try { directory = fs.realpathSync(cwd); if (!fs.statSync(directory).isDirectory()) throw new Error(); }
    catch { throw new TerminalError("The project's repository folder is unavailable. Check its local path.", 400); }
    const command = launchCommand(launcher as TerminalLauncher, this.env);
    if (!command) throw new TerminalError("This CLI is not installed on the Gridmind server's PATH. Install it and restart Gridmind.", 409);
    const active = [...this.sessions.values()].filter((session) => session.pty);
    if (active.length + this.creating >= MAX_SESSIONS || active.filter((session) => session.summary.projectId === projectId).length + (this.reservations.get(projectId) || 0) >= MAX_PROJECT_SESSIONS) {
      throw new TerminalError("Terminal limit reached. Stop an existing terminal before opening another.", 429);
    }
    this.creating++; this.reservations.set(projectId, (this.reservations.get(projectId) || 0) + 1);
    try {
      const spawn = await (this.spawnPromise ??= this.loadSpawn().catch((error) => { this.spawnPromise = undefined; throw error; }));
      const environment: Record<string, string> = {};
      for (const [key, value] of Object.entries(this.env)) if (typeof value === "string") environment[key] = value;
      // The user's normal local CLI credentials remain available. Gridmind's own
      // server/session credentials must not become terminal child environment.
      for (const key of Object.keys(environment)) if (/^GRIDMIND_/.test(key) || key === "GITHUB_TOKEN" || key === "GITHUB_CLIENT_ID") delete environment[key];
      environment.TERM = "xterm-256color"; environment.COLORTERM = "truecolor";
      let pty: TerminalPty;
      try { pty = spawn(command.file, command.args, { name: "xterm-256color", ...dimensions, cwd: directory, env: environment }); }
      catch { throw new TerminalError("Could not start this terminal. Check that the CLI and terminal runtime are installed, then try again.", 503); }
      const now = this.now();
      const session: Session = { owner, pty, events: [], bytes: 0, listeners: new Set(), touched: now, detachedAt: now, inputWindow: now, inputBytes: 0, disposables: [],
        summary: { id: randomUUID(), projectId, launcher: launcher as TerminalLauncher, title: knownLaunchers.find((item) => item.id === launcher)!.label,
          cwd: directory, status: "running", startedAt: now, endedAt: null, ...dimensions, exitCode: null, signal: null, lastSeq: 0 } };
      this.sessions.set(session.summary.id, session);
      session.disposables.push(pty.onData((data) => {
        if (session.summary.status !== "running") return;
        session.touched = this.now();
        // Chunk very large bursts so neither the SSE frame nor a replay entry is unbounded.
        for (let offset = 0; offset < data.length;) {
          let end = Math.min(offset + 8192, data.length);
          if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]) && /[\uDC00-\uDFFF]/.test(data[end])) end--;
          this.emit(session, { seq: ++session.summary.lastSeq, type: "output", data: data.slice(offset, end) }); offset = end;
        }
      }));
      session.disposables.push(pty.onExit(({ exitCode, signal }) => {
        session.pty = null;
        for (const disposable of session.disposables) disposable.dispose(); session.disposables = [];
        if (session.summary.status === "running") {
          session.summary.status = "exited"; session.summary.exitCode = exitCode; session.summary.signal = signal ?? null; session.summary.endedAt = this.now();
          this.emit(session, { seq: ++session.summary.lastSeq, type: "exit", terminal: this.summary(session) });
        }
      }));
      this.prune();
      return this.summary(session);
    } finally {
      this.creating--;
      const remaining = (this.reservations.get(projectId) || 1) - 1;
      if (remaining) this.reservations.set(projectId, remaining); else this.reservations.delete(projectId);
    }
  }
  input(projectId: string, owner: string, id: string, data: unknown) {
    if (typeof data !== "string" || !data.length || Buffer.byteLength(data) > MAX_INPUT) throw new TerminalError("Terminal input must contain 1–16384 bytes.");
    const session = this.session(projectId, owner, id);
    if (session.summary.status !== "running" || !session.pty) throw new TerminalError("This terminal has ended. Start a new terminal.", 409);
    const now = this.now();
    if (now - session.inputWindow >= 1000) { session.inputWindow = now; session.inputBytes = 0; }
    if (session.inputBytes + Buffer.byteLength(data) > INPUT_RATE) throw new TerminalError("Terminal input is arriving too quickly. Try again in a moment.", 429);
    session.inputBytes += Buffer.byteLength(data); session.touched = now;
    try { session.pty.write(data); } catch { throw new TerminalError("The terminal could not accept input. Refresh its connection.", 409); }
  }
  resize(projectId: string, owner: string, id: string, cols: unknown, rows: unknown) {
    const dimensions = terminalDimensions(cols, rows);
    const session = this.session(projectId, owner, id);
    if (session.summary.status !== "running" || !session.pty) throw new TerminalError("This terminal has ended. Start a new terminal.", 409);
    try { session.pty.resize(dimensions.cols, dimensions.rows); } catch { throw new TerminalError("The terminal could not resize. Refresh its connection.", 409); }
    Object.assign(session.summary, dimensions); session.touched = this.now();
    return this.summary(session);
  }
  watch(projectId: string, owner: string, id: string, after: number, listener: (event: TerminalEvent) => void) {
    const session = this.session(projectId, owner, id);
    if (session.listeners.size >= 4) throw new TerminalError("This terminal already has four viewers. Close another view and reconnect.", 429);
    const oldest = session.events[0]?.seq ?? session.summary.lastSeq + 1;
    const reset = after > session.summary.lastSeq || after < oldest - 1;
    const events = session.events.filter((event) => reset || event.seq > after);
    session.listeners.add(listener); session.touched = this.now(); session.detachedAt = null;
    return { terminal: this.summary(session), reset, truncated: oldest > 1, events,
      unsubscribe: () => { session.listeners.delete(listener); if (!session.listeners.size && session.detachedAt === null) session.detachedAt = this.now(); } };
  }
  private async terminate(session: Session) {
    if (!session.pty) return;
    const pty = session.pty;
    const owned = this.killDescendants ? await ownedProcesses(pty.pid) : [];
    if (session.pty !== pty) return;
    if (this.killDescendants && process.platform !== "win32") {
      for (const { pid } of owned) {
        if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
        try { process.kill(-pid, "SIGTERM"); } catch { /* Not every child is a process group leader. */ }
        try { process.kill(pid, "SIGTERM"); } catch { /* Already exited. */ }
      }
    }
    try { pty.kill("SIGTERM"); } catch { /* Already exited. */ }
    if (owned.length || session.pty === pty) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (this.killDescendants && process.platform !== "win32") {
        const remaining = await processSnapshot();
        for (const { pid, started } of owned) {
          // A process that exited during the grace period must not lend its PID
          // to a new process. Only signal the same original process identity.
          if (remaining.get(pid)?.started !== started || pid <= 1 || pid === process.pid) continue;
          try { process.kill(-pid, "SIGKILL"); } catch { /* Not a live process group leader. */ }
          try { process.kill(pid, "SIGKILL"); } catch { /* Already exited. */ }
        }
      }
      if (session.pty === pty) { try { pty.kill("SIGKILL"); } catch { /* Already exited. */ } }
    }
  }
  async stop(projectId: string, owner: string, id: string) {
    const session = this.session(projectId, owner, id);
    if (session.summary.status === "running") {
      session.summary.status = "stopped"; session.summary.endedAt = this.now();
      this.emit(session, { seq: ++session.summary.lastSeq, type: "exit", terminal: this.summary(session) });
    }
    await (session.stopping ??= this.terminate(session));
    return this.summary(session);
  }
  prune() {
    const now = this.now();
    for (const session of this.sessions.values()) {
      if (session.pty && (now - session.touched > IDLE_MS || (session.detachedAt !== null && now - session.detachedAt > IDLE_MS))) void this.stop(session.summary.projectId, session.owner, session.summary.id);
      if (!session.pty && session.summary.endedAt !== null && now - session.summary.endedAt > RETAIN_MS && !session.listeners.size) this.sessions.delete(session.summary.id);
    }
    const ended = [...this.sessions.values()].filter((session) => !session.pty && !session.listeners.size).sort((a, b) => a.summary.startedAt - b.summary.startedAt);
    while (this.sessions.size > MAX_STORED_SESSIONS && ended.length) this.sessions.delete(ended.shift()!.summary.id);
  }
  async dispose() { await Promise.allSettled([...this.sessions.values()].map((session) => this.stop(session.summary.projectId, session.owner, session.summary.id))); }
  shutdownSync() {
    // Next's own signal handler can call process.exit after closing HTTP/SSE.
    // Cleanup must complete synchronously before that exit, including foreground
    // jobs in their own process groups. Only a directly owned PTY is a root.
    let snapshot = parseProcessSnapshot("");
    if (this.killDescendants && process.platform !== "win32") {
      try {
        const ps = fs.existsSync("/bin/ps") ? "/bin/ps" : "/usr/bin/ps";
        snapshot = parseProcessSnapshot(execFileSync(ps, ["-axo", "pid=,ppid=,lstart="], { encoding: "utf8", timeout: 1500, maxBuffer: 4 * 1024 * 1024 }));
      } catch { /* Native PTY and its owned process group are still terminated. */ }
    }
    for (const session of this.sessions.values()) {
      const pty = session.pty;
      if (!pty) continue;
      if (this.killDescendants && process.platform !== "win32") {
        const pids = [...ownedFromSnapshot(pty.pid, snapshot).map(({ pid }) => pid), pty.pid];
        for (const pid of new Set(pids)) {
          if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
          try { process.kill(-pid, "SIGKILL"); } catch { /* Not a live process group leader. */ }
          try { process.kill(pid, "SIGKILL"); } catch { /* Already exited. */ }
        }
      }
      try { pty.kill("SIGKILL"); } catch { /* Already exited. */ }
    }
  }
}

const state = globalThis as unknown as { __gridmindTerminalManager?: TerminalManager; __gridmindTerminalCleanup?: NodeJS.Timeout; __gridmindTerminalSignals?: boolean };
export function terminalManager() {
  state.__gridmindTerminalManager ??= new TerminalManager();
  if (!state.__gridmindTerminalCleanup) {
    state.__gridmindTerminalCleanup = setInterval(() => state.__gridmindTerminalManager?.prune(), 60000);
    state.__gridmindTerminalCleanup.unref();
  }
  if (!state.__gridmindTerminalSignals) {
    state.__gridmindTerminalSignals = true;
    process.once("SIGTERM", () => { state.__gridmindTerminalManager?.shutdownSync(); });
    process.once("SIGINT", () => { state.__gridmindTerminalManager?.shutdownSync(); });
    process.once("exit", () => { state.__gridmindTerminalManager?.shutdownSync(); });
  }
  return state.__gridmindTerminalManager;
}

/** Local browser authority is mandatory; forwarded headers are never trusted. */
export function assertLocalTerminalRequest(req: Request) {
  const url = new URL(req.url);
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!["http:", "https:"].includes(url.protocol) || !local.has(url.hostname)) throw new TerminalError("Terminals are available only on the local Gridmind server.", 403);
  const host = req.headers.get("host");
  let origin = url.origin;
  if (host) {
    let authority: URL | null = null;
    try { authority = new URL(`${url.protocol}//${host}`); } catch { /* rejected below */ }
    if (!authority || authority.host !== host.toLowerCase() || !local.has(authority.hostname)) throw new TerminalError("Terminals are available only on the local Gridmind server.", 403);
    origin = authority.origin;
  }
  const supplied = req.headers.get("origin");
  if ((!['GET', 'HEAD'].includes(req.method) && !supplied) || (supplied && supplied !== origin) || req.headers.get("sec-fetch-site") === "cross-site") {
    throw new TerminalError("Terminal requests must come from this local Gridmind page.", 403);
  }
}
export function terminalOwner(req: Request, create = false) {
  const raw = req.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const cookie = (owner: string) => `${COOKIE}=${owner}; Path=/api/projects; HttpOnly; SameSite=Strict; Max-Age=43200${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
  if (raw && /^[A-Za-z0-9_-]{43}$/.test(raw)) return { owner: raw, cookie: create ? cookie(raw) : null };
  if (!create) throw new TerminalError("Terminal session not found in this browser and project.", 404);
  const owner = randomBytes(32).toString("base64url");
  return { owner, cookie: cookie(owner) };
}
export async function terminalJson(req: Request) {
  if (req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || (req.headers.get("content-encoding") && req.headers.get("content-encoding") !== "identity")) throw new TerminalError("Send a JSON terminal request.", 415);
  if (Number(req.headers.get("content-length") || 0) > 32768) throw new TerminalError("Terminal request is too large.", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new TerminalError("Send a JSON terminal request.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 32768) { await reader.cancel(); throw new TerminalError("Terminal request is too large.", 413); }
      chunks.push(chunk.value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch (error) { if (error instanceof TerminalError) throw error; throw new TerminalError("Send a valid JSON terminal request."); }
}
export function terminalResponse(data: unknown, status = 200, cookie: string | null = null) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
}
export function terminalFailure(error: unknown) { return terminalResponse({ error: error instanceof TerminalError ? error.message : "The terminal request could not be completed. Please try again." }, error instanceof TerminalError ? error.status : 500); }

export function terminalStream(req: Request, projectId: string, owner: string, id: string) {
  const header = req.headers.get("last-event-id");
  const cursor = header || new URL(req.url).searchParams.get("after") || "0";
  if (!/^\d{1,15}$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) throw new TerminalError("Invalid terminal stream cursor.");
  const manager = terminalManager();
  manager.get(projectId, owner, id);
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let keepalive: ReturnType<typeof setInterval> | undefined;
      let unsubscribe = () => {};
      const close = () => { if (closed) return; closed = true; clearInterval(keepalive); unsubscribe(); req.signal.removeEventListener("abort", close); try { controller.close(); } catch { /* already closed */ } };
      cleanup = close;
      const send = (message: string) => {
        if (closed) return;
        // A suspended browser must reconnect and use bounded replay rather than
        // accumulating an unbounded stream in server memory.
        if ((controller.desiredSize ?? 0) <= 0) { close(); return; }
        try { controller.enqueue(encoder.encode(message)); } catch { close(); }
      };
      const event = (item: TerminalEvent) => {
        send(`id: ${item.seq}\nevent: ${item.type}\ndata: ${JSON.stringify(item.type === "output" ? { data: item.data } : { terminal: item.terminal })}\n\n`);
        if (item.type === "exit") close();
      };
      const snapshot = manager.watch(projectId, owner, id, Number(cursor), event);
      unsubscribe = snapshot.unsubscribe;
      send(`retry: 1200\nevent: ready\ndata: ${JSON.stringify({ terminal: snapshot.terminal, reset: snapshot.reset, truncated: snapshot.truncated })}\n\n`);
      for (const item of snapshot.events) event(item);
      if (snapshot.terminal.status !== "running") close();
      if (!closed) {
        keepalive = setInterval(() => send(": keepalive\n\n"), 15000);
        req.signal.addEventListener("abort", close, { once: true });
        if (req.signal.aborted) close();
      }
    },
    cancel() { cleanup(); },
  }, { highWaterMark: 2 * 1024 * 1024, size: (chunk) => chunk.byteLength });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" } });
}
