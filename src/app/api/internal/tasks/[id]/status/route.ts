import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { getTask, updateTask, getProject, getSession, listTasksBySession } from "@/lib/db";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

const VALID_STATUSES = ["queued", "in_progress", "blocked", "done", "failed"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: taskId } = await params;
  const session = auth.session;

  // 1. Resolve project
  const project = getProject(session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  // 2. Resolve task
  const task = getTask(session.project_id, taskId);
  if (!task) {
    return NextResponse.json({ error: "task not found in this project" }, { status: 404 });
  }

  // 3. Verify task belongs to same project as session
  if (task.project_id !== session.project_id) {
    return NextResponse.json({ error: "task does not belong to this project" }, { status: 403 });
  }

  // 4. Verify session is linked to this task OR this agent owns the task
  //    - If task.session_id is set, it must match this session
  //    - If task.assigned_agent is set, it must match this session's agent_type
  const sessionLinked = task.session_id === session.id;
  const agentOwnsTask = task.assigned_agent === session.agent_type;

  if (!sessionLinked && !agentOwnsTask) {
    return NextResponse.json(
      { error: "agent is not assigned to this task and session is not linked" },
      { status: 403 }
    );
  }

  const body = (await req.json()) as { status?: string; description?: string };

  if (!body.status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }

  if (!VALID_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: `invalid status: ${body.status}. Valid: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const patch: { status: string; description?: string } = { status: body.status };
  if (body.description !== undefined) patch.description = body.description;

  const updated = updateTask(session.project_id, taskId, patch);
  if (!updated) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  publish(session.project_id, "task:updated", {
    id: updated.id,
    status: updated.status,
    agent: session.agent_type,
    sessionId: session.id,
  });

  return NextResponse.json({ task: updated });
}
