import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { updateSession } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: sessionId } = await params;

  // Verify the session belongs to this agent
  if (auth.session.id !== sessionId) {
    return NextResponse.json({ error: "session mismatch" }, { status: 403 });
  }

  const body = (await req.json()) as {
    summary?: string;
    status?: string;
    files?: string[];
    decisions?: string[];
    blockers?: string[];
    next_steps?: string[];
    commits?: Array<{ sha: string; message?: string } | string>;
  };

  const patch: Record<string, string | null> = {};
  if (body.summary !== undefined) patch.result_summary = body.summary;
  if (body.status !== undefined) patch.result_status = body.status;
  if (body.files !== undefined) patch.result_files = JSON.stringify(body.files);
  if (body.decisions !== undefined) patch.result_decisions = JSON.stringify(body.decisions);
  if (body.blockers !== undefined) patch.result_blockers = JSON.stringify(body.blockers);
  if (body.next_steps !== undefined) patch.result_next_steps = JSON.stringify(body.next_steps);
  if (body.commits !== undefined) patch.result_commits = JSON.stringify(body.commits);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no result fields provided" }, { status: 400 });
  }

  const updated = updateSession(auth.session.project_id, sessionId, patch as Record<string, string | null>);
  if (!updated) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  return NextResponse.json({
    session: {
      id: updated.id,
      result_summary: updated.result_summary,
      result_status: updated.result_status,
      result_files: updated.result_files ? JSON.parse(updated.result_files) : null,
      result_decisions: updated.result_decisions ? JSON.parse(updated.result_decisions) : null,
      result_blockers: updated.result_blockers ? JSON.parse(updated.result_blockers) : null,
      result_next_steps: updated.result_next_steps ? JSON.parse(updated.result_next_steps) : null,
      result_commits: updated.result_commits ? JSON.parse(updated.result_commits) : null,
    },
  });
}
