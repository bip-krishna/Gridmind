import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

// Existing suites create/delete fixture repos. Keep every fixture, DB and agent
// command in a disposable directory; never point these suites at a user's server.
const allSuites = [
  "agent-api", "stage2-lifecycle", "audit-regression", "stage3-worktree",
  "stage4-memory", "stage4-retrieval", "stage4-security", "stage4-task-auth",
  "mcp-stage5a", "stage5b-handoffs", "stage5c-git-github", "terminal-pty",
];
const requested = process.argv.indexOf("--suite");
const selected = requested >= 0 ? process.argv[requested + 1] : null;
if (requested >= 0 && !allSuites.includes(selected)) throw new Error("Choose an existing integration suite with --suite <name>.");
const suites = selected ? [selected] : allSuites;
if (!fs.existsSync(".next/BUILD_ID") || !fs.existsSync("dist/mcp/cli.mjs")) {
  throw new Error("Run npm run build before the isolated integration suite.");
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), "gridmind-integration-"));
const bin = path.join(root, "bin");
const home = path.join(root, "home");
const repos = path.join(root, "repos");
fs.mkdirSync(".test-build", { recursive: true });
const testFiles = fs.mkdtempSync(path.join(".test-build", "integration-"));
for (const dir of [bin, home, repos]) fs.mkdirSync(dir);
for (const agent of ["opencode", "codex", "hermes"]) {
  fs.writeFileSync(path.join(bin, agent), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo fixture-agent; exit 0; fi\nif [ "$#" -eq 0 ]; then printf "Interactive agent fixture ready\\n"; exec /bin/sh -i; fi\necho "$$" >> "$GRIDMIND_TEST_PID_FILE"\nexec /bin/sleep 300\n', { mode: 0o755 });
}
// macOS /usr/bin/git invokes xcrun, whose cache is outside the fixture directory.
if (process.platform === "darwin" && fs.existsSync("/Library/Developer/CommandLineTools/usr/bin/git")) {
  fs.writeFileSync(path.join(bin, "git"), '#!/bin/sh\nexec /Library/Developer/CommandLineTools/usr/bin/git "$@"\n', { mode: 0o755 });
}
const pidFile = path.join(root, "fixture-pids");
function stopFixtures() {
  if (!fs.existsSync(pidFile)) return;
  for (const pid of fs.readFileSync(pidFile, "utf8").trim().split("\n").filter(Boolean).map(Number)) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ }
  }
  fs.writeFileSync(pidFile, "");
}
const port = process.env.GRIDMIND_TEST_PORT || "4317";
const base = `http://127.0.0.1:${port}`;
const env = {
  PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`,
  GRIDMIND_TEST_PID_FILE: pidFile,
  HOME: home, TMPDIR: root, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
  GRIDMIND_DATA_DIR: path.join(root, "data"), GRIDMIND_API: base, GRIDMIND_API_URL: base,
  GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1", PORT: port,
  NODE_OPTIONS: "--max-old-space-size=2048",
};
const log = fs.openSync(path.join(root, "server.log"), "w");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", port], {
  env, stdio: ["ignore", log, log],
});
let failures = 0;
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("Disposable test server exited before readiness");
    try {
      // Readiness must come from our child, never an unrelated server on this port.
      const ownServerReady = fs.readFileSync(path.join(root, "server.log"), "utf8").includes("Ready in");
      if (ownServerReady) {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && server.exitCode === null) { ready = true; break; }
      }
    } catch { /* wait for owned server */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Disposable test server did not become ready");
  for (const suite of suites) {
    const source = fs.readFileSync(`tests/${suite}.mjs`, "utf8");
    const file = path.join(testFiles, `${suite}.mjs`);
    fs.writeFileSync(file, source.replaceAll("/tmp/", `${repos}/`));
    const result = spawnSync(process.execPath, [file], { env: { ...env, GRIDMIND_TEST_SERVER_PID: String(server.pid) }, encoding: "utf8", timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
    stopFixtures();
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    const passed = result.status === 0;
    results.push({ suite, passed, summary: output.split("\n").filter((line) => /Results:|passed.*failed|PASSED|FAILED|ALL.*PASS/i.test(line)).slice(-3) });
    console.log(`${passed ? "PASS" : "FAIL"} ${suite}`, results.at(-1).summary.join(" "));
    if (!passed) { failures++; console.log(output.slice(-16000)); }
  }
  fs.writeFileSync(".test-build/integration-results.json", JSON.stringify(results, null, 2));
  console.log(`Integration suites: ${suites.length - failures} passed, ${failures} failed. Real agent execution disabled.`);
  process.exitCode = failures ? 1 : 0;
} catch (error) {
  console.error(error);
  console.error(fs.readFileSync(path.join(root, "server.log"), "utf8").slice(-10000));
  process.exitCode = 1;
} finally {
  stopFixtures();
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", resolve);
    const timeout = setTimeout(() => { server.kill("SIGKILL"); }, 3000);
    timeout.unref();
  });
  fs.closeSync(log);
  fs.rmSync(testFiles, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}
