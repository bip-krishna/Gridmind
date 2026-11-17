import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { projectInfo } from "../cli/project.mjs";
import { launcher } from "../cli/setup.mjs";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "gridmind-http-"));
const repo = path.join(temporary, "project with spaces");
fs.mkdirSync(repo);
const info = projectInfo(repo, true);
const bundle = fileURLToPath(new URL("../dist/memory/project-http.mjs", import.meta.url));
const active = new Set();
const servers = new Set();
const protocolVersion = "2025-11-25";
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities: {}, clientInfo: { name: "http-fixture", version: "1" } } };

async function launch({ readOnly = false, tokenFile } = {}) {
  // The child imports SQLite only after receiving the project-scoped environment.
  const code = `const {startHttp}=await import(${JSON.stringify(bundle)});const server=await startHttp(${JSON.stringify({ port: Number(process.env.GRIDMIND_HTTP_TEST_PORT || 0), readOnly, tokenFile })});console.log(JSON.stringify({url:server.url,tokenFile:server.tokenFile,readOnly:server.readOnly}));`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    cwd: repo, env: { ...process.env, GRIDMIND_LOCAL_PROJECT: JSON.stringify(info), GRIDMIND_DATA_DIR: info.directory }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "", errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk.toString(); });
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error("HTTP fixture did not become ready")); }, 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("\n")) {
        clearTimeout(timeout);
        try { resolve(JSON.parse(output.split("\n")[0])); } catch (error) { reject(error); }
      }
    });
    child.once("exit", (code) => { clearTimeout(timeout); if (!output.includes("\n")) reject(new Error(`HTTP fixture exited (${code}): ${errors}`)); });
  });
  const token = fs.readFileSync(ready.tokenFile, "utf8").trim();
  assert.ok(!output.includes(token), "Startup output must not contain the token");
  const handle = { ...ready, token, child, async close() {
    if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    servers.delete(handle);
  } };
  servers.add(handle);
  return handle;
}
async function connect(server, name = "gui-http-fixture") {
  const client = new Client({ name, version: "1" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${server.token}` } } });
  await client.connect(transport);
  const close = async () => { try { await transport.terminateSession(); } finally { await client.close(); active.delete(close); } };
  active.add(close);
  return { client, transport, close };
}
async function stdio(name, flags = []) {
  const client = new Client({ name, version: "1" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: [launcher, "mcp", "--project", repo, ...flags], cwd: temporary,
    env: { PATH: process.env.PATH || "", HOME: temporary, TMPDIR: temporary }, stderr: "pipe" });
  await client.connect(transport);
  const close = async () => { await client.close(); active.delete(close); };
  active.add(close);
  return { client, close };
}
async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, JSON.stringify(response));
  return JSON.parse(response.content[0].text);
}
function request(server, value, headers = {}) {
  return fetch(server.url, { method: "POST", headers: { Authorization: `Bearer ${server.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(value) });
}
function rawHostRequest(server) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(server.url, { method: "POST", headers: { Host: "untrusted.example", Authorization: `Bearer ${server.token}`, "Content-Type": "application/json" } }, (res) => {
      res.resume(); res.once("end", () => resolve(res.statusCode));
    });
    req.once("error", reject); req.end(JSON.stringify(init));
  });
}

test.after(async () => {
  await Promise.allSettled([...active].map((close) => close()));
  await Promise.allSettled([...servers].map((server) => server.close()));
  fs.rmSync(temporary, { recursive: true, force: true });
});

