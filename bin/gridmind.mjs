#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { initialize, doctor } from "../cli/setup.mjs";
import { projectInfo } from "../cli/project.mjs";
import { guiStatus, configureClaudeDesktop, prepareDesktopPlugin } from "../cli/gui.mjs";
import { tunnelPlan, runTunnel } from "../cli/tunnel.mjs";

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
  return argv[index + 1];
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || "help";
  const directory = option(argv, "--project") || process.cwd();
  if (command === "init") return console.log(JSON.stringify(initialize(directory, argv.includes("--dry-run")), null, 2));
  if (command === "doctor") return console.log(JSON.stringify(doctor(directory), null, 2));
  if (command === "gui") {
    const client = argv[1]?.startsWith("--") ? undefined : argv[1];
    const dryRun = argv.includes("--dry-run");
    const result = !client ? guiStatus(directory) : client === "claude-desktop" ? configureClaudeDesktop(directory, { dryRun })
      : client === "chatgpt-desktop" ? prepareDesktopPlugin(directory, { dryRun }) : null;
    if (!result) throw new Error("Supported GUI setup: gridmind gui claude-desktop or gridmind gui chatgpt-desktop. Use gridmind init for Codex, Cursor and VS Code; gridmind tunnel for ChatGPT web.");
    return console.log(JSON.stringify(result, null, 2));
  }
  if (command === "tunnel") {
    const plan = tunnelPlan(directory, { tunnelId: option(argv, "--tunnel-id") || process.env.CONTROL_PLANE_TUNNEL_ID, write: argv.includes("--write"), dryRun: argv.includes("--dry-run") });
    if (argv.includes("--dry-run")) return console.log(JSON.stringify(plan, null, 2));
    console.error(`Starting the private tunnel for ${plan.project_root} (${plan.read_only ? "read-only" : "shared memory writes enabled"}). Keep it running while ChatGPT uses this project. Readiness and a successful app tool call still need verification.`);
    return runTunnel(plan);
  }
  if (command === "mcp" || command === "connections" || command === "serve") {
    const portValue = command === "serve" ? option(argv, "--port") : undefined;
    const port = portValue === undefined ? undefined : Number(portValue);
    if (port !== undefined && (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 0 || port > 65535)) throw new Error("--port must be an integer from 0 to 65535");
    const info = projectInfo(directory, command !== "connections");
    if (!info.id) throw new Error("Run gridmind init in this project first");
    // Bootstrap before importing SQLite: the existing DB module captures its path at import time.
    process.env.GRIDMIND_DATA_DIR = info.directory;
    process.env.GRIDMIND_LOCAL_PROJECT = JSON.stringify(info);
    if (command === "serve") {
      const http = await import("../dist/memory/project-http.mjs");
      const server = await http.startHttp({ port, readOnly: !argv.includes("--write") });
      console.log(JSON.stringify({ url: server.url, token_file: server.tokenFile, read_only: server.readOnly, project_root: info.root,
        next: "Use the token from the owner-only file as an Authorization: Bearer header in your MCP client. This loopback endpoint is not directly reachable from cloud apps. Do not publish the token or put it in a URL." }, null, 2));
    } else {
      const local = await import("../dist/memory/project-mcp.mjs");
      if (command === "connections") console.log(JSON.stringify(local.connections(), null, 2));
      else await local.start({ readOnly: argv.includes("--read-only"), sharedOnly: argv.includes("--shared-only") });
    }
    return;
  }
  if (command !== "help" && command !== "--help") throw new Error(`Unknown command: ${command}`);
  console.log("Gridmind project memory\n\n  gridmind init [--project <folder>] [--dry-run]\n  gridmind doctor [--project <folder>]\n  gridmind gui [claude-desktop|chatgpt-desktop] [--dry-run]\n  gridmind mcp [--project <folder>] [--read-only] [--shared-only]\n  gridmind serve [--project <folder>] [--port 47831] [--write]\n  gridmind tunnel --tunnel-id <id> [--project <folder>] [--write] [--dry-run]\n  gridmind connections [--project <folder>]\n\nEvery command accepts --project <folder>. Local stdio needs no account or API token.\nChatGPT desktop local computer sessions share Codex MCP configuration; web uses a private tunnel.\nGUI setup prepares settings or a plugin; only a successful MCP call verifies connection.");
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Gridmind: ${error.message}`); process.exitCode = 1; });
}
