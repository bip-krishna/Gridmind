import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { resolveSessionWorktree, runGitSafe } from "@/lib/git-internal";
import { branchAheadBehind } from "@/lib/git";

export const runtime = "nodejs";

const MAX_STATUS_FILES = 100;

async function handleStatus(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let requestedTaskId: string | undefined;
  if (req.method === "POST") {
    try {
      const body = (await req.json()) as { task_id?: string; taskId?: string };
      requestedTaskId = body.task_id || body.taskId;
    } catch {
      // Ignore JSON parse error if body was empty
    }
  } else {
    const url = new URL(req.url);
    requestedTaskId = url.searchParams.get("task_id") || url.searchParams.get("taskId") || undefined;
  }

  const resolved = resolveSessionWorktree(auth.session, requestedTaskId);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const { worktreePath } = resolved;

  try {
    const branchOut = await runGitSafe(worktreePath, ["branch", "--show-current"], { allowFail: true });
    const branch = branchOut.trim();

    const statusOut = await runGitSafe(worktreePath, ["status", "--porcelain"], { allowFail: true });
    const lines = statusOut.split("\n").filter((l) => l.trim().length > 0);

    const changedFiles: string[] = [];
    const untrackedFiles: string[] = [];

    for (const line of lines) {
      const code = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      if (code === "??") {
        untrackedFiles.push(filePath);
      } else {
        changedFiles.push(filePath);
      }
    }

    let aheadBehind = "";
    try {
      aheadBehind = await branchAheadBehind(worktreePath);
    } catch {
      // Ignore if no upstream configured
    }

    const clean = changedFiles.length === 0 && untrackedFiles.length === 0;

    return NextResponse.json({
      ok: true,
      branch: branch || "HEAD",
      clean,
      dirty: !clean,
      changed_files: changedFiles.slice(0, MAX_STATUS_FILES),
      untracked_files: untrackedFiles.slice(0, MAX_STATUS_FILES),
      changed_files_count: changedFiles.length,
      untracked_files_count: untrackedFiles.length,
      ahead_behind: aheadBehind,
      truncated: changedFiles.length > MAX_STATUS_FILES || untrackedFiles.length > MAX_STATUS_FILES,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `git status failed: ${message}` }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handleStatus(req);
}

export async function POST(req: Request) {
  return handleStatus(req);
}