test("HTTP requires a project bearer credential, validates hosts/origins and bounds requests", async () => {
  const server = await launch();
  try {
    const stat = fs.statSync(server.tokenFile);
    if (process.platform !== "win32") assert.equal(stat.mode & 0o777, 0o600);
    for (const headers of [{ Authorization: "" }, { Authorization: "Bearer invalid-fixture" }]) assert.equal((await request(server, init, headers)).status, 401);
    assert.equal((await request(server, init, { Origin: "https://untrusted.example" })).status, 403);
    assert.equal(await rawHostRequest(server), 403);
    assert.equal((await request(server, init, { "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await fetch(server.url + `?token=${server.token}`, { method: "POST" })).status, 404);
    assert.equal((await request(server, { method: "tools/list", jsonrpc: "2.0", id: 2 })).status, 400);
    assert.equal((await request(server, init, { "Mcp-Session-Id": "missing-fixture-session" })).status, 404);
    assert.equal((await request(server, { ...init, padding: "x".repeat(70000) })).status, 413);
    const response = await fetch(server.url, { method: "POST", headers: { Authorization: `Bearer ${server.token}`, "Content-Type": "application/json" }, body: "not-json" });
    assert.equal(response.status, 400);
    assert.ok(!(await response.text()).includes(server.token));
  } finally { await server.close(); }
});

test("real GUI HTTP and stdio MCP clients share saved records and isolate private notes", async () => {
  const server = await launch();
  const [a, b, local] = await Promise.all([connect(server, "claude-gui-fixture"), connect(server, "cursor-gui-fixture"), stdio("codex-stdio-fixture")]);
  try {
    const tools = (await a.client.listTools()).tools;
    assert.equal(tools.length, 7);
    assert.equal(tools.find((t) => t.name === "gridmind_get_context").annotations.readOnlyHint, true);
    assert.equal(tools.find((t) => t.name === "gridmind_record_memory").annotations.readOnlyHint, false);
    assert.equal(tools.find((t) => t.name === "gridmind_set_context").annotations.destructiveHint, true);
    const identity = await call(a.client, "gridmind_get_session_context");
    assert.equal(identity.mode, "local-http-project-memory");
    assert.equal(identity.client.name, "claude-gui-fixture");
    await call(local.client, "gridmind_record_memory", { content: "HTTP clients see this durable stdio finding", category: "fact" });
    assert.match((await call(a.client, "gridmind_get_context")).contextBrief, /durable stdio finding/);
    await call(a.client, "gridmind_record_memory", { content: "HTTP durable shared finding", category: "constraint" });
    await call(a.client, "gridmind_record_memory", { content: "Only the first HTTP client sees this note", scope: "agent_private" });
    await call(a.client, "gridmind_set_context", { key: "mcp_transport", value: "Shared SQLite across HTTP and stdio" });
    await call(a.client, "gridmind_record_decision", { title: "Use project memory", body: "Keep saved engineering context available across GUI agents" });
    const first = await call(a.client, "gridmind_get_context");
    assert.match(first.contextBrief, /Only the first HTTP client/);
    const second = await call(b.client, "gridmind_get_context");
    assert.match(second.contextBrief, /HTTP durable shared finding/);
    assert.match(second.contextBrief, /Shared SQLite across HTTP and stdio/);
    assert.ok(!second.contextBrief.includes("Only the first HTTP client"));
    assert.ok(!(await call(local.client, "gridmind_get_context")).contextBrief.includes("Only the first HTTP client"));
    const resource = await b.client.readResource({ uri: "gridmind://project/context" });
    assert.match(resource.contents[0].text, /HTTP durable shared finding/);
    const invalid = await a.client.callTool({ name: "gridmind_record_memory", arguments: { content: "", scope: "agent_private" } });
    assert.equal(invalid.isError, true);
    const forged = await request(server, { jsonrpc: "2.0", id: 3, method: "tools/list" }, { "Mcp-Session-Id": a.transport.sessionId, Authorization: "Bearer invalid-fixture" });
    assert.equal(forged.status, 401, "A session ID must never replace bearer authorization");
  } finally { await Promise.all([a.close(), b.close(), local.close()]); await server.close(); }
});

test("HTTP reconnects after restart with persisted shared memory and read-only capability enforcement", async () => {
  const server = await launch({ readOnly: true });
  const connection = await connect(server);
  try {
    assert.equal(server.readOnly, true);
    const tools = (await connection.client.listTools()).tools;
    assert.equal(tools.length, 4);
    assert.ok(tools.every((tool) => tool.annotations.readOnlyHint));
    assert.match((await call(connection.client, "gridmind_get_context")).contextBrief, /HTTP durable shared finding/);
    const write = await connection.client.callTool({ name: "gridmind_record_memory", arguments: { content: "Read-only clients cannot save this" } });
    assert.equal(write.isError, true);
    const list = await call(connection.client, "gridmind_list_connections");
    assert.ok(list.some((row) => row.client === "claude-gui-fixture" && row.status === "disconnected"));
  } finally { await connection.close(); await server.close(); }
});

test("HTTP limits active sessions and DELETE releases a session slot", async () => {
  const server = await launch({ readOnly: true });
  const sessions = [];
  try {
    for (let i = 0; i < 32; i++) {
      const response = await request(server, { ...init, id: i + 1 });
      assert.equal(response.status, 200);
      await response.json();
      const session = response.headers.get("mcp-session-id");
      assert.ok(session);
      sessions.push(session);
    }
    assert.equal((await request(server, init)).status, 429);
    const deleted = await fetch(server.url, { method: "DELETE", headers: {
      Authorization: `Bearer ${server.token}`, "Mcp-Session-Id": sessions.shift(), "Mcp-Protocol-Version": protocolVersion,
    } });
    assert.equal(deleted.status, 200);
    assert.equal((await request(server, init)).status, 200);
  } finally { await server.close(); }
});

test("shared-only stdio used by tunnel profiles rejects private memory scopes", async () => {
  const connection = await stdio("tunnel-shared-fixture", ["--shared-only"]);
  try {
    const identity = await call(connection.client, "gridmind_get_session_context");
    assert.equal(identity.shared_only, true);
    const write = await connection.client.callTool({ name: "gridmind_record_memory", arguments: { content: "Tunnel must reject this private note", scope: "agent_private" } });
    assert.equal(write.isError, true);
    const read = await connection.client.callTool({ name: "gridmind_search_memory", arguments: { category: "agent_private" } });
    assert.equal(read.isError, true);
    await call(connection.client, "gridmind_record_memory", { content: "Verified shared-only tunnel finding" });
    assert.match((await call(connection.client, "gridmind_get_context")).contextBrief, /Verified shared-only tunnel finding/);
  } finally { await connection.close(); }
  const readOnly = await stdio("tunnel-read-only-fixture", ["--shared-only", "--read-only"]);
  try {
    assert.equal((await readOnly.client.listTools()).tools.length, 4);
    const identity = await call(readOnly.client, "gridmind_get_session_context");
    assert.equal(identity.read_only, true);
    assert.equal(identity.shared_only, true);
    const write = await readOnly.client.callTool({ name: "gridmind_record_memory", arguments: { content: "Read-only tunnel cannot save" } });
    assert.equal(write.isError, true);
  } finally { await readOnly.close(); }
});

test("HTTP refuses symlinked, malformed and broadly-readable bearer token files", async () => {
  const invalid = path.join(info.directory, "invalid-http-token");
  fs.writeFileSync(invalid, "short", { mode: 0o600 });
  await assert.rejects(launch({ tokenFile: invalid }), /Invalid HTTP token file/);
  const linked = path.join(info.directory, "linked-http-token");
  fs.symlinkSync(path.join(info.directory, "http-token"), linked);
  await assert.rejects(launch({ tokenFile: linked }));
  if (process.platform !== "win32") {
    const broad = path.join(info.directory, "broad-http-token");
    fs.writeFileSync(broad, "x".repeat(43), { mode: 0o644 });
    await assert.rejects(launch({ tokenFile: broad }), /owner-only permissions/);
  }
});
