import { Octokit } from "@octokit/rest";
import { createHash } from "node:crypto";
import { githubCredential } from "./github-connection";

const globalForHub = globalThis as unknown as { __gridmindHub?: Octokit; __gridmindGithubFingerprint?: string };

export function github(): Octokit | null {
  const token = githubCredential();
  if (!token) {
    delete globalForHub.__gridmindHub;
    delete globalForHub.__gridmindGithubFingerprint;
    return null;
  }
  const fingerprint = createHash("sha256").update(token).digest("hex");
  if (!globalForHub.__gridmindHub || globalForHub.__gridmindGithubFingerprint !== fingerprint) {
    globalForHub.__gridmindHub = new Octokit({ auth: token });
    globalForHub.__gridmindGithubFingerprint = fingerprint;
  }
  return globalForHub.__gridmindHub;
}

export function isGithubConfigured(): boolean {
  return Boolean(githubCredential());
}

export type GithubRepo = { owner: string; repo: string };

export function parseGithubRepo(input: string | null | undefined): GithubRepo | null {
  if (!input?.trim()) return null;
  let value = input.trim();
  if (/^(?:https?|ssh):\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const ssh = url.protocol === "ssh:";
      if (!["github.com", "www.github.com"].includes(url.hostname) || url.password || url.search || url.hash
        || (ssh ? url.username !== "git" || (url.port && url.port !== "22") : url.username || url.port)) return null;
      value = url.pathname.replace(/^\//, "");
    } catch { return null; }
  } else value = value.replace(/^git@github\.com:/i, "");
  const segments = value.replace(/\/$/, "").replace(/\.git$/, "").split("/");
  if (segments.length !== 2) return null;
  const [owner, repo] = segments;
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner)
    || !/^[a-z\d_.-]{1,100}$/i.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo };
}

export async function inferGithubRepo(
  repoPath: string
): Promise<GithubRepo | null> {
  const { execAsync } = await import("./git");
  try {
    const { stdout } = await execAsync("git remote get-url origin", { cwd: repoPath });
    const url = stdout.trim();
    return parseGithubRepo(url);
  } catch {
    /* no remote */
  }
  return null;
}

export type Issue = {
  number: number;
  title: string;
  state: string;
  url: string;
  labels: string[];
  createdAt: string;
};

export async function listIssues(gh: Octokit, repo: GithubRepo): Promise<Issue[]> {
  const res = await gh.issues.listForRepo({ ...repo, state: "open", per_page: 30 });
  return res.data.filter((i) => !i.pull_request).map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    url: i.html_url,
    labels: (i.labels as { name?: string }[]).map((l) => l.name ?? "").filter(Boolean),
    createdAt: i.created_at ?? "",
  }));
}

export async function getIssue(gh: Octokit, repo: GithubRepo, number: number): Promise<Issue | null> {
  const res = await gh.issues.get({ ...repo, issue_number: number });
  const i = res.data;
  return {
    number: i.number,
    title: i.title,
    state: i.state,
    url: i.html_url,
    labels: (i.labels as { name?: string }[]).map((l) => l.name ?? "").filter(Boolean),
    createdAt: i.created_at ?? "",
  };
}

export type CreatePrInput = {
  repo: GithubRepo;
  title: string;
  head: string;
  base?: string;
  body?: string;
};

export async function createPullRequest(
  gh: Octokit,
  input: CreatePrInput
): Promise<{ url: string; number: number }> {
  const res = await gh.pulls.create({
    ...input.repo,
    title: input.title,
    head: input.head,
    base: input.base ?? "main",
    body: input.body ?? "",
  });
  return { url: res.data.html_url, number: res.data.number };
}
