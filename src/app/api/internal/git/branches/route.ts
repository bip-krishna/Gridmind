import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { resolveSessionWorktree, runGitSafe } from "@/lib/git-internal";

export const runtime = "nodejs";

const MAX_BRANCHES = 50;

export async function GET(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const requestedTaskId = url.searchParams.get("task_id") || url.searchParams.get("taskId") || undefined;

  const resolved = resolveSessionWorktree(auth.session, requestedTaskId);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const { worktreePath } = resolved;

  try {
    const currentBranchOut = await runGitSafe(worktreePath, ["branch", "--show-current"], { allowFail: true });
    const currentBranch = currentBranchOut.trim();

    const branchesOut = await runGitSafe(
      worktreePath,
      ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
      { allowFail: true }
    );
    const branches = branchesOut.split("\n").map((b) => b.trim()).filter(Boolean);

    return NextResponse.json({
      ok: true,
      current: currentBranch || "HEAD",
      branches: branches.slice(0, MAX_BRANCHES),
      total: branches.length,
      truncated: branches.length > MAX_BRANCHES,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `git branches failed: ${message}` }, { status: 500 });
  }
}
