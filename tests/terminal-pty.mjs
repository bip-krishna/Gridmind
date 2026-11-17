import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Run only through the disposable-server harness. No real agent is launched:
// its PATH provides an interactive OpenCode fixture and a temporary HOME.
const base = process.env.GRIDMIND_API;
if (!base || !process.env.GRIDMIND_TEST_PID_FILE) throw new Error("Run npm run test:integration; do not point this test at your own server.");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-pty-"));
const repo = path.join(root, "project with spaces");
fs.mkdirSync(repo);
execFileSync("git", ["init", "-q"], { cwd: repo });
let projectId, cookie;
const sessions = new Set();
const streams = new Set();

async function api(url, { method = "GET", body, owner = cookie, origin = base } = {}) {
  return fetch(base + url, { method, headers: { ...(owner ? { Cookie: owner } : {}),
    ...(origin ? { Origin: origin } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
}
function endpoint(id = "") { return `/api/projects/${projectId}/terminal${id ? `/${id}` : ""}`; }
async function json(response, status = 200) {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}
async function until(predicate, description) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function watch(id, after = 0) {
  const controller = new AbortController();
  const response = await fetch(base + endpoint(id) + `/stream?after=${after}`, {
    headers: { Cookie: cookie }, signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const state = { output: "", lastSeq: after, events: [], close() { controller.abort(); streams.delete(state); } };
  streams.add(state);
  void (async () => {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = "";
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        for (let index; (index = pending.indexOf("\n\n")) >= 0;) {
          const frame = pending.slice(0, index); pending = pending.slice(index + 2);
          const lines = frame.split("\n");
          const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
          const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
          const sequence = lines.find((line) => line.startsWith("id: "))?.slice(4);
          if (sequence) state.lastSeq = Number(sequence);
          if (!event || !data) continue;
          const value = JSON.parse(data); state.events.push({ type: event, ...value });
          if (event === "output") state.output += value.data;
        }
      }
    } catch (error) { if (!controller.signal.aborted) state.error = error; }
  })();
  return state;
}
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
async function input(id, data) { await json(await api(endpoint(id) + "/input", { method: "POST", body: { data } })); }
async function create(launcher) {
  const { terminal } = await json(await api(endpoint(), { method: "POST", body: { launcher, cols: 100, rows: 28 } }), 201);
  sessions.add(terminal.id); return terminal;
}
async function stop(id) { const value = await json(await api(endpoint(id), { method: "DELETE" })); sessions.delete(id); return value; }
function running(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

test.after(async () => {
  for (const stream of streams) stream.close();
  await Promise.allSettled([...sessions].map(stop));
  fs.rmSync(root, { recursive: true, force: true });
});

test("project terminal runs a real interactive PTY with resize, interrupt, replay and owner isolation", async () => {
  const project = await json(await api("/api/projects", { method: "POST", body: { name: "Terminal PTY fixture", repo_path: repo } }), 201);
  projectId = project.project.id;
  const response = await api(endpoint());
  cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const metadata = await json(response);
  assert.equal(metadata.sessions.length, 0, "Reading the terminal tab must not start a process");
  assert.ok(metadata.launchers.find((item) => item.id === "shell").available);
  const missingOrigin = await fetch(base + endpoint(), { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: '{"launcher":"shell"}' });
  assert.equal(missingOrigin.status, 403);
  assert.equal((await api(endpoint(), { method: "POST", origin: "https://untrusted.example", body: { launcher: "shell" } })).status, 403);
  const terminal = await create("shell");
  assert.equal(terminal.cwd, fs.realpathSync(repo));
  const stream = await watch(terminal.id);
  const code = 'console.log("GRIDMIND_"+"TTY="+process.stdin.isTTY);console.log("GRIDMIND_"+"CWD="+process.cwd())';
  await input(terminal.id, `${shellQuote(process.execPath)} -e ${shellQuote(code)}\r`);
  await until(() => stream.output.includes("GRIDMIND_TTY=true") && stream.output.includes(`GRIDMIND_CWD=${fs.realpathSync(repo)}`), "TTY and project cwd");
  await json(await api(endpoint(terminal.id) + "/resize", { method: "POST", body: { cols: 111, rows: 33 } }));
  await input(terminal.id, "stty size\r");
  await until(() => /(?:\r?\n)33 111(?:\r?\n)/.test(stream.output), "PTY window resize");
  await input(terminal.id, "printf '\\033[31mGRIDMIND_COLOR\\033[0m\\n'\r");
  await until(() => stream.output.includes("\x1b[31mGRIDMIND_COLOR\x1b[0m"), "ANSI color output");
  const background = 'console.log("GRIDMIND_"+"WAITING");setInterval(()=>{},1000)';
  await input(terminal.id, `${shellQuote(process.execPath)} -e ${shellQuote(background)}\r`);
  await until(() => stream.output.includes("GRIDMIND_WAITING"), "foreground fixture process");
  await input(terminal.id, "\x03");
  const after = 'console.log("GRIDMIND_"+"AFTER_INTERRUPT")';
  await input(terminal.id, `${shellQuote(process.execPath)} -e ${shellQuote(after)}\r`);
  await until(() => stream.output.includes("GRIDMIND_AFTER_INTERRUPT"), "Ctrl+C returning to the shell");
  assert.equal((await api(endpoint(terminal.id) + "/input", { method: "POST", owner: "gridmind_terminal_owner=" + "x".repeat(43), body: { data: "whoami\r" } })).status, 404);
  const sequence = stream.lastSeq; stream.close();
  const replayMarker = 'console.log("GRIDMIND_"+"REPLAY")';
  await input(terminal.id, `${shellQuote(process.execPath)} -e ${shellQuote(replayMarker)}\r`);
  const attached = await watch(terminal.id, sequence);
  await until(() => attached.output.includes("GRIDMIND_REPLAY"), "output replay after reconnect");
  assert.ok(!attached.output.includes("GRIDMIND_TTY=true"), "A resumed cursor must not repeat old output");
  await stop(terminal.id); attached.close();
});

test("one-click OpenCode uses the interactive fixture, and Stop terminates a foreground child", async () => {
  const terminal = await create("opencode");
  const stream = await watch(terminal.id);
  await until(() => stream.output.includes("Interactive agent fixture ready"), "interactive launcher output");
  const code = 'console.log("GRIDMIND_"+"CHILD_PID="+process.pid);setInterval(()=>{},1000)';
  await input(terminal.id, `${shellQuote(process.execPath)} -e ${shellQuote(code)}\r`);
  await until(() => /GRIDMIND_CHILD_PID=(\d+)/.test(stream.output), "child process PID");
  const pid = Number(/GRIDMIND_CHILD_PID=(\d+)/.exec(stream.output)[1]);
  assert.ok(running(pid));
  await stop(terminal.id);
  await until(() => !running(pid), "Stop killing the foreground child");
  assert.equal((await api(endpoint(terminal.id) + "/input", { method: "POST", body: { data: "ignored" } })).status, 409);
  stream.close();
});

test("stopping the owned Next server cleans up terminal children that ignore hangup and termination", async () => {
  const serverPid = Number(process.env.GRIDMIND_TEST_SERVER_PID);
  assert.ok(Number.isInteger(serverPid) && serverPid > 1 && serverPid !== process.pid);
  const terminal = await create("shell");
  const stream = await watch(terminal.id);
  const code = 'process.on("SIGHUP",()=>{});process.on("SIGTERM",()=>{});console.log("GRIDMIND_"+"SHUTDOWN_CHILD="+process.pid);setInterval(()=>{},1000)';
  await input(terminal.id, `${shellQuote(process.execPath)} -e ${shellQuote(code)}\r`);
  await until(() => /GRIDMIND_SHUTDOWN_CHILD=(\d+)\r?\n/.test(stream.output), "shutdown fixture PID");
  const pid = Number(/GRIDMIND_SHUTDOWN_CHILD=(\d+)\r?\n/.exec(stream.output)[1]);
  stream.close(); sessions.delete(terminal.id);
  process.kill(serverPid, "SIGTERM");
  try { await until(() => !running(pid), "Next shutdown terminating its stubborn child"); }
  catch (error) {
    try { console.error("Shutdown fixture observed state:", execFileSync("ps", ["-o", "pid=,ppid=,pgid=,stat=,lstart=", "-p", String(pid)], { encoding: "utf8" }).trim()); }
    catch (inspection) { console.error("Shutdown fixture state query failed:", inspection.message); }
    console.error("Shutdown fixture kill(0):", running(pid));
    throw error;
  } finally {
    if (running(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* It may have just exited. */ } }
  }
});
