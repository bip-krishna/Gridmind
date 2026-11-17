import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dataDir } from "../src/lib/db";
import { validatePrBranch, currentPrBranch, pushPrBranch, githubPushTargetMatches } from "../src/lib/github-pr";

test("pull-request Git commands preserve branch arguments and push only to a fixture remote", async () => {
  assert.ok(dataDir().includes("gridmind-"));
  const root = dataDir(), repo = path.join(root, "repo"), remote = path.join(root, "remote.git"), bin = path.join(root, "bin");
  for (const dir of [repo, bin]) fs.mkdirSync(dir, { recursive: true });
  const nativeGit = process.platform === "darwin" && fs.existsSync("/Library/Developer/CommandLineTools/usr/bin/git") ? "/Library/Developer/CommandLineTools/usr/bin/git" : "git";
  const run = (args: string[], cwd = repo) => {
    const result = spawnSync(nativeGit, args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  run(["init", "--bare", "-q", remote], root); run(["init", "-q"]);
  run(["config", "user.email", "fixture@example.test"]); run(["config", "user.name", "Fixture"]);
  run(["commit", "--allow-empty", "-qm", "fixture"]); run(["remote", "add", "origin", remote]);
  const branch = "feature/literal;semicolon";
  run(["checkout", "-qb", branch]);
  const originalPath = process.env.PATH;
  if (nativeGit !== "git") {
    fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\nexec ${nativeGit} "$@"\n`, { mode: 0o755 });
    process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
  }
  try {
    assert.equal(await currentPrBranch(repo), branch);
    assert.equal(await validatePrBranch(repo, branch), branch);
    for (const invalid of ["-u", "bad branch", "../../outside", "a\nb", 42, ""]) assert.equal(await validatePrBranch(repo, invalid), null);
    assert.equal(await githubPushTargetMatches(repo, { owner: "fixture", repo: "project" }), false);
    run(["remote", "set-url", "origin", "git@github.com:fixture/project.git"]);
    assert.equal(await githubPushTargetMatches(repo, { owner: "fixture", repo: "project" }), true);
    assert.equal(await githubPushTargetMatches(repo, { owner: "other", repo: "project" }), false);
    run(["remote", "set-url", "origin", remote]);
    await pushPrBranch(repo, branch);
    assert.match(run(["--git-dir", remote, "show-ref"]), /feature\/literal;semicolon/);
  } finally { process.env.PATH = originalPath; }
});
