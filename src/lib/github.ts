import { Octokit } from "@octokit/rest";

const globalForHub = globalThis as unknown as { __gridmindHub?: Octokit };

export function github(): Octokit | null {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  if (!globalForHub.__gridmindHub) {
    globalForHub.__gridmindHub = new Octokit({ auth: token });
  }
  return globalForHub.__gridmindHub;
}

export function isGithubConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

export type GithubRepo = { owner: string; repo: string };

export function parseGithubRepo(input: string | null | undefined): GithubRepo | null {
  if (!input) return null;
  if (!input.includes("/")) return null;
  const [owner, repo] = input.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "").split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

export async function inferGithubRepo(
  repoPath: string
): Promise<GithubRepo | null> {
  const { execAsync } = await import("./git");
  try {
    const { stdout } = await execAsync("git remote get-url origin", { cwd: repoPath });
    const url = stdout.trim();
    const m = url.match(/github\.com[:/](.+?\/.+?)\.git$/);
    if (m) {
      const [owner, repo] = m[1].split("/");
      return { owner, repo };
    }
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
  return res.data.map((i) => ({
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