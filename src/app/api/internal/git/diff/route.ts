import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { resolveSessionWorktree, isPathSafe, runGitSafe } from "@/lib/git-internal";

export const runtime = "nodejs";

const MAX_DIFF_CHARS = 30000;

export async function POST(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // Empty body is acceptable
  }

  const requestedTaskId = typeof body.task_id === "string" ? body.task_id : (typeof body.taskId === "string" ? body.taskId : undefined);
  const resolved = resolveSessionWorktree(auth.session, requestedTaskId);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const { worktreePath } = resolved;

  // Path parameter validation
  let filterPath: string | undefined;
  if (typeof body.path === "string" && body.path.trim().length > 0) {
    const rawPath = body.path.trim();
    if (!isPathSafe(worktreePath, rawPath)) {
      return NextResponse.json(
        { error: "forbidden — path traversal detected outside worktree" },
        { status: 400 }
      );
    }
    filterPath = rawPath;
  }

  // Commit parameter validation
  let commitRef: string | undefined;
  if (typeof body.commit === "string" && body.commit.trim().length > 0) {
    const rawCommit = body.commit.trim();
    if (!/^[a-zA-Z0-9~^_.-]+$/.test(rawCommit) || rawCommit.length > 50) {
      return NextResponse.json(
        { error: "invalid commit reference format" },
        { status: 400 }
      );
    }
    commitRef = rawCommit;
  }

  const staged = Boolean(body.staged);

  try {
    const gitArgs: string[] = [];

    if (commitRef) {
      gitArgs.push("show", "--patch", "--stat", commitRef);
      if (filterPath) {
        gitArgs.push("--", filterPath);
      }
    } else {
      gitArgs.push("diff");
      if (staged) {
        gitArgs.push("--staged");
      }
      if (filterPath) {
        gitArgs.push("--", filterPath);
      }
    }

    let diffOutput = await runGitSafe(worktreePath, gitArgs, { allowFail: true });
    let truncated = false;

    if (diffOutput.length > MAX_DIFF_CHARS) {
      diffOutput = diffOutput.slice(0, MAX_DIFF_CHARS) + "\n... [Diff truncated: exceeded maximum output limit]";
      truncated = true;
    }

    return NextResponse.json({
      ok: true,
      diff: diffOutput,
      truncated,
      length: diffOutput.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `git diff failed: ${message}` }, { status: 500 });
  }
}
