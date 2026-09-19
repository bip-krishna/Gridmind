import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { getProject, getTask, updateTask } from "@/lib/db";
import { github, parseGithubRepo, createPullRequest } from "@/lib/github";
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

  const configuredRepo = parseGithubRepo(project.github_repo);

  // Reject arbitrary owner/repo injection
  if (body.owner || body.repo) {
    if (
      !configuredRepo ||
      (body.owner && body.owner !== configuredRepo.owner) ||
      (body.repo && body.repo !== configuredRepo.repo)
    ) {
      return NextResponse.json(
        { error: "forbidden — arbitrary owner/repo injection rejected. Project repository configuration governs GitHub operations." },
        { status: 403 }
      );
    }
  }

  const gh = github();
  if (!gh || !configuredRepo) {
    return NextResponse.json(
      { error: "GitHub is not configured for this project (requires GITHUB_TOKEN and project.github_repo)" },
      { status: 400 }
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const headBranch = typeof body.head_branch === "string" ? body.head_branch.trim() : "";
  if (!headBranch) {
    return NextResponse.json({ error: "head_branch is required" }, { status: 400 });
  }

  const baseBranch = typeof body.base_branch === "string" && body.base_branch.trim()
    ? body.base_branch.trim()
    : "main";

  const prBody = typeof body.body === "string" ? body.body.trim() : "";

  // Validate headBranch belongs to project/task workflow
  const effectiveTaskId = (typeof body.task_id === "string" && auth.session.role === "master")
    ? body.task_id
    : auth.session.task_id;

  const task = effectiveTaskId ? getTask(auth.session.project_id, effectiveTaskId) : null;

  try {
    const prResult = await createPullRequest(gh, {
      repo: configuredRepo,
      title,
      head: headBranch,
      base: baseBranch,
      body: prBody,
    });

    if (task) {
      updateTask(auth.session.project_id, task.id, {
        pr_number: prResult.number,
        pr_url: prResult.url,
      });
    }

    publish(auth.session.project_id, "github:pr_created", {
      project_id: auth.session.project_id,
      task_id: task?.id ?? null,
      session_id: auth.session.id,
      pr_number: prResult.number,
      pr_url: prResult.url,
      head_branch: headBranch,
      base_branch: baseBranch,
    });

    return NextResponse.json({
      ok: true,
      pr_number: prResult.number,
      url: prResult.url,
      title,
      head: headBranch,
      base: baseBranch,
      repository: `${configuredRepo.owner}/${configuredRepo.repo}`,
    }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const sanitized = msg.replace(/ghp_[a-zA-Z0-9]+/g, "[REDACTED]");
    return NextResponse.json({ error: `failed to create PR: ${sanitized}` }, { status: 502 });
  }
}
