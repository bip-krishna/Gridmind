import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import {
  github,
  parseGithubRepo,
  listIssues,
  getIssue,
  isGithubConfigured,
} from "@/lib/github";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const gh = github();
  const repo = parseGithubRepo(project.github_repo);
  if (!gh || !repo) {
    return NextResponse.json({
      configured: false,
      issues: [],
      githubRepo: project.github_repo ?? null,
    });
  }

  try {
    const issues = await listIssues(gh, repo);
    return NextResponse.json({ configured: true, issues, configuredValue: isGithubConfigured(), githubRepo: project.github_repo });
  } catch (err: unknown) {
    return NextResponse.json(
      { configured: true, issues: [], error: err instanceof Error ? err.message : "github error" },
      { status: 502 }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { issue_number?: number; title?: string; body?: string };
  const gh = github();
  const repo = parseGithubRepo(project.github_repo);
  if (!gh || !repo) {
    return NextResponse.json({ error: "GitHub not configured. Set GITHUB_TOKEN and project github_repo." }, { status: 400 });
  }

  let issue: { number: number; title: string; body?: string } | null = null;
  if (body.issue_number) {
    const fetched = await getIssue(gh, repo, body.issue_number).catch(() => null);
    if (fetched) {
      issue = { number: fetched.number, title: fetched.title, body: `Github issue #${fetched.number}: ${fetched.url}` };
    }
  }
  if (!issue) {
    if (body.title) issue = { number: body.issue_number ?? 0, title: body.title, body: body.body };
  }
  if (!issue) {
    return NextResponse.json({ error: "provide issue_number or title" }, { status: 400 });
  }

  const { createTask } = await import("@/lib/db");
  const { newId } = await import("@/lib/agents");
  const task = createTask(id, {
    id: newId(),
    title: `GH-${issue.number}: ${issue.title}`,
    description: `Imported from GitHub issue.${issue.body ? `\n\n${issue.body}` : ""}`,
    issue_number: issue.number,
    priority: "medium",
  });
  publish(id, "issue:imported", { issueNumber: issue.number, taskId: task.id });
  return NextResponse.json({ task }, { status: 201 });
}