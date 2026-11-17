import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// node-pty 1.1.0's macOS prebuild can arrive without its helper's execute bit.
// Keep installation reproducible without patching dependency source or asking
// users to repair node_modules manually (microsoft/node-pty#919).
if (process.platform === "darwin") {
  const require = createRequire(import.meta.url);
  const directory = path.dirname(require.resolve("node-pty/package.json"));
  for (const relative of [`prebuilds/darwin-${process.arch}/spawn-helper`, "build/Release/spawn-helper"]) {
    const file = path.join(directory, relative);
    if (!fs.existsSync(file)) continue;
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error("Unexpected node-pty spawn-helper file");
    if ((stat.mode & 0o111) !== 0o111) fs.chmodSync(file, stat.mode | 0o111);
  }
}
