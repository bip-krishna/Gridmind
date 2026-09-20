import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

export const execAsync = promisify(exec);

export class GitError extends Error {
  constructor(public readonly command: string, public readonly stderr: string) {
    super(`git ${command} failed: ${stderr.trim()}`);
  }
}

export async function runGit(cwd: string, args: string[], options?: { allowFail?: boolean }): Promise<string> {
  const cmd = `git ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`;
  try {
    const { stdout } = await execAsync(cmd, { cwd, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
    return stdout;
  } catch (err: unknown) {
    if (options?.allowFail) {
      const e = err as { stdout?: string; stderr?: string };
      return e.stdout ?? e.stderr ?? "";
    }
    const e = err as { stderr?: string; stdout?: string };
    throw new GitError(cmd, e.stderr ?? String(err));
  }
}

export type GitRepoInfo = {
  isRepo: boolean;
  branch: string;
  remote: string | null;
  filesChanged: number;
  dirty: boolean;
};

export type GitCommit = {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  dateTs: number;
};

export type GitDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  hunks: string;
};

export type MergeConflict = {
  fileName: string;
};

const repoInfoCache = new Map<string, GitRepoInfo>();

export function invalidateRepoInfo(repoPath: string): void {
  repoInfoCache.delete(repoPath);
}

export async function getRepoInfo(repoPath: string): Promise<GitRepoInfo> {
  const cached = repoInfoCache.get(repoPath);
  if (cached) return cached;
  let info: GitRepoInfo;
  try {
    const check = await runGit(repoPath, ["rev-parse", "--is-inside-work-tree"], { allowFail: true });
    if (check.trim() !== "true") {
      info = { isRepo: false, branch: "", remote: null, filesChanged: 0, dirty: false };
    } else {
      const [branch, remote] = await Promise.all([
        runGit(repoPath, ["branch", "--show-current"], { allowFail: true }),
        runGit(repoPath, ["remote", "get-url", "origin"], { allowFail: true }),
      ]);
      const status = await runGit(repoPath, ["status", "--porcelain"], { allowFail: true });
      const changed = status.trim().split("\n").filter((l) => l.trim().length > 0);
      info = {
        isRepo: true,
        branch: branch.trim(),
        remote: remote.trim() || null,
        filesChanged: changed.length,
        dirty: changed.length > 0,
      };
    }
  } catch {
    info = { isRepo: false, branch: "", remote: null, filesChanged: 0, dirty: false };
  }
  if (info.isRepo) {
    repoInfoCache.set(repoPath, info);
  }
  return info;
}

export async function listBranches(repoPath: string): Promise<string[]> {
  const out = await runGit(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
    allowFail: true,
  });
  return out.trim().split("\n").filter(Boolean);
}

export async function createBranch(repoPath: string, name: string): Promise<void> {
  await runGit(repoPath, ["checkout", "-b", name]);
  invalidateRepoInfo(repoPath);
}

export async function checkoutBranch(repoPath: string, name: string): Promise<void> {
  await runGit(repoPath, ["checkout", name]);
  invalidateRepoInfo(repoPath);
}

export async function commitAll(repoPath: string, message: string): Promise<string> {
  await runGit(repoPath, ["add", "-A"]);
  const result = await runGit(repoPath, ["commit", "-m", message]);
  invalidateRepoInfo(repoPath);
  return result;
}

export async function commitDiff(repoPath: string): Promise<string> {
  return runGit(repoPath, ["diff"], { allowFail: true });
}

export async function commitDiffStat(repoPath: string): Promise<string> {
  return runGit(repoPath, ["diff", "--stat"], { allowFail: true });
}

export async function unstagedChanges(repoPath: string): Promise<string> {
  return runGit(repoPath, ["status", "--porcelain"], { allowFail: true });
}

export async function getLog(repoPath: string, count = 50): Promise<GitCommit[]> {
  const out = await runGit(
    repoPath,
    ["log", `--max-count=${count}`, "--pretty=format:%H%x1f%s%x1f%an%x1f%aI"]
  );
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, message, author, iso] = line.split("\x1f");
      return {
        sha,
        shortSha: sha.slice(0, 7),
        message,
        author,
        date: iso,
        dateTs: Date.parse(iso),
      };
    });
}

export async function branchAheadBehind(repoPath: string): Promise<string> {
  return (await runGit(repoPath, ["status", "-sb"])).trim().split("\n")[0] ?? "";
}

export async function diffByCommit(repoPath: string, base: string): Promise<GitDiffFile[]> {
  const out = await runGit(repoPath, ["diff", `${base}...HEAD`, "--unified=4"], { allowFail: true });
  return parseDiff(out);
}

