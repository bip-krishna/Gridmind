#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { initialize, doctor } from "../cli/setup.mjs";
import { projectInfo } from "../cli/project.mjs";

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || "help";
  const projectIndex = argv.indexOf("--project");
  if (projectIndex >= 0 && (!argv[projectIndex + 1] || argv[projectIndex + 1].startsWith("--"))) throw new Error("--project requires a directory");
  const directory = projectIndex >= 0 ? argv[projectIndex + 1] : process.cwd();
  if (command === "init") return console.log(JSON.stringify(initialize(directory, argv.includes("--dry-run")), null, 2));
  if (command === "doctor") return console.log(JSON.stringify(doctor(directory), null, 2));
  if (command === "mcp" || command === "connections") {
    const info = projectInfo(directory, command === "mcp");
    if (!info.id) throw new Error("Run gridmind init in this project first");
    // Bootstrap before importing SQLite: the existing DB module captures its path at import time.
    process.env.GRIDMIND_DATA_DIR = info.directory;
    process.env.GRIDMIND_LOCAL_PROJECT = JSON.stringify(info);
    const local = await import("../dist/memory/project-mcp.mjs");
    if (command === "connections") console.log(JSON.stringify(local.connections(), null, 2));
    else await local.start();
    return;
  }
  if (command !== "help" && command !== "--help") throw new Error(`Unknown command: ${command}`);
  console.log("Gridmind project memory\n\n  gridmind init [--project <folder>] [--dry-run]\n  gridmind doctor [--project <folder>]\n  gridmind mcp [--project <folder>]\n  gridmind connections [--project <folder>]\n\nNo dashboard, API token or agent-name argument is needed for local memory.");
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Gridmind: ${error.message}`); process.exitCode = 1; });
}
