import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { getTask, updateTask, getProject } from "@/lib/db";
import { validateTaskTransition } from "@/lib/task-transitions";
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

  // 1. Resolve project (project isolation — session must belong to this project's task)
  const project = getProject(session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  // 2. Resolve task in the session's project
  const task = getTask(session.project_id, taskId);
  if (!task) {
    return NextResponse.json({ error: "task not found in this project" }, { status: 404 });
  }

  // 3. Verify task belongs to same project as session (defense-in-depth)
  if (task.project_id !== session.project_id) {
    return NextResponse.json({ error: "task does not belong to this project" }, { status: 403 });
  }

  // 4. Role-based task authorization:
  //    - If worker: task.id MUST equal session.task_id AND session must be linked
  //    - If master: preserve existing master semantics (allowed within same project)
  if (session.role !== "master") {
    if (task.id !== session.task_id || task.session_id !== session.id) {
      return NextResponse.json(
        { error: "session is not linked to this task" },
        { status: 403 }
      );
    }
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

  // 5. Validate status transition
  const transitionError = validateTaskTransition(task.status, body.status);
  if (transitionError) {
    return NextResponse.json({ error: transitionError }, { status: 400 });
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: taskId } = await params;
  const session = auth.session;

  const project = getProject(session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const task = getTask(session.project_id, taskId);
  if (!task) {
    return NextResponse.json({ error: "task not found in this project" }, { status: 404 });
  }

  if (task.project_id !== session.project_id) {
    return NextResponse.json({ error: "task does not belong to this project" }, { status: 403 });
  }

  // If worker: task.id MUST equal session.task_id
  if (session.role !== "master") {
    if (task.id !== session.task_id) {
      return NextResponse.json(
        { error: "forbidden — worker cannot access another task" },
        { status: 403 }
      );
    }
  }

  return NextResponse.json({ ok: true, status: task.status, task });
}
