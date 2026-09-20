import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { resolveSessionWorktree, runGitSafe } from "@/lib/git-internal";
import { updateTask, createMemory, setContext } from "@/lib/db";
import { publish } from "@/lib/events";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

const MAX_MESSAGE_LENGTH = 500;

export async function POST(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "commit message is required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `commit message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` },
      { status: 400 }
    );
  }

  const requestedTaskId = typeof body.task_id === "string" ? body.task_id : (typeof body.taskId === "string" ? body.taskId : undefined);
  const resolved = resolveSessionWorktree(auth.session, requestedTaskId);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const { worktreePath, task, projectId } = resolved;

  try {
    // Stage all changes in this worktree
    await runGitSafe(worktreePath, ["add", "-A"]);

    // Check if there are staged changes
    const statusOut = await runGitSafe(worktreePath, ["status", "--porcelain"], { allowFail: true });
    if (!statusOut.trim()) {
      return NextResponse.json({ error: "nothing to commit, working tree clean" }, { status: 400 });
    }

    // Commit changes
    await runGitSafe(worktreePath, ["commit", "-m", message]);

    // Retrieve commit SHA and branch
    const shaOut = await runGitSafe(worktreePath, ["rev-parse", "HEAD"]);
    const commitSha = shaOut.trim();
    const shortSha = commitSha.slice(0, 7);

    const branchOut = await runGitSafe(worktreePath, ["branch", "--show-current"], { allowFail: true });
    const branch = branchOut.trim() || (task?.worktree_branch ?? "main");

    // Update task's latest_commit
    if (task) {
      updateTask(projectId, task.id, { latest_commit: commitSha });
    }

    // Auto-record commit to project memory so agents/system share context automatically
    try {
      createMemory(projectId, {
        id: nanoid(),
        scope: "project_shared",
        type: "fact",
        content: `Git commit ${shortSha} on ${branch}: "${message}"`,
        importance: 2,
        source: "agent",
        session_id: auth.session.id,
        task_id: task?.id ?? null,
      });
      setContext(projectId, "latest_commit", `${shortSha} — ${message}`);
    } catch {
      /* ignore automatic memory error */
    }

    // Publish git:commit event (no secrets, no private memory)
    publish(projectId, "git:commit", {
      project_id: projectId,
      task_id: task?.id ?? null,
      session_id: auth.session.id,
      commit_sha: commitSha,
      branch,
    });

    return NextResponse.json({
      ok: true,
      commit_sha: commitSha,
      short_sha: shortSha,
      message,
      branch,
    }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `git commit failed: ${msg}` }, { status: 500 });
  }
}