export async function diffWorkingTree(repoPath: string): Promise<GitDiffFile[]> {
  const out = await runGit(repoPath, ["diff", "--unified=4"], { allowFail: true });
  const files = parseDiff(out);

  const untracked = await runGit(repoPath, ["ls-files", "--others", "--exclude-standard"], { allowFail: true });
  for (const path of untracked.trim().split("\n").filter(Boolean)) {
    const abs = `${repoPath}/${path}`;
    const lines = String(fs.readFileSync(abs, "utf8")).split("\n");
    if (lines.length === 1 && lines[0] === "") lines.pop();
    files.push({
      path,
      additions: lines.length,
      deletions: 0,
      hunks:
        `diff --git a/${path} b/${path}\n` +
        `new file mode 100644\n` +
        `--- /dev/null\n` +
        `+++ b/${path}\n` +
        lines.map((l) => `+${l}`).join("\n") +
        "\n",
    });
  }
  return files;
}

function parseDiff(raw: string): GitDiffFile[] {
  const files: GitDiffFile[] = [];
  let current: GitDiffFile | null = null;
  const lines = raw.split("\n");
  for (const line of lines) {
    const header = line.match(/^diff --git a\/(.*?) b\/(.*)$/);
    if (header) {
      if (current) files.push(current);
      current = { path: header[1], additions: 0, deletions: 0, hunks: "" };
    } else if (current) {
      const add = (line.match(/^\+/g) ?? []).length;
      const del = (line.match(/^\-/g) ?? []).length;
      current.additions += add;
      current.deletions += del;
      current.hunks += line + "\n";
    }
  }
  if (current) files.push(current);
  return files;
}

export async function detectMergeConflicts(repoPath: string, targetBranch: string): Promise<MergeConflict[]> {
  const current = (await runGit(repoPath, ["branch", "--show-current"])).trim();
  if (!current || !targetBranch || current === targetBranch) return [];
  const refs = [current, targetBranch].map((b) => b.replace(/\s+/g, ""));
  const out = await runGit(repoPath, ["merge-tree", "--name-only", "--write-tree", refs[0], refs[1]], {
    allowFail: true,
  });
  const lines = out.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const names = lines.slice(1);
  return names.filter((f) => !f.startsWith("CONFLICT") && !f.startsWith("Auto-merging")).map((fileName) => ({ fileName }));
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  return (await runGit(repoPath, ["branch", "--show-current"], { allowFail: true })).trim();
}

export async function getRecentPrs(repoPath: string): Promise<string[]> {
  const out = await runGit(repoPath, ["log", "--oneline", "--all", "--max-count=50"], { allowFail: true });
  return out.trim().split("\n").filter(Boolean);
}

// --- Stage 3: Git worktree operations ---

/** Create a worktree with a new branch based on baseBranch. */
export async function worktreeAdd(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  baseBranch: string
): Promise<void> {
  const parent = path.dirname(worktreePath);
  fs.mkdirSync(parent, { recursive: true });
  await runGit(repoPath, ["worktree", "add", worktreePath, "-b", branchName, baseBranch]);
}

/** Remove a worktree. Use force=true to allow removing dirty worktrees. */
export async function worktreeRemove(
  repoPath: string,
  worktreePath: string,
  force = false
): Promise<void> {
  const args = ["worktree", "remove", worktreePath];
  if (force) args.push("--force");
  await runGit(repoPath, args);
}

/** List all worktree paths registered in the repo. */
export async function worktreeListPaths(repoPath: string): Promise<string[]> {
  const out = await runGit(repoPath, ["worktree", "list", "--porcelain"], { allowFail: true });
  return out
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length));
}

/** Check if a path is a valid Git worktree. */
export async function isGitWorktree(wtPath: string): Promise<boolean> {
  try {
    const out = await runGit(wtPath, ["rev-parse", "--is-inside-work-tree"], { allowFail: true });
    return out.trim() === "true";
  } catch {
    return false;
  }
}

/** Deterministic branch name: gridmind/{taskId}/{attempt} */
export function worktreeBranchName(taskId: string, attempt: number): string {
  return `gridmind/${taskId}/${attempt}`;
}

/** Resolve the next available branch name for a task by scanning existing branches. */
export async function nextWorktreeBranch(repoPath: string, taskId: string): Promise<string> {
  const branches = await listBranches(repoPath);
  const prefix = `gridmind/${taskId}/`;
  const existing = branches.filter((b) => b.startsWith(prefix));
  const maxAttempt = existing.reduce((max, b) => {
    const num = parseInt(b.slice(prefix.length), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  return worktreeBranchName(taskId, maxAttempt + 1);
}