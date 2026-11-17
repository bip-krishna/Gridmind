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
await build({ entryPoints: ["tests/github-integration.ts"], outfile: ".test-build/github-integration.cjs", bundle: true, platform: "node", format: "cjs", packages: "external" });
await build({ entryPoints: ["tests/github-pr.ts"], outfile: ".test-build/github-pr.cjs", bundle: true, platform: "node", format: "cjs", packages: "external" });
const dataDir = mkdtempSync(path.join(tmpdir(), "gridmind-unit-"));
try {
  for (const suite of ["memory-regression", "github-integration", "github-pr"]) {
    const result = spawnSync(process.execPath, ["--test", `.test-build/${suite}.cjs`], {
      stdio: "inherit", env: { ...process.env, GRIDMIND_DATA_DIR: path.join(dataDir, suite) },
    });
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
} finally { rmSync(dataDir, { recursive: true, force: true }); }
