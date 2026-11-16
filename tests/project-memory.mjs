import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { parse as parseJson } from "jsonc-parser";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { initialize, doctor, launcher } from "../cli/setup.mjs";
import { projectInfo, projectRoot } from "../cli/project.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gridmind-project-"));
const repo = path.join(root, "project with spaces");
fs.mkdirSync(repo);
const run = (args, cwd = repo) => spawnSync(process.execPath, [launcher, ...args], { cwd, encoding: "utf8", timeout: 10000 });
const git = process.platform === "darwin" && fs.existsSync("/Library/Developer/CommandLineTools/usr/bin/git")
  ? "/Library/Developer/CommandLineTools/usr/bin/git" : "git";
const clients = [];
test.after(async () => {
  await Promise.allSettled(clients.map((client) => client.close()));
  fs.rmSync(root, { recursive: true, force: true });
});

test("one init configures supported clients, preserves comments/settings and adds guidance", () => {
  fs.mkdirSync(path.join(repo, ".codex"));
  fs.writeFileSync(path.join(repo, ".codex/config.toml"), '# existing preference\nmodel = "existing-model"\n[mcp_servers.other]\ncommand = "other-mcp"\n');
  fs.writeFileSync(path.join(repo, "opencode.jsonc"), '{\n // keep this comment\n "theme":"existing",\n}\n');
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Existing project rules\nKeep existing behavior.\n");
  const result = initialize(repo);
  assert.equal(result.skipped.length, 0, JSON.stringify(result.skipped));
  assert.equal(result.changed.length, 8);
  const codexText = fs.readFileSync(path.join(repo, ".codex/config.toml"), "utf8");
  const codex = parseToml(codexText);
  assert.ok(codexText.includes("# existing preference"));
  assert.equal(codex.model, "existing-model");
  assert.equal(codex.mcp_servers.other.command, "other-mcp");
  assert.deepEqual(codex.mcp_servers.gridmind.args, [launcher, "mcp", "--project", repo]);
  const opencodeText = fs.readFileSync(path.join(repo, "opencode.jsonc"), "utf8");
  assert.ok(opencodeText.includes("keep this comment"));
  assert.equal(parseJson(opencodeText).theme, "existing");
  for (const file of [".mcp.json", ".cursor/mcp.json"]) {
    const config = parseJson(fs.readFileSync(path.join(repo, file), "utf8"));
    assert.deepEqual(config.mcpServers.gridmind.args, codex.mcp_servers.gridmind.args);
  }
  assert.match(fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8"), /Keep existing behavior/);
  assert.ok(fs.existsSync(path.join(repo, ".gridmind/backups")));
});

test("repeated init is idempotent, doctor distinguishes configured from connected", () => {
  assert.deepEqual(initialize(repo).changed, []);
  const info = doctor(repo);
  assert.equal(info.initialized, true);
  assert.ok(info.clients.every((c) => c.configured));
  assert.match(info.note, /does not mean connected/);
});

test("dry run creates no project state or client files", () => {
  const dir = path.join(root, "dry"); fs.mkdirSync(dir);
  const output = initialize(dir, true);
  assert.ok(output.changed.includes("AGENTS.md"));
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("malformed, custom and symlinked client configurations are not overwritten", () => {
  const dir = path.join(root, "conflicts"); fs.mkdirSync(dir);
  fs.mkdirSync(path.join(dir, ".codex"));
  fs.writeFileSync(path.join(dir, ".codex/config.toml"), '[mcp_servers."gridmind"]\ncommand="custom"\n');
  fs.writeFileSync(path.join(dir, ".mcp.json"), '{"mcpServers":broken');
  const outside = path.join(root, "outside.json"); fs.writeFileSync(outside, "{}\n");
  fs.mkdirSync(path.join(dir, ".cursor")); fs.symlinkSync(outside, path.join(dir, ".cursor/mcp.json"));
  const output = initialize(dir);
  assert.equal(output.skipped.length, 3);
  assert.match(fs.readFileSync(path.join(dir, ".codex/config.toml"), "utf8"), /custom/);
  assert.equal(fs.readFileSync(path.join(outside), "utf8"), "{}\n");
  assert.equal(fs.readFileSync(path.join(dir, ".mcp.json"), "utf8"), '{"mcpServers":broken');
});

test("existing OpenCode V1 configuration is detected without choosing an agent", () => {
  const dir = path.join(root, "v1"); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "opencode.json"), '{"mcp":{"other":{"type":"local","command":["other"]}}}');
  const output = initialize(dir);
  assert.equal(output.opencode_version, 1);
  const config = JSON.parse(fs.readFileSync(path.join(dir, "opencode.json"), "utf8"));
  assert.ok(config.mcp.gridmind);
  assert.ok(config.mcp.other);
});

test("CLI works through the symlink used by an npm global install", () => {
  const link = path.join(root, "gridmind"); fs.symlinkSync(launcher, link);
  const result = spawnSync(process.execPath, [link, "doctor", "--project", repo], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).root, repo);
});

