import { NextResponse } from "next/server";
import { getProject, listTasks, createTask, updateTask, deleteTask } from "@/lib/db";
import { publish } from "@/lib/events";
import { newId } from "@/lib/agents";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ tasks: listTasks(id) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as {
    title?: string;
    description?: string;
    priority?: string;
    assigned_agent?: string | null;
    issue_number?: number | null;
  };
  if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const task = createTask(id, {
    id: newId(),
    title: body.title.trim(),
    description: body.description,
    priority: body.priority,
    assigned_agent: body.assigned_agent,
    issue_number: body.issue_number ?? null,
  });
  publish(id, "task:created", { id: task.id, title: task.title });
  return NextResponse.json({ task }, { status: 201 });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as {
    taskId?: string;
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    assigned_agent?: string | null;
    session_id?: string | null;
    issue_number?: number | null;
  };
  const taskId = body.taskId;
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });

  const patch: Parameters<typeof updateTask>[2] = {};
  if ("title" in body) patch.title = body.title;
  if ("description" in body) patch.description = body.description;
  if ("status" in body) patch.status = body.status;
  if ("priority" in body) patch.priority = body.priority;
  if ("assigned_agent" in body) patch.assigned_agent = body.assigned_agent;
  if ("session_id" in body) patch.session_id = body.session_id;

  const updated = updateTask(id, taskId, patch);
  if (!updated) return NextResponse.json({ error: "task not found" }, { status: 404 });

  publish(id, "task:updated", { id: updated.id, status: updated.status });
  return NextResponse.json({ task: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId");
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  deleteTask(id, taskId);
  publish(id, "task:deleted", { id: taskId });
  return NextResponse.json({ ok: true });
}