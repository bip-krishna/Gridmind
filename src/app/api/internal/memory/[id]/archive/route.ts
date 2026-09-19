import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { archiveMemory, getProject } from "@/lib/db";
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
