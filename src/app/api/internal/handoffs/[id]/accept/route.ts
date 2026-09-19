import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { getProject, getHandoff, updateHandoffStatus } from "@/lib/db";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const project = getProject(auth.session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const { id } = await params;
  const handoff = getHandoff(auth.session.project_id, id);

  if (!handoff) {
    return NextResponse.json({ error: "handoff not found in this project" }, { status: 404 });
  }

  // Authorization: worker can only accept a handoff targeted at its assigned task
  if (auth.session.role !== "master") {
    if (!auth.session.task_id || handoff.target_task_id !== auth.session.task_id) {
      return NextResponse.json(
        { error: "forbidden — worker cannot accept a handoff targeted at another task" },
        { status: 403 }
      );
    }
  }

  // Idempotency: if already accepted, return existing accepted handoff
  if (handoff.status === "accepted") {
    return NextResponse.json({
      ok: true,
      handoff,
      already_accepted: true,
    });
  }

  const updated = updateHandoffStatus(auth.session.project_id, id, "accepted");
  if (!updated) {
    return NextResponse.json({ error: "failed to update handoff" }, { status: 500 });
  }

  // Emit event without leaking private memory/content
  publish(auth.session.project_id, "handoff:accepted", {
    handoff_id: updated.id,
    project_id: auth.session.project_id,
    source_task_id: updated.source_task_id,
    target_task_id: updated.target_task_id,
  });

  return NextResponse.json({ ok: true, handoff: updated });
}
