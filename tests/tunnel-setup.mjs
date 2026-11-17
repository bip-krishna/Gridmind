import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tunnelPlan, runTunnel, shellCommand } from "../cli/tunnel.mjs";
import { launcher } from "../cli/setup.mjs";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gridmind-tunnel-")));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
function fixture(name) { const dir = path.join(root, name); fs.mkdirSync(dir); return dir; }

test("private tunnel dry run binds a single project, contains no key and changes no files", () => {
  const project = fixture("project with spaces and 'quotes' $()");
  const plan = tunnelPlan(project, { tunnelId: "tunnel_fixture_12345678", dryRun: true });
  assert.equal(plan.project_root, project);
  assert.equal(plan.read_only, true);
  assert.equal(plan.shared_only, true);
  assert.deepEqual(plan.required_environment, ["CONTROL_PLANE_API_KEY"]);
  assert.ok(plan.args.includes("env:CONTROL_PLANE_API_KEY"));
  assert.ok(plan.args.includes("--mcp.stdio-send-initialized-notification"));
  assert.match(plan.args[plan.args.indexOf("--mcp.command") + 1], /"--shared-only" "--read-only"$/);
  assert.match(plan.args[plan.args.indexOf("--mcp.command") + 1], /project with spaces/);
  assert.deepEqual(fs.readdirSync(project), []);
  const writable = tunnelPlan(project, { tunnelId: plan.tunnel_id, write: true, dryRun: true });
  assert.equal(writable.read_only, false);
  assert.ok(!writable.args.at(writable.args.indexOf("--mcp.command") + 1).includes("--read-only"));
  assert.throws(() => tunnelPlan(project, { tunnelId: "tunnel_bad; command" }), /--tunnel-id/);
  const unsupported = fixture("project with a\nnewline");
  assert.throws(() => tunnelPlan(unsupported, { tunnelId: plan.tunnel_id }), /control characters/);
  assert.deepEqual(fs.readdirSync(unsupported), []);
});

test("displayed POSIX commands preserve literal arguments without evaluating project names", { skip: process.platform === "win32" }, () => {
  const values = ["a b", "quoted'path", '"double"', "$(do-not-execute)", "`do-not-execute`", "a\\b", "a\nb"];
  const script = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";
  const result = spawnSync("/bin/sh", ["-c", shellCommand([process.execPath, "-e", script, "--", ...values])], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), values);
  assert.match(shellCommand(["node", "a'b"], "win32"), /^& 'node' 'a''b'$/);
});

test("tunnel runner passes the approved argument array and inherits a key without exposing it", { skip: process.platform === "win32" }, async () => {
  const project = fixture("runner");
  const bin = fixture("bin");
  const output = path.join(root, "tunnel-observation.json");
  const stub = path.join(bin, "tunnel-client");
  fs.writeFileSync(stub, `#!${process.execPath}\nconst fs = require('node:fs');\nfs.writeFileSync(process.env.GRIDMIND_TUNNEL_FIXTURE, JSON.stringify({args:process.argv.slice(2),hasKey:!!process.env.CONTROL_PLANE_API_KEY}));\n`, { mode: 0o700 });
  const plan = tunnelPlan(project, { tunnelId: "tunnel_fixture_12345678" });
  await assert.rejects(runTunnel(plan, {}), /CONTROL_PLANE_API_KEY/);
  const secret = "fixture-runtime-key-not-a-real-secret";
  await runTunnel(plan, { PATH: bin, CONTROL_PLANE_API_KEY: secret, GRIDMIND_TUNNEL_FIXTURE: output });
  const observation = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(observation.args, plan.args);
  assert.equal(observation.hasKey, true);
  assert.ok(!fs.readFileSync(output, "utf8").includes(secret));
  assert.ok(!JSON.stringify(plan).includes(secret));
});

test("CLI GUI and tunnel previews are project-aware and invalid ports fail before creating memory", () => {
  const project = fixture("CLI");
  const run = (...args) => spawnSync(process.execPath, [launcher, ...args, "--project", project], { encoding: "utf8", timeout: 10000 });
  const preview = run("gui", "chatgpt-desktop", "--dry-run");
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).dry_run, true);
  const tunnel = run("tunnel", "--tunnel-id", "tunnel_fixture_12345678", "--dry-run");
  assert.equal(tunnel.status, 0, tunnel.stderr);
  assert.equal(JSON.parse(tunnel.stdout).read_only, true);
  const invalid = run("serve", "--port", "wrong");
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--port/);
  assert.deepEqual(fs.readdirSync(project), []);
});
