import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export function workspaceRoot(start = process.cwd()) {
  const directory = fs.realpathSync(path.resolve(start));
  try {
    return fs.realpathSync(execFileSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
    }).trim());
  } catch { return projectRoot(directory); }
}

/** A linked worktree and the main checkout use the same project store. */
export function projectRoot(start = process.cwd()) {
  const directory = fs.realpathSync(path.resolve(start));
  if (!fs.statSync(directory).isDirectory()) throw new Error("Project path must be a directory");
  try {
    const common = execFileSync("git", ["-C", directory, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
    }).trim();
    if (path.basename(common) === ".git") return fs.realpathSync(path.dirname(common));
  } catch { /* Non-Git folders are supported through the project manifest. */ }
  for (let dir = directory; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".gridmind", "project.json"))) return dir;
    if (path.dirname(dir) === dir) return directory;
  }
}

export function projectInfo(start = process.cwd(), create = false) {
  const root = projectRoot(start);
  const directory = path.join(root, ".gridmind");
  const file = path.join(directory, "project.json");
  for (const location of [directory, file]) {
    if (fs.existsSync(location) && fs.lstatSync(location).isSymbolicLink()) throw new Error("Project memory directory/manifest must not be a symlink");
  }
  if (!fs.existsSync(file) && create) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      fs.writeFileSync(file, JSON.stringify({ version: 1, id: randomUUID() }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    } catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  if (!fs.existsSync(file)) return { root, directory, id: null };
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.version !== 1 || typeof manifest.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(manifest.id)) {
    throw new Error("Invalid .gridmind/project.json; restore its backup instead of creating a different project ID");
  }
  return { root, directory, id: manifest.id };
}
