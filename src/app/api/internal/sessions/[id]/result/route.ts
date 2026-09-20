import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { updateSession, createMemory, createDecision } from "@/lib/db";
import { nanoid } from "nanoid";

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

  // Auto-record summary to project memory
  if (body.summary && typeof body.summary === "string" && body.summary.trim()) {
    try {
      createMemory(auth.session.project_id, {
        id: nanoid(),
        scope: "project_shared",
        type: "fact",
        content: `Agent Result (${auth.session.agent_type}): ${body.summary.trim()}`,
        importance: 2,
        source: "agent",
        session_id: auth.session.id,
        task_id: auth.session.task_id ?? null,
      });
    } catch {
      /* ignore */
    }
  }

  // Auto-record decisions to project decisions table and memory
  if (Array.isArray(body.decisions)) {
    for (const d of body.decisions) {
      if (typeof d === "string" && d.trim()) {
        try {
          createDecision(auth.session.project_id, {
            id: nanoid(),
            title: d.trim(),
            body: `Decision recorded from agent session ${auth.session.id}`,
          });
          createMemory(auth.session.project_id, {
            id: nanoid(),
            scope: "project_shared",
            type: "constraint",
            content: `Architectural Decision: ${d.trim()}`,
            importance: 3,
            source: "decision",
            session_id: auth.session.id,
            task_id: auth.session.task_id ?? null,
          });
        } catch {
          /* ignore */
        }
      }
    }
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
