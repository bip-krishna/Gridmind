import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TerminalError, TerminalManager, assertLocalTerminalRequest, terminalDimensions, terminalJson, terminalOwner, terminalStream,
  type TerminalPty, type TerminalSpawn, type TerminalEvent } from "../src/lib/terminal";
import { createProject } from "../src/lib/db";
import { GET as listRoute, POST as createRoute } from "../src/app/api/projects/[id]/terminal/route";
import { POST as inputRoute } from "../src/app/api/projects/[id]/terminal/[terminalId]/input/route";
import { POST as resizeRoute } from "../src/app/api/projects/[id]/terminal/[terminalId]/resize/route";
import { DELETE as stopRoute } from "../src/app/api/projects/[id]/terminal/[terminalId]/route";
import { GET as streamRoute } from "../src/app/api/projects/[id]/terminal/[terminalId]/stream/route";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gridmind-terminal-unit-")));
const project = path.join(root, "project with spaces; literal $()"); fs.mkdirSync(project);
const bin = path.join(root, "bin"); fs.mkdirSync(bin);
for (const name of ["opencode", "codex", "claude", "hermes"]) fs.writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: bin, SHELL: "/bin/sh", ...(process.platform === "win32" ? { ComSpec: process.execPath } : {}),
  GRIDMIND_INTERNAL_TOKEN: "server-only", GITHUB_TOKEN: "server-only-github", OPENAI_API_KEY: "user-cli-fixture" };
const origin = "http://127.0.0.1:4317";
const managers: TerminalManager[] = [];
test.after(async () => { await Promise.all(managers.map((manager) => manager.dispose())); fs.rmSync(root, { recursive: true, force: true }); });

