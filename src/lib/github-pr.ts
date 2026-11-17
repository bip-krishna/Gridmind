import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseGithubRepo, type GithubRepo } from "./github";

const git = promisify(execFile);

export async function validatePrBranch(cwd: string, branch: unknown): Promise<string | null> {
  if (typeof branch !== "string" || !branch.trim() || branch.length > 255 || branch.startsWith("-")) return null;
  const value = branch.trim();
  try {
    await git("git", ["check-ref-format", "--branch", value], { cwd, timeout: 5000 });
    return value;
  } catch { return null; }
}

export async function currentPrBranch(cwd: string): Promise<string> {
  const result = await git("git", ["branch", "--show-current"], { cwd, timeout: 5000 });
  return result.stdout.trim();
}

export async function pushPrBranch(cwd: string, branch: string): Promise<void> {
  // User branch names are always arguments, never shell code.
  await git("git", ["push", "-u", "origin", "--", branch], { cwd, timeout: 60000 });
}

export async function githubPushTargetMatches(cwd: string, repository: GithubRepo): Promise<boolean> {
  try {
    const result = await git("git", ["remote", "get-url", "--push", "origin"], { cwd, timeout: 5000 });
    const target = parseGithubRepo(result.stdout.trim());
    return !!target && target.owner.toLowerCase() === repository.owner.toLowerCase()
      && target.repo.toLowerCase() === repository.repo.toLowerCase();
  } catch { return false; }
}
