import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { db, dataDir, createProject, createSession, createMemory, createDecision, setContext, createTask, getSession, getTask } from "../src/lib/db";
import { retrieveMemories } from "../src/lib/memory";
import { retrieveProjectContext } from "../src/lib/project-context";
import { captureMemory, flushMemoryCaptures } from "../src/lib/memory-capture";
import { OpenCodeAdapter } from "../src/lib/agents";
import { startAgentSession } from "../src/lib/runner";
import { POST as searchPost, GET as searchGet } from "../src/app/api/internal/memory/retrieve/route";
import { GET as contextGet } from "../src/app/api/internal/context/route";
import { GET as dashboardContext } from "../src/app/api/projects/[id]/context/route";
import { GET as dashboardAgents } from "../src/app/api/projects/[id]/agents/route";
import { GET as healthGet } from "../src/app/api/health/route";
import { GridMindClient } from "../src/mcp/client";

const projectId = "regression-project";
const token = "fixture-token-A";
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

test("legacy database upgrades atomically and retains existing sessions", () => {
  fs.mkdirSync(dataDir(), { recursive: true });
  const legacy = new Database(path.join(dataDir(), "gridmind.db"));
  legacy.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY, project_id TEXT, agent_type TEXT, role TEXT,
    title TEXT, prompt TEXT, status TEXT, current_step TEXT, output TEXT,
    exit_code INTEGER, created_at INTEGER, started_at INTEGER, ended_at INTEGER
  ); INSERT INTO sessions (id, title, created_at) VALUES ('legacy-session', 'keep me', 1);`);
  legacy.close();
  const connection = db();
  assert.equal((connection.prepare("SELECT title FROM sessions WHERE id='legacy-session'").get() as {title:string}).title, "keep me");
  const names = (connection.prepare("PRAGMA table_info(sessions)").all() as {name:string}[]).map((c) => c.name);
  for (const name of ["token", "task_id", "result_commits"]) assert.ok(names.includes(name));
  assert.ok(connection.prepare("SELECT name FROM sqlite_master WHERE name='idx_sessions_task_id'").get());
  createProject({ id: projectId, name: "Fixture project", repo_path: "/nonexistent-gridmind-fixture" });
  createSession(projectId, { id: "session-A", agent_type: "opencode", role: "worker", title: "A", prompt: "", token });
  createSession(projectId, { id: "session-B", agent_type: "codex", role: "worker", title: "B", prompt: "", token: "fixture-token-B" });
});

test("cross-agent shared memory persists across server process restarts", () => {
  createMemory(projectId, { id: "shared", scope: "project_shared", type: "fact", content: "Shared durable fact", source: "agent" });
  createMemory(projectId, { id: "private", scope: "agent_private", type: "note", content: "Private session A note", session_id: "session-A", source: "agent" });
  const result = retrieveMemories({ projectId, sessionId: "session-B" });
  assert.ok(result.memories.some((m) => m.id === "shared"));
  assert.ok(!result.memories.some((m) => m.id === "private"));
  const child = spawnSync(process.execPath, ["-e", `const {db}=require('./.test-build/db.cjs'); const rows=db().prepare('SELECT content FROM memories WHERE id=?').all('shared'); console.log(JSON.stringify(rows));`], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /Shared durable fact/);
});

test("old and new decisions and project key-values reach worker context", async () => {
  setContext(projectId, "architecture", "SQLite local-first");
  createDecision(projectId, { id: "decision-1", title: "Preserve migrations", body: "Never delete existing memories." });
  createDecision(projectId, { id: "decision-old", title: "Obsolete", body: "Do not use." });
  db().prepare("UPDATE decisions SET status='superseded' WHERE id='decision-old'").run();
  const result = retrieveProjectContext({ projectId, sessionId: "session-B" });
  assert.match(result.contextBrief, /architecture: SQLite local-first/);
  assert.match(result.contextBrief, /Never delete existing memories/);
  assert.ok(!result.contextBrief.includes("Obsolete"));
  const response = await contextGet(new Request("http://localhost/api/internal/context", { headers }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.contextBrief, /SQLite local-first/);
  assert.match(body.contextBrief, /Preserve migrations/);
});

test("4000-character memories return bounded excerpts at default and small budgets", () => {
  createProject({ id: "long-project", name: "Long", repo_path: "/fixture" });
  createMemory("long-project", { id: "long", scope: "project_shared", type: "note", content: "Long knowledge --- ".repeat(220).slice(0,4000), source: "agent" });
  for (const budget of [1, 30, 100, 1000]) {
    const result = retrieveMemories({ projectId: "long-project", maxTokens: budget });
    assert.ok(result.tokensUsed <= budget, `${result.tokensUsed} > ${budget}`);
    if (budget >= 100) {
      assert.equal(result.memories.length, 1);
      assert.equal(result.memories[0].truncated, true);
      assert.match(result.contextBrief, /Long knowledge/);
    }
  }
});

test("scope, type, task, archive and project filters preserve isolation", () => {
  createMemory(projectId, { id: "task-only", scope: "task", task_id: "task-A", type: "constraint", content: "Task secret", source: "agent" });
  const filtered = retrieveMemories({ projectId, sessionId: "session-B", types: ["fact"] });
  assert.ok(filtered.memories.every((m) => m.type === "fact" && m.scope === "project_shared"));
  assert.ok(!retrieveMemories({ projectId, taskId: "task-B" }).memories.some((m) => m.id === "task-only"));
  assert.ok(retrieveMemories({ projectId, taskId: "task-A" }).memories.some((m) => m.id === "task-only"));
  db().prepare("UPDATE memories SET archived_at=1 WHERE id='shared'").run();
  assert.ok(!retrieveMemories({ projectId }).memories.some((m) => m.id === "shared"));
  db().prepare("UPDATE memories SET archived_at=NULL WHERE id='shared'").run();
});

test("MCP type filtering is forwarded to the HTTP API", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options?.body as string);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    await new GridMindClient({ token }).searchMemory({ category: "fact", query: "durable" });
    assert.deepEqual(requestBody.types, ["fact"]);
    assert.equal(requestBody.max_tokens, 1000);
  } finally { globalThis.fetch = originalFetch; }
});

test("retrieval rejects malformed filters and budgets rather than returning empty success", async () => {
  for (const body of [{ max_tokens: -1 }, { max_tokens: 0 }, { max_tokens: 1.5 }, { scopes: ["wrong"] }, { query: 5 }, null]) {
    const response = await searchPost(new Request("http://localhost/api/internal/memory/retrieve", { method: "POST", headers, body: JSON.stringify(body) }));
    assert.equal(response.status, 400);
  }
  const badGet = await searchGet(new Request("http://localhost/api/internal/memory/retrieve?max_tokens=oops", { headers }));
  assert.equal(badGet.status, 400);
  const good = await searchPost(new Request("http://localhost/api/internal/memory/retrieve", { method: "POST", headers, body: JSON.stringify({ types: ["fact"] }) }));
  assert.equal(good.status, 200);
  assert.ok((await good.json()).memories.every((m: {type:string}) => m.type === "fact"));
});

test("failed automatic capture is durable and retried without duplicate records", () => {
  db().exec("CREATE TRIGGER reject_capture BEFORE INSERT ON memories BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  const result = captureMemory(projectId, { scope: "project_shared", type: "fact", content: "Retry this engineering fact", source: "task" });
  assert.deepEqual(result, { captured: false, pending: 1 });
  db().exec("DROP TRIGGER reject_capture");
  assert.deepEqual(flushMemoryCaptures(projectId), { captured: true, pending: 0 });
  captureMemory(projectId, { scope: "project_shared", type: "fact", content: "Retry this engineering fact", source: "task" });
  flushMemoryCaptures(projectId);
  assert.equal((db().prepare("SELECT count(*) AS n FROM memories WHERE content='Retry this engineering fact'").get() as {n:number}).n, 1);
});

test("general dashboard reads omit session tokens and private/task memories", async () => {
  const params = { params: Promise.resolve({ id: projectId }) };
  const response = await dashboardContext(new Request("http://localhost/api/projects/x/context"), params);
  const body = await response.json();
  assert.ok(body.memories.every((m: {scope:string}) => m.scope === "project_shared"));
  const sessions = await dashboardAgents(new Request("http://localhost/api/projects/x/agents"), params);
  assert.ok((await sessions.json()).sessions.every((s: Record<string,unknown>) => !("token" in s)));
});

test("OpenCode step completion does not terminate an agent session", () => {
  const messages: {type:string}[] = [];
  new OpenCodeAdapter().onLine('{"type":"step_finish"}', (m) => messages.push(m));
  assert.ok(messages.length > 0);
  assert.ok(messages.every((m) => m.type !== "final"));
});

test("worktree provisioning failure stops a task before it can run in the main checkout", async () => {
  createTask(projectId, { id: "broken-worktree", title: "Cannot provision" });
  const result = await startAgentSession({ projectId, taskId: "broken-worktree", agentType: "opencode", title: "Fixture", prompt: "Must never execute" });
  assert.equal(getSession(projectId, result.session.id)?.current_step, "worktree-error");
  assert.equal(getTask(projectId, "broken-worktree")?.status, "failed");
});

test("health checks SQLite readiness", async () => {
  const response = await healthGet();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).database, "ready");
});

test("worker launch includes context and a final event cannot hide process failure", async () => {
  const repo = path.join(dataDir(), "runner-repo");
  const bin = path.join(dataDir(), "fixture-bin");
  const promptFile = path.join(dataDir(), "worker-prompt.json");
  fs.mkdirSync(repo);
  fs.mkdirSync(bin);
  const git = process.platform === "darwin" && fs.existsSync("/Library/Developer/CommandLineTools/usr/bin/git")
    ? "/Library/Developer/CommandLineTools/usr/bin/git" : "git";
  for (const args of [["init", "-q"], ["config", "user.email", "fixture@example.test"], ["config", "user.name", "Fixture"], ["commit", "--allow-empty", "-qm", "fixture"]]) {
    const result = spawnSync(git, args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const fixture = `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('fixture'); process.exit(0); }
require('node:fs').writeFileSync(${JSON.stringify(promptFile)}, JSON.stringify({prompt:process.argv.at(-1), cwd:process.cwd()}));
console.log(JSON.stringify({type:'result'}));
setTimeout(()=>process.exit(7), 250);
`;
  fs.writeFileSync(path.join(bin, "codex"), fixture, { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
  try {
    createProject({ id: "runner-project", name: "Runner fixture", repo_path: repo });
    setContext("runner-project", "worker-rule", "Keep durable state");
    createDecision("runner-project", { id: "worker-decision", title: "Use migrations", body: "Preserve data on upgrade" });
    createTask("runner-project", { id: "worker-task", title: "Worker fixture" });
    const { session } = await startAgentSession({ projectId: "runner-project", taskId: "worker-task", agentType: "codex", title: "Fixture", prompt: "Read the project" });
    assert.equal(getSession("runner-project", session.id)?.status, "running");
    for (let i = 0; i < 100 && getSession("runner-project", session.id)?.status === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(getSession("runner-project", session.id)?.status, "error");
    assert.equal(getSession("runner-project", session.id)?.exit_code, 7);
    assert.equal(getTask("runner-project", "worker-task")?.status, "failed");
    const delivered = JSON.parse(fs.readFileSync(promptFile, "utf8"));
    assert.match(delivered.prompt, /worker-rule: Keep durable state/);
    assert.match(delivered.prompt, /Preserve data on upgrade/);
    assert.notEqual(delivered.cwd, repo);
    assert.ok(!retrieveMemories({ projectId: "runner-project" }).memories.some((m) => m.content.startsWith("Task completed")));
  } finally { process.env.PATH = originalPath; }
});

test("migration failure rolls back schema changes instead of leaving a partial upgrade", () => {
  const dir = path.join(dataDir(), "bad-upgrade");
  fs.mkdirSync(dir);
  const fixture = new Database(path.join(dir, "gridmind.db"));
  fixture.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT, worktree_branch TEXT);
    INSERT INTO tasks VALUES ('a','p','duplicate'), ('b','p','duplicate');`);
  fixture.close();
  const child = spawnSync(process.execPath, ["-e", "require('./.test-build/db.cjs').db()"], {
    env: { ...process.env, GRIDMIND_DATA_DIR: dir }, encoding: "utf8",
  });
  assert.notEqual(child.status, 0);
  const after = new Database(path.join(dir, "gridmind.db"));
  assert.ok(!(after.prepare("PRAGMA table_info(sessions)").all() as {name:string}[]).some((c) => c.name === "token"));
  assert.equal((after.prepare("SELECT count(*) AS count FROM tasks").get() as {count:number}).count, 2);
  after.close();
});
