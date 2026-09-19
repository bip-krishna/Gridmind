import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { resolveSessionWorktree, runGitSafe } from "@/lib/git-internal";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

async function handleLog(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let requestedTaskId: string | undefined;
  let rawLimit: unknown;
  let rawCommit: unknown;

  if (req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      requestedTaskId = typeof body.task_id === "string" ? body.task_id : (typeof body.taskId === "string" ? body.taskId : undefined);
      rawLimit = body.limit;
      rawCommit = body.commit;
    } catch {
      // Empty body
    }
  } else {
    const url = new URL(req.url);
    requestedTaskId = url.searchParams.get("task_id") || url.searchParams.get("taskId") || undefined;
    rawLimit = url.searchParams.get("limit");
    rawCommit = url.searchParams.get("commit");
  }

  const resolved = resolveSessionWorktree(auth.session, requestedTaskId);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const { worktreePath } = resolved;

  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined && rawLimit !== null) {
    const parsed = typeof rawLimit === "number" ? rawLimit : parseInt(String(rawLimit), 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  let commitRef: string | undefined;
  if (typeof rawCommit === "string" && rawCommit.trim().length > 0) {
    const trimmed = rawCommit.trim();
    if (!/^[a-zA-Z0-9~^_.-]+$/.test(trimmed) || trimmed.length > 50) {
      return NextResponse.json({ error: "invalid commit reference format" }, { status: 400 });
    }
    commitRef = trimmed;
  }

  try {
    const gitArgs = [
      "log",
      `--max-count=${commitRef ? 1 : limit}`,
      "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI",
    ];

    if (commitRef) {
      gitArgs.push(commitRef);
    }

    const out = await runGitSafe(worktreePath, gitArgs, { allowFail: true });
    const lines = out.split("\n").filter((l) => l.trim().length > 0);

    const commits = lines.map((line) => {
      const [sha, short_sha, message, author, date] = line.split("\x1f");
      return {
        sha: sha || "",
        short_sha: short_sha || (sha ? sha.slice(0, 7) : ""),
        message: message || "",
        author: author || "",
        date: date || "",
      };
    });

    return NextResponse.json({
      ok: true,
      commits,
      count: commits.length,
      limit,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `git log failed: ${msg}` }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handleLog(req);
}

export async function POST(req: Request) {
  return handleLog(req);
}
