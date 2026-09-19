import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { getProject, createTask } from "@/lib/db";
import { github, parseGithubRepo, getIssue } from "@/lib/github";
import { newId } from "@/lib/agents";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const project = getProject(auth.session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  const issueNumber = typeof body.issue_number === "number"
    ? body.issue_number
    : parseInt(String(body.issue_number || ""), 10);

  if (isNaN(issueNumber) || issueNumber <= 0) {
    return NextResponse.json({ error: "valid issue_number is required" }, { status: 400 });
  }

  const configuredRepo = parseGithubRepo(project.github_repo);
  const gh = github();
  if (!gh || !configuredRepo) {
    return NextResponse.json(
      { error: "GitHub is not configured for this project (requires GITHUB_TOKEN and project.github_repo)" },
      { status: 400 }
    );
  }

  try {
    const issue = await getIssue(gh, configuredRepo, issueNumber);
    if (!issue) {
      return NextResponse.json({ error: `issue #${issueNumber} not found in repository` }, { status: 404 });
    }

    const taskId = newId();
    const task = createTask(project.id, {
      id: taskId,
      title: `GH-${issue.number}: ${issue.title}`,
      description: `Imported from GitHub issue #${issue.number}: ${issue.url}`,
      issue_number: issue.number,
      priority: "medium",
    });

    publish(project.id, "issue:imported", {
      issueNumber: issue.number,
      taskId: task.id,
      session_id: auth.session.id,
    });
    publish(project.id, "task:created", {
      id: task.id,
      title: task.title,
    });

    return NextResponse.json({
      ok: true,
      task,
    }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const sanitized = msg.replace(/ghp_[a-zA-Z0-9]+/g, "[REDACTED]");
    return NextResponse.json({ error: `GitHub issue lookup failed: ${sanitized}` }, { status: 502 });
  }
}
