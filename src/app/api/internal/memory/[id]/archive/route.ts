import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { archiveMemory, getMemory, getProject } from "@/lib/db";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateAgent(_req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const projectId = auth.session.project_id;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const { id } = await params;

  // SEC-03: Check memory existence and enforce ownership authorization
  const existing = getMemory(projectId, id);
  if (!existing || existing.archived_at !== null) {
    return NextResponse.json({ error: "memory not found" }, { status: 404 });
  }
  if (existing.scope === "agent_private" && existing.session_id !== auth.session.id) {
    return NextResponse.json(
      { error: "forbidden — cannot archive another session's private memory" },
      { status: 403 }
    );
  }
  if (existing.scope === "task") {
    if (auth.session.role !== "master") {
      if (!auth.session.task_id || existing.task_id !== auth.session.task_id) {
        return NextResponse.json(
          { error: "forbidden — worker cannot archive another task's memory" },
          { status: 403 }
        );
      }
    }
  }

  const memory = archiveMemory(projectId, id);
  if (!memory) {
    return NextResponse.json({ error: "memory not found" }, { status: 404 });
  }

  publish(projectId, "memory:archived", {
    id: memory.id,
    scope: memory.scope,
    sessionId: auth.session.id,
  });

  return NextResponse.json({ ok: true, memory });
}
