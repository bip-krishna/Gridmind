import { NextResponse } from "next/server";
import { getProject, listHandoffs, getHandoff, updateHandoffStatus, getTask } from "@/lib/db";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rawHandoffs = listHandoffs(id);
  const handoffs = rawHandoffs.map((h) => {
    const sourceTask = getTask(id, h.source_task_id);
    const targetTask = getTask(id, h.target_task_id);
    return {
      ...h,
      sourceTaskTitle: sourceTask?.title || h.source_task_id,
      targetTaskTitle: targetTask?.title || h.target_task_id,
    };
  });

  return NextResponse.json({ ok: true, handoffs });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { handoffId?: string; action?: string };
  try {
    body = (await req.json()) as { handoffId?: string; action?: string };
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  if (!body.handoffId) {
    return NextResponse.json({ error: "handoffId is required" }, { status: 400 });
  }

  const handoff = getHandoff(id, body.handoffId);
  if (!handoff) {
    return NextResponse.json({ error: "handoff not found" }, { status: 404 });
  }

  if (body.action === "accept") {
    if (handoff.status === "accepted") {
      return NextResponse.json({ ok: true, handoff, already_accepted: true });
    }

    const updated = updateHandoffStatus(id, handoff.id, "accepted");
    publish(id, "handoff:accepted", {
      handoff_id: handoff.id,
      project_id: id,
      source_task_id: handoff.source_task_id,
      target_task_id: handoff.target_task_id,
    });

    return NextResponse.json({ ok: true, handoff: updated });
  }

  return NextResponse.json({ error: `unsupported action: ${body.action}` }, { status: 400 });
}
