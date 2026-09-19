import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { getTask, getProject } from "@/lib/db";

export const runtime = "nodejs";

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

  // Task-scoped authorization:
  // - If worker: task.id MUST equal session.task_id
  // - If master: allowed within session.project_id
  if (session.role !== "master") {
    if (task.id !== session.task_id) {
      return NextResponse.json(
        { error: "forbidden — worker cannot access another task" },
        { status: 403 }
      );
    }
  }

  return NextResponse.json({ ok: true, task });
}
