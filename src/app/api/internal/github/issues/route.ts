import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { getProject } from "@/lib/db";
import { github, parseGithubRepo, listIssues } from "@/lib/github";

export const runtime = "nodejs";

const MAX_ISSUES = 30;

export async function GET(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const project = getProject(auth.session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const url = new URL(req.url);
  const injectedOwner = url.searchParams.get("owner");
  const injectedRepo = url.searchParams.get("repo");

  const configuredRepo = parseGithubRepo(project.github_repo);

  // Reject arbitrary owner/repo injection
  if (injectedOwner || injectedRepo) {
    if (!configuredRepo || (injectedOwner && injectedOwner !== configuredRepo.owner) || (injectedRepo && injectedRepo !== configuredRepo.repo)) {
      return NextResponse.json(
        { error: "forbidden — arbitrary owner/repo injection rejected. Project repository configuration governs GitHub operations." },
        { status: 403 }
      );
    }
  }

  const gh = github();
  if (!gh || !configuredRepo) {
    return NextResponse.json({
      ok: true,
      configured: false,
      issues: [],
      message: "GitHub is not configured for this project (requires GITHUB_TOKEN and project.github_repo)",
    });
  }

  const rawLimit = url.searchParams.get("limit");
  let limit = MAX_ISSUES;
  if (rawLimit) {
    const parsed = parseInt(rawLimit, 10);
    if (!isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 50);
  }

  try {
    const rawIssues = await listIssues(gh, configuredRepo);
    const issues = rawIssues.slice(0, limit).map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      url: i.url,
      labels: i.labels,
      created_at: i.createdAt,
    }));

    return NextResponse.json({
      ok: true,
      configured: true,
      repository: `${configuredRepo.owner}/${configuredRepo.repo}`,
      issues,
      count: issues.length,
      truncated: rawIssues.length > limit,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Ensure tokens are never leaked in error messages
    const sanitized = message.replace(/ghp_[a-zA-Z0-9]+/g, "[REDACTED]");
    return NextResponse.json({
      ok: true,
      configured: false,
      repository: `${configuredRepo.owner}/${configuredRepo.repo}`,
      issues: [],
      message: `GitHub repository not accessible: ${sanitized}`,
    });
  }
}