test("main checkout, subfolders and linked worktrees share one project identity", () => {
  const main = path.join(root, "git-project"); fs.mkdirSync(main);
  for (const args of [["init", "-q"], ["config", "user.email", "fixture@example.test"], ["config", "user.name", "Fixture"], ["commit", "--allow-empty", "-qm", "fixture"]]) {
    const result = spawnSync(git, args, { cwd: main, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  initialize(main);
  const worktree = path.join(root, "worktree");
  const result = spawnSync(git, ["worktree", "add", "-qb", "fixture-worker", worktree], { cwd: main, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const nested = path.join(worktree, "nested"); fs.mkdirSync(nested);
  initialize(nested);
  assert.ok(fs.existsSync(path.join(worktree, ".codex/config.toml")));
  assert.equal(projectRoot(nested), main);
  assert.equal(projectInfo(nested).id, projectInfo(main).id);
});

async function connect(name, directory = repo) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [launcher, "mcp", "--project", directory], cwd: root,
    env: { PATH: process.env.PATH || "", HOME: root, TMPDIR: root }, stderr: "pipe" });
  let errors = "";
  transport.stderr?.on("data", (chunk) => { errors += chunk.toString(); });
  const client = new Client({ name, version: "fixture-1" }, { capabilities: {} });
  clients.push(client);
  try { await client.connect(transport); } catch (error) { throw new Error(`${error.message}: ${errors}`); }
  return client;
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}

test("two real MCP processes share saved memory, auto-register client names and isolate private notes", async () => {
  const [a, b] = await Promise.all([connect("codex-fixture"), connect("opencode-fixture")]);
  try {
    assert.equal((await a.listTools()).tools.length, 7);
    const identity = await call(a, "gridmind_get_session_context");
    assert.equal(identity.project_id, projectInfo(repo).id);
    assert.equal(identity.client.name, "codex-fixture");
    await call(a, "gridmind_record_memory", { content: "Other clients must preserve legacy migrations", category: "constraint" });
    await call(a, "gridmind_record_memory", { scope: "agent_private", content: "Private session detail" });
    await call(a, "gridmind_set_context", { key: "database", value: "SQLite shared memory" });
    await call(a, "gridmind_record_decision", { title: "Use MCP", body: "Share verified facts across clients" });
    const context = await call(b, "gridmind_get_context");
    assert.match(context.contextBrief, /preserve legacy migrations/);
    assert.match(context.contextBrief, /SQLite shared memory/);
    assert.match(context.contextBrief, /Share verified facts/);
    assert.ok(!context.contextBrief.includes("Private session detail"));
    const found = await call(b, "gridmind_search_memory", { category: "constraint", query: "migrations" });
    assert.ok(found.memories.every((m) => m.type === "constraint"));
    const list = await call(b, "gridmind_list_connections");
    assert.ok(list.some((c) => c.client === "codex-fixture"));
    assert.ok(list.some((c) => c.client === "opencode-fixture"));
    const resource = await b.readResource({ uri: "gridmind://project/context" });
    assert.match(resource.contents[0].text, /SQLite shared memory/);
  } finally { await Promise.all([a.close(), b.close()]); }
});

test("new clients see persistent project memory after restart; another folder cannot see it", async () => {
  const other = path.join(root, "other-project"); fs.mkdirSync(other); initialize(other);
  const [again, isolated] = await Promise.all([connect("cursor-fixture"), connect("isolated-fixture", other)]);
  try {
    assert.match((await call(again, "gridmind_get_context")).contextBrief, /preserve legacy migrations/);
    assert.ok(!(await call(isolated, "gridmind_get_context")).contextBrief.includes("preserve legacy migrations"));
  } finally { await Promise.all([again.close(), isolated.close()]); }
  const output = run(["connections"]);
  assert.equal(output.status, 0, output.stderr);
  const list = JSON.parse(output.stdout);
  assert.ok(list.some((c) => c.client === "cursor-fixture" && c.status === "disconnected"));
});

test("six simultaneous clients can bootstrap a new store and save without lost writes", async () => {
  const dir = path.join(root, "concurrent-project"); fs.mkdirSync(dir); initialize(dir);
  const connected = await Promise.all(Array.from({ length: 6 }, (_, i) => connect(`parallel-client-${i}`, dir)));
  try {
    await Promise.all(connected.map((client, i) => call(client, "gridmind_record_memory", {
      category: "fact", content: `Parallel durable finding ${i}`,
    })));
    const result = await call(connected[0], "gridmind_search_memory", { query: "Parallel durable finding" });
    assert.equal(result.memories.filter((m) => m.content.startsWith("Parallel durable finding")).length, 6);
  } finally { await Promise.all(connected.map((client) => client.close())); }
});

test("installable package exposes a single gridmind command without a web build", () => {
  const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  assert.equal(manifest.bin.gridmind, "bin/gridmind.mjs");
  assert.equal(manifest.scripts.prepare, "npm run build:memory");
});
