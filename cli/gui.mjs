import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parse, modify, applyEdits } from "jsonc-parser";
import { projectInfo } from "./project.mjs";

const launcher = fileURLToPath(new URL("../bin/gridmind.mjs", import.meta.url));
const pluginSchema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const mcpSchema = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

function assertNoSymlinks(file) {
  for (let location = path.resolve(file); ; location = path.dirname(location)) {
    try {
      if (fs.lstatSync(location).isSymbolicLink()) throw new Error(`Symlinked configuration was left intact: ${location}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (path.dirname(location) === location) return;
  }
}

function read(file) {
  assertNoSymlinks(file);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("Configuration must be a file smaller than 1 MiB");
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function objectConfig(text) {
  const errors = [];
  const value = parse(text ?? "{}", errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid JSON/JSONC; existing configuration was left intact");
  }
  return value;
}

function atomicWrite(file, value) {
  assertNoSymlinks(file);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, value, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function withLock(file, operation) {
  assertNoSymlinks(file);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.gridmind-lock`;
  let descriptor;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Another Gridmind setup is updating this configuration. Retry when it finishes.");
    throw error;
  }
  try { return operation(); }
  finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}

function backup(info, label, text) {
  const file = path.join(info.directory, "backups", `${Date.now()}-${randomUUID()}`, label);
  atomicWrite(file, text);
  return file;
}

function identity(info) {
  return info.id || `uninitialized_${createHash("sha256").update(info.root).digest("hex").slice(0,16)}`;
}

function stdio(info) {
  return { type: "stdio", command: process.execPath, args: [launcher, "mcp", "--project", info.root] };
}

function sameProjectServer(value, info) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.command === process.execPath
    && JSON.stringify(value.args) === JSON.stringify(stdio(info).args)
    && (!value.type || value.type === "stdio");
}

function claudeConfigFile(platform, home, env) {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude", "claude_desktop_config.json");
}

function claudePlan(info, file) {
  const before = read(file);
  const config = objectConfig(before);
  if (config.mcpServers !== undefined && (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers))) {
    throw new Error("Invalid mcpServers configuration; existing settings were left intact");
  }
  const serverName = `gridmind_${identity(info)}`;
  const existing = config.mcpServers?.[serverName];
  if (existing !== undefined && !sameProjectServer(existing, info)) {
    throw new Error(`The ${serverName} server already has another configuration and was left intact`);
  }
  const server = { ...existing, ...stdio(info) };
  const after = applyEdits(before ?? "{}\n", modify(before ?? "{}\n", ["mcpServers", serverName], server, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  }));
  return { before, after, serverName };
}

function appPaths(id, platform, home, env) {
  const names = { chatgpt: "ChatGPT", codex: "Codex", claude: "Claude", cursor: "Cursor", vscode: "Visual Studio Code" };
  const name = names[id];
  if (platform === "darwin") return [path.join("/Applications", `${name}.app`), path.join(home, "Applications", `${name}.app`)];
  if (platform === "win32") {
    const roots = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs"), env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean);
    const folders = id === "vscode" ? ["Microsoft VS Code"] : [name, name.toLowerCase()];
    return roots.flatMap((root) => folders.map((folder) => path.join(root, folder)));
  }
  const desktop = id === "vscode" ? "code" : id;
  return [path.join(home, ".local", "share", "applications", `${desktop}.desktop`), `/usr/share/applications/${desktop}.desktop`, `/opt/${name}`];
}

export function guiStatus(start, { platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const info = projectInfo(start);
  const configFile = claudeConfigFile(platform, home, env);
  const serverName = `gridmind_${identity(info)}`;
  let configured = false;
  let configError;
  try { configured = sameProjectServer(objectConfig(read(configFile)).mcpServers?.[serverName], info) === true; }
  catch (error) { configError = error.message; }
  const apps = [
    ["chatgpt", "ChatGPT"], ["codex", "Codex"], ["claude", "Claude Desktop"], ["cursor", "Cursor"], ["vscode", "Visual Studio Code"],
  ].map(([id, name]) => {
    const detectedAt = appPaths(id, platform, home, env).find((file) => fs.existsSync(file));
    return { id, name, detected: !!detectedAt, ...(detectedAt ? { detected_at: detectedAt } : {}) };
  });
  const directory = path.join(info.directory, "gui", "openai");
  const marketplaceFile = path.join(directory, ".agents", "plugins", "marketplace.json");
  let prepared = false;
  try {
    const manifest = objectConfig(read(path.join(directory, "plugin", "plugin.json")));
    const mcp = objectConfig(read(path.join(directory, "plugin", "mcp.json")));
    prepared = manifest.name === pluginName(info) && sameProjectServer(mcp.mcpServers?.gridmind, info)
      && objectConfig(read(marketplaceFile)).plugins?.some((entry) => entry.name === pluginName(info)) === true;
  } catch { /* A missing or modified bundle needs preparing again. */ }
  return { project_root: info.root, project_id: info.id, initialized: !!info.id, apps,
    claude_desktop: { config_file: configFile, server_name: serverName, configured, ...(configError ? { error: configError } : {}) },
    openai_plugin: { directory, marketplace_file: marketplaceFile, prepared },
    note: "Detection checks standard app locations. Prepared or configured settings become connected only after the app starts MCP and calls Gridmind." };
}

export function configureClaudeDesktop(start, { dryRun = false, platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const info = projectInfo(start, !dryRun);
  const file = claudeConfigFile(platform, home, env);
  function configure() {
    const plan = claudePlan(info, file);
    const changed = plan.before !== plan.after;
    let backupFile = null;
    if (changed && !dryRun) {
      if (plan.before !== null) backupFile = backup(info, "claude_desktop_config.json", plan.before);
      if (read(file) !== plan.before) throw new Error("Claude settings changed during setup. Retry to merge the latest settings.");
      atomicWrite(file, plan.after);
    }
    return { client: "claude-desktop", project_root: info.root, project_id: info.id, config_file: file,
      server_name: plan.serverName, changed, dry_run: dryRun, backup_file: backupFile,
      next: "Restart Claude Desktop, review the local MCP connection, then ask it to call gridmind_get_context for this project." };
  }
  return dryRun ? configure() : withLock(file, configure);
}

function pluginName(info) {
  return `gridmind-memory-${identity(info).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0,40)}`;
}

export function prepareDesktopPlugin(start, { dryRun = false } = {}) {
  const info = projectInfo(start, !dryRun);
  const directory = path.join(info.directory, "gui", "openai");
  assertNoSymlinks(directory);
  const name = pluginName(info);
  const projectName = path.basename(info.root);
  const marketplaceName = `gridmind-local-${identity(info).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0,40)}`;
  const marketplaceFile = path.join(directory, ".agents", "plugins", "marketplace.json");
  const contents = {
    "plugin/plugin.json": {
      $schema: pluginSchema, name, version: "0.1.0", description: `Shared project memory for ${projectName}`,
      extensions: { "com.openai": { interface: { displayName: `Gridmind · ${projectName}`,
        shortDescription: "Shared project memory", capabilities: ["Read", "Write"] }, requires_local_executor: true } },
    },
    "plugin/mcp.json": { $schema: mcpSchema, mcpServers: { gridmind: stdio(info) } },
    ".agents/plugins/marketplace.json": { name: marketplaceName, interface: { displayName: `Gridmind · ${projectName}` },
      plugins: [{ name, source: { source: "local", path: "./plugin" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity" }] },
  };
  function prepare() {
    const changes = [];
    for (const [relative, content] of Object.entries(contents)) {
      const file = path.join(directory, relative);
      const before = read(file);
      const after = JSON.stringify(content, null, 2) + "\n";
      if (before === after) continue;
      if (before !== null) {
        const existing = objectConfig(before);
        const owned = relative === "plugin/mcp.json" ? sameProjectServer(existing.mcpServers?.gridmind, info)
          : existing.name === content.name;
        if (!owned) throw new Error(`Conflicting generated plugin file was left intact: ${file}`);
      }
      changes.push({ relative, file, before, after });
    }
    const backups = [];
    if (!dryRun) {
      for (const change of changes) {
        if (change.before !== null) backups.push(backup(info, change.relative, change.before));
        if (read(change.file) !== change.before) throw new Error("Plugin files changed during setup. Retry to use the latest files.");
        atomicWrite(change.file, change.after);
      }
    }
    return { project_root: info.root, project_id: info.id, directory, marketplace_file: marketplaceFile,
      plugin_name: name, marketplace_name: marketplaceName, changed: changes.map((change) => change.relative),
      dry_run: dryRun, backup_files: backups,
      commands: [{ command: "codex", args: ["plugin", "marketplace", "add", directory] }],
      next: "Register this marketplace with Codex, restart the ChatGPT desktop app, then install Gridmind from the Plugins Directory and verify gridmind_get_context in a new project chat." };
  }
  return dryRun ? prepare() : withLock(path.join(directory, "plugin-setup"), prepare);
}