class FakePty implements TerminalPty {
  pid = 987654;
  writes: string[] = [];
  sizes: number[][] = [];
  killed: string[] = [];
  dataCallbacks = new Set<(data: string) => void>();
  exitCallbacks = new Set<(event: { exitCode: number; signal?: number }) => void>();
  write(data: string) { this.writes.push(data); }
  resize(cols: number, rows: number) { this.sizes.push([cols, rows]); }
  kill(signal = "SIGTERM") { this.killed.push(signal); this.exit(0, 9); }
  onData(callback: (data: string) => void) { this.dataCallbacks.add(callback); return { dispose: () => { this.dataCallbacks.delete(callback); } }; }
  onExit(callback: (event: { exitCode: number; signal?: number }) => void) { this.exitCallbacks.add(callback); return { dispose: () => { this.exitCallbacks.delete(callback); } }; }
  output(data: string) { for (const callback of [...this.dataCallbacks]) callback(data); }
  exit(exitCode = 0, signal?: number) { for (const callback of [...this.exitCallbacks]) callback({ exitCode, signal }); }
}
function fixture() {
  let now = 1000000;
  const ptys: FakePty[] = [];
  const launches: { file: string; args: string[]; options: Parameters<TerminalSpawn>[2] }[] = [];
  const spawn: TerminalSpawn = (file, args, options) => { launches.push({ file, args, options }); const pty = new FakePty(); ptys.push(pty); return pty; };
  const manager = new TerminalManager(async () => spawn, env, () => now, false);
  managers.push(manager);
  return { manager, ptys, launches, advance(ms: number) { now += ms; } };
}
function request(method = "GET", pathname = "/api/projects/terminal-fixture/terminal", body?: unknown, cookie?: string, requestOrigin: string | null = origin) {
  return new Request(origin + pathname, { method, headers: {
    Host: "127.0.0.1:4317", ...(requestOrigin ? { Origin: requestOrigin } : {}), ...(cookie ? { Cookie: cookie } : {}),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test("terminal mutations require an exact local Origin and reject rebinding/forwarded-host bypasses", () => {
  assert.doesNotThrow(() => assertLocalTerminalRequest(request("POST")));
  for (const method of ["POST", "DELETE", "PATCH"]) {
    assert.throws(() => assertLocalTerminalRequest(request(method, undefined, undefined, undefined, null)), /must come from/);
    assert.throws(() => assertLocalTerminalRequest(request(method, undefined, undefined, undefined, "https://untrusted.example")), /must come from/);
  }
  assert.throws(() => assertLocalTerminalRequest(new Request("http://localhost:4317/api", { headers: { Host: "untrusted.example", "X-Forwarded-Host": "localhost:4317" } })), /only on/);
  assert.throws(() => assertLocalTerminalRequest(new Request("http://untrusted.example/api", { headers: { Host: "localhost:4317" } })), /only on/);
  assert.throws(() => assertLocalTerminalRequest(new Request(origin + "/api", { headers: { Host: "127.0.0.1:4317", "Sec-Fetch-Site": "cross-site" } })), /must come from/);
  assert.doesNotThrow(() => assertLocalTerminalRequest(new Request("http://localhost:4317/api", { method: "POST", headers: { Host: "127.0.0.1:4317", Origin: origin } })), "Next's normalized URL must compare Origin against validated Host");
});

test("owner cookies are random HttpOnly strict cookies and are never read from query parameters", () => {
  const a = terminalOwner(request(), true), b = terminalOwner(request(), true);
  assert.notEqual(a.owner, b.owner);
  assert.match(a.cookie!, /HttpOnly; SameSite=Strict/);
  assert.match(a.cookie!, /Path=\/api\/projects/);
  assert.throws(() => terminalOwner(request("GET", `/api/projects/id/terminal?owner=${a.owner}`)), /not found/);
  assert.equal(terminalOwner(request("GET", undefined, undefined, a.cookie!.split(";")[0])).owner, a.owner);
  assert.equal(terminalOwner(request("GET", undefined, undefined, a.cookie!.split(";")[0]), true).owner, a.owner);
  assert.match(terminalOwner(request("GET", undefined, undefined, a.cookie!.split(";")[0]), true).cookie!, /Max-Age=43200/);
  assert.throws(() => terminalOwner(request("GET", undefined, undefined, "gridmind_terminal_owner=invalid")), /not found/);
});

test("launches pin project cwd, use bare interactive agents and remove Gridmind server credentials", async () => {
  const { manager, ptys, launches } = fixture();
  assert.equal(manager.launchers().find((launcher) => launcher.id === "opencode")?.available, true);
  const session = await manager.create("project-a", "owner-a", project, { launcher: "opencode", cols: 100, rows: 30 });
  assert.deepEqual(launches[0].args, []);
  assert.equal(launches[0].file, path.join(bin, "opencode"));
  assert.equal(launches[0].options.cwd, project);
  assert.equal(launches[0].options.env.TERM, "xterm-256color");
  assert.equal(launches[0].options.env.GRIDMIND_INTERNAL_TOKEN, undefined);
  assert.equal(launches[0].options.env.GITHUB_TOKEN, undefined);
  assert.equal(launches[0].options.env.OPENAI_API_KEY, "user-cli-fixture");
  assert.ok(!JSON.stringify(session).includes("owner-a"));
  manager.input("project-a", "owner-a", session.id, "\u0003opencode\r");
  assert.deepEqual(ptys[0].writes, ["\u0003opencode\r"]);
  assert.equal(manager.resize("project-a", "owner-a", session.id, 120, 42).cols, 120);
  assert.deepEqual(ptys[0].sizes, [[120, 42]]);
  for (const [projectId, owner] of [["project-b", "owner-a"], ["project-a", "owner-b"]]) {
    assert.throws(() => manager.get(projectId, owner, session.id), /not found/);
    assert.throws(() => manager.input(projectId, owner, session.id, "bad\r"), /not found/);
    assert.throws(() => manager.resize(projectId, owner, session.id, 100, 30), /not found/);
    await assert.rejects(manager.stop(projectId, owner, session.id), /not found/);
  }
  assert.equal(manager.list("project-a", "owner-b").length, 0);
  const stopped = await manager.stop("project-a", "owner-a", session.id);
  assert.equal(stopped.status, "stopped");
  assert.deepEqual(ptys[0].killed, ["SIGTERM"]);
  assert.throws(() => manager.input("project-a", "owner-a", session.id, "bad"), /has ended/);
});

test("terminal limits count pending launches, validate dimensions and reject oversized/rate-limited input", async () => {
  const { manager, advance } = fixture();
  for (const [cols, rows] of [[0, 30], [301, 30], [100, 0], [100, 121], [NaN, 30], [100.5, 30]]) assert.throws(() => terminalDimensions(cols, rows), TerminalError);
  await assert.rejects(manager.create("project-a", "owner", project, { launcher: "arbitrary --unsafe" }), /Choose/);
  await assert.rejects(manager.create("project-a", "owner", path.join(root, "missing"), {}), /unavailable/);
  const settled = await Promise.allSettled(Array.from({ length: 6 }, () => manager.create("project-a", "owner", project, {})));
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 4);
  assert.equal(settled.filter((item) => item.status === "rejected").length, 2);
  const id = manager.list("project-a", "owner")[0].id;
  assert.throws(() => manager.input("project-a", "owner", id, "x".repeat(16385)), /16384/);
  assert.throws(() => manager.input("project-a", "owner", id, ""), /16384/);
  for (let i = 0; i < 16; i++) manager.input("project-a", "owner", id, "x".repeat(16384));
  assert.throws(() => manager.input("project-a", "owner", id, "x"), /too quickly/);
  advance(1000); manager.input("project-a", "owner", id, "x");
  await manager.stop("project-a", "owner", id);
  assert.equal((await manager.create("project-a", "owner", project, {})).status, "running");
});

test("output replay is bounded, tracks cursors and reports retention gaps without exposing another session", async () => {
  const { manager, ptys } = fixture();
  const terminal = await manager.create("project-a", "owner", project, {});
  ptys[0].output("\u001b[31mhello\u001b[0m\r\n");
  const initial = manager.watch("project-a", "owner", terminal.id, 0, () => {});
  assert.equal(initial.events.length, 1); assert.equal(initial.reset, false); initial.unsubscribe();
  const seen: TerminalEvent[] = [];
  const resume = manager.watch("project-a", "owner", terminal.id, 1, (event) => seen.push(event));
  assert.equal(resume.events.length, 0);
  for (let i = 0; i < 4500; i++) ptys[0].output("x".repeat(300));
  assert.equal(seen.length, 4500); resume.unsubscribe();
  const truncated = manager.watch("project-a", "owner", terminal.id, 0, () => {});
  assert.equal(truncated.reset, true); assert.equal(truncated.truncated, true);
  assert.ok(truncated.events.length <= 4000);
  assert.ok(truncated.events.reduce((sum, event) => sum + (event.type === "output" ? Buffer.byteLength(event.data) : 256), 0) <= 1024 * 1024);
  truncated.unsubscribe();
  assert.throws(() => manager.watch("project-a", "another-browser", terminal.id, 0, () => {}), /not found/);
  ptys[0].exit(7);
  const ended = manager.get("project-a", "owner", terminal.id);
  assert.equal(ended.status, "exited"); assert.equal(ended.exitCode, 7);
  const final = manager.watch("project-a", "owner", terminal.id, ended.lastSeq - 1, () => {});
  assert.equal(final.events.at(-1)?.type, "exit"); final.unsubscribe();
});

test("idle sessions stop and ended terminal history expires", async () => {
  const { manager, ptys, advance } = fixture();
  const terminal = await manager.create("project-a", "owner", project, {});
  advance(2 * 60 * 60 * 1000 + 1); manager.prune();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.get("project-a", "owner", terminal.id).status, "stopped");
  assert.equal(ptys[0].killed.length, 1);
  advance(30 * 60 * 1000 + 1); manager.prune();
  assert.throws(() => manager.get("project-a", "owner", terminal.id), /not found/);
});

test("attached output refreshes idle lifetime while detached output cannot leave an orphan terminal forever", async () => {
  const { manager, ptys, advance } = fixture();
  const terminal = await manager.create("project-a", "owner", project, {});
  const watch = manager.watch("project-a", "owner", terminal.id, 0, () => {});
  advance(2 * 60 * 60 * 1000 - 1); ptys[0].output("Still working\r\n");
  advance(2); manager.prune();
  assert.equal(manager.get("project-a", "owner", terminal.id).status, "running");
  watch.unsubscribe();
  advance(2 * 60 * 60 * 1000 + 1); ptys[0].output("Detached background loop\r\n"); manager.prune();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.get("project-a", "owner", terminal.id).status, "stopped");
});

test("synchronous shutdown kills owned PTYs before a framework process-exit hook can return", async () => {
  const { manager, ptys } = fixture();
  await manager.create("project-a", "owner", project, {});
  manager.shutdownSync();
  assert.deepEqual(ptys[0].killed, ["SIGKILL"]);
});

test("JSON bodies require the expected content type and enforce streaming byte limits", async () => {
  await assert.rejects(terminalJson(new Request(origin, { method: "POST", body: "{}" })), /JSON/);
  await assert.rejects(terminalJson(new Request(origin, { method: "POST", headers: { "Content-Type": "application/json" }, body: "broken" })), /valid JSON/);
  await assert.rejects(terminalJson(request("POST", undefined, [])), /valid JSON/);
  await assert.rejects(terminalJson(request("POST", undefined, { data: "x".repeat(40000) })), /too large/);
  assert.deepEqual(await terminalJson(request("POST", undefined, { cols: 100, rows: 30 })), { cols: 100, rows: 30 });
});

test("routes enforce owner/project isolation for input, resize, stop and SSE, and reconnect honors Last-Event-ID", async () => {
  const { manager, ptys } = fixture();
  (globalThis as unknown as { __gridmindTerminalManager: TerminalManager }).__gridmindTerminalManager = manager;
  createProject({ id: "terminal-fixture", name: "Fixture", repo_path: project });
  createProject({ id: "terminal-other", name: "Another fixture", repo_path: project });
  const params = { params: Promise.resolve({ id: "terminal-fixture" }) };
  const denied = await createRoute(request("POST", undefined, {}, undefined, null), params);
  assert.equal(denied.status, 403); assert.equal(denied.headers.get("set-cookie"), null);
  const list = await listRoute(request(), params);
  assert.equal(list.status, 200);
  const cookie = list.headers.get("set-cookie")!.split(";")[0];
  const created = await createRoute(request("POST", undefined, { launcher: "shell" }, cookie), params);
  assert.equal(created.status, 201);
  const { terminal } = await created.json();
  const detail = { params: Promise.resolve({ id: "terminal-fixture", terminalId: terminal.id }) };
  const other = { params: Promise.resolve({ id: "terminal-other", terminalId: terminal.id }) };
  assert.equal((await inputRoute(request("POST", undefined, { data: "bad" }), detail)).status, 404);
  assert.equal((await resizeRoute(request("POST", undefined, { cols: 100, rows: 30 }), detail)).status, 404);
  assert.equal((await stopRoute(request("DELETE", undefined, undefined, cookie), other)).status, 404);
  assert.equal((await streamRoute(request("GET"), detail)).status, 404);
  assert.equal((await inputRoute(request("POST", undefined, { data: "hello\r" }, cookie), detail)).status, 200);
  assert.deepEqual(ptys[0].writes, ["hello\r"]);
  ptys[0].output("first"); ptys[0].output("second");
  const streamRequest = new Request(origin + "/api/projects/terminal-fixture/terminal/" + terminal.id + "/stream?after=0", {
    headers: { Host: "127.0.0.1:4317", Cookie: cookie, "Last-Event-ID": "1" },
  });
  const stream = terminalStream(streamRequest, "terminal-fixture", terminalOwner(streamRequest).owner, terminal.id);
  const reader = stream.body!.getReader();
  const ready = new TextDecoder().decode((await reader.read()).value);
  const output = new TextDecoder().decode((await reader.read()).value);
  assert.match(ready, /event: ready/); assert.match(output, /second/); assert.ok(!output.includes("first"));
  await reader.cancel();
  assert.equal((await stopRoute(request("DELETE", undefined, undefined, cookie), detail)).status, 200);
  assert.equal(ptys[0].killed.length, 1);
});
