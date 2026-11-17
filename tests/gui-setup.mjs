import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "jsonc-parser";
import { configureClaudeDesktop, guiStatus, prepareDesktopPlugin } from "../cli/gui.mjs";
import { projectInfo } from "../cli/project.mjs";
import { launcher } from "../cli/setup.mjs";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gridmind-gui-")));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
function fixture(name) {
  const project = path.join(root, name, "project with spaces");
  const home = path.join(root, name, "home");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { project, home, options: { platform: "darwin", home, env: {} } };
}

test("Claude Desktop setup preserves existing settings and comments with an explicit project and backup", () => {
  const { project, home, options } = fixture("claude-merge");
  const file = path.join(home, "Library/Application Support/Claude/claude_desktop_config.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = '{\n // Existing desktop preference\n "theme":"dark",\n "mcpServers":{"other":{"command":"other-mcp"}}\n}\n';
  fs.writeFileSync(file, original);
  const result = configureClaudeDesktop(project, options);
  assert.equal(result.changed, true);
  assert.equal(result.server_name, `gridmind_${projectInfo(project).id}`);
  assert.equal(fs.readFileSync(result.backup_file, "utf8"), original);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /Existing desktop preference/);
  const config = parse(text);
  assert.equal(config.theme, "dark");
  assert.equal(config.mcpServers.other.command, "other-mcp");
  assert.deepEqual(config.mcpServers[result.server_name], { type: "stdio", command: process.execPath,
    args: [launcher, "mcp", "--project", project] });
  assert.equal(configureClaudeDesktop(project, options).changed, false);
  assert.equal(guiStatus(project, options).claude_desktop.configured, true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("multiple projects get distinct Claude Desktop server entries", () => {
  const { project, options } = fixture("claude-multiple");
  const other = path.join(root, "another project");
  fs.mkdirSync(other);
  const first = configureClaudeDesktop(project, options);
  const second = configureClaudeDesktop(other, options);
  assert.notEqual(first.server_name, second.server_name);
  const config = parse(fs.readFileSync(first.config_file, "utf8"));
  assert.deepEqual(config.mcpServers[first.server_name].args, [launcher, "mcp", "--project", project]);
  assert.deepEqual(config.mcpServers[second.server_name].args, [launcher, "mcp", "--project", other]);
});

test("GUI dry runs and status detection create no project or home files", () => {
  const { project, home, options } = fixture("dry-run");
  const status = guiStatus(project, options);
  assert.equal(status.initialized, false);
  assert.equal(status.claude_desktop.configured, false);
  assert.equal(status.openai_plugin.prepared, false);
  assert.ok(status.apps.some((app) => app.id === "chatgpt"));
  assert.ok(status.apps.every((app) => typeof app.detected === "boolean"));
  assert.equal(configureClaudeDesktop(project, { ...options, dryRun: true }).changed, true);
  assert.equal(prepareDesktopPlugin(project, { dryRun: true }).changed.length, 3);
  assert.deepEqual(fs.readdirSync(project), []);
  assert.deepEqual(fs.readdirSync(home), []);
});

test("malformed and conflicting desktop settings are preserved", () => {
  const { project, options } = fixture("invalid");
  const valid = configureClaudeDesktop(project, options);
  for (const text of ["{broken", "null", "[]", '{"mcpServers":[]}']) {
    fs.writeFileSync(valid.config_file, text);
    assert.throws(() => configureClaudeDesktop(project, options), /Invalid/);
    assert.equal(fs.readFileSync(valid.config_file, "utf8"), text);
  }
  const custom = JSON.stringify({ mcpServers: { [valid.server_name]: { command: "custom-server", args: ["other-project"] } } });
  fs.writeFileSync(valid.config_file, custom);
  assert.throws(() => configureClaudeDesktop(project, options), /another configuration/);
  assert.equal(fs.readFileSync(valid.config_file, "utf8"), custom);
  assert.equal(guiStatus(project, options).claude_desktop.configured, false);
});

test("symlinked desktop files, ancestors and generated plugin paths remain untouched", () => {
  const { project, home, options } = fixture("symlinks");
  const outside = path.join(root, "outside.json");
  fs.writeFileSync(outside, "{}\n");
  const file = path.join(home, "Library/Application Support/Claude/claude_desktop_config.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(outside, file);
  assert.throws(() => configureClaudeDesktop(project, options), /Symlinked/);
  assert.equal(fs.readFileSync(outside, "utf8"), "{}\n");
  fs.unlinkSync(file);
  fs.rmdirSync(path.dirname(file));
  fs.symlinkSync(path.dirname(outside), path.dirname(file));
  assert.throws(() => configureClaudeDesktop(project, options), /Symlinked/);
  const info = projectInfo(project);
  fs.mkdirSync(path.join(info.directory, "gui"), { recursive: true });
  fs.symlinkSync(root, path.join(info.directory, "gui", "openai"));
  assert.throws(() => prepareDesktopPlugin(project), /Symlinked/);
  assert.equal(fs.readFileSync(outside, "utf8"), "{}\n");
});

test("OpenAI desktop plugin preparation uses portable manifests and a project-bound local marketplace", () => {
  const { project, options } = fixture("plugin");
  const result = prepareDesktopPlugin(project);
  assert.equal(result.changed.length, 3);
  const manifest = JSON.parse(fs.readFileSync(path.join(result.directory, "plugin/plugin.json"), "utf8"));
  const mcp = JSON.parse(fs.readFileSync(path.join(result.directory, "plugin/mcp.json"), "utf8"));
  const marketplace = JSON.parse(fs.readFileSync(result.marketplace_file, "utf8"));
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.match(manifest.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  assert.ok(manifest.name.length <= 64);
  assert.equal(manifest.extensions["com.openai"].requires_local_executor, true);
  assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  assert.deepEqual(mcp.mcpServers.gridmind, { type: "stdio", command: process.execPath,
    args: [launcher, "mcp", "--project", project] });
  assert.equal(marketplace.plugins[0].name, manifest.name);
  assert.equal(marketplace.plugins[0].source.path, "./plugin");
  assert.deepEqual(marketplace.plugins[0].policy, { installation: "AVAILABLE", authentication: "ON_INSTALL" });
  assert.equal(marketplace.plugins[0].category, "Productivity");
  assert.deepEqual(result.commands, [{ command: "codex", args: ["plugin", "marketplace", "add", result.directory] }]);
  assert.equal(guiStatus(project, options).openai_plugin.prepared, true);
  assert.deepEqual(prepareDesktopPlugin(project).changed, []);
  assert.ok(!fs.existsSync(path.join(project, ".agents")));
  assert.ok(!fs.existsSync(path.join(project, ".codex")));
});

test("plugin setup preserves conflicts and standard app detection respects platform paths", () => {
  const { project, home, options } = fixture("conflict");
  const result = prepareDesktopPlugin(project);
  const file = path.join(result.directory, "plugin/mcp.json");
  const custom = JSON.stringify({ mcpServers: { gridmind: { command: "another-server" } } });
  fs.writeFileSync(file, custom);
  assert.throws(() => prepareDesktopPlugin(project), /Conflicting/);
  assert.equal(fs.readFileSync(file, "utf8"), custom);
  fs.mkdirSync(path.join(home, "Applications/ChatGPT.app"), { recursive: true });
  assert.equal(guiStatus(project, options).apps.find((app) => app.id === "chatgpt").detected, true);
  const windowsHome = path.join(root, "windows-home");
  const windows = guiStatus(project, { platform: "win32", home: windowsHome, env: { APPDATA: path.join(windowsHome, "Roaming") } });
  assert.equal(windows.claude_desktop.config_file, path.join(windowsHome, "Roaming/Claude/claude_desktop_config.json"));
  const linux = guiStatus(project, { platform: "linux", home, env: { XDG_CONFIG_HOME: path.join(home, "config") } });
  assert.equal(linux.claude_desktop.config_file, path.join(home, "config/Claude/claude_desktop_config.json"));
});
