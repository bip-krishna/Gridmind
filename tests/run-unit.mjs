import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";
import path from "node:path";

mkdirSync(".test-build", { recursive: true });
await build({
  entryPoints: ["tests/memory-regression.ts"], outfile: ".test-build/memory-regression.cjs",
  bundle: true, platform: "node", format: "cjs", packages: "external",
});
await build({ entryPoints: ["src/lib/db.ts"], outfile: ".test-build/db.cjs", bundle: true, platform: "node", format: "cjs", packages: "external" });
const dataDir = mkdtempSync(path.join(tmpdir(), "gridmind-unit-"));
try {
  const result = spawnSync(process.execPath, ["--test", ".test-build/memory-regression.cjs"], {
    stdio: "inherit", env: { ...process.env, GRIDMIND_DATA_DIR: dataDir },
  });
  process.exitCode = result.status ?? 1;
} finally { rmSync(dataDir, { recursive: true, force: true }); }
