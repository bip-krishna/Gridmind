import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { updateMemory, getProject, type MemoryType } from "@/lib/db";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

const VALID_TYPES: MemoryType[] = ["fact", "discovery", "constraint", "note"];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const projectId = auth.session.project_id;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const { id } = await params;
  const body = (await req.json()) as {
    content?: string;
    type?: string;
    importance?: number;
  };

  if (body.type && !VALID_TYPES.includes(body.type as MemoryType)) {
    return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }
  if (body.content !== undefined && !body.content?.trim()) {
    return NextResponse.json({ error: "content must be non-empty" }, { status: 400 });
  }
  if (body.importance !== undefined && (body.importance < 1 || body.importance > 3)) {
    return NextResponse.json({ error: "importance must be between 1 and 3" }, { status: 400 });
  }

  const patch: { content?: string; type?: MemoryType; importance?: number } = {};
  if (body.content !== undefined) patch.content = body.content.trim();
  if (body.type !== undefined) patch.type = body.type as MemoryType;
  if (body.importance !== undefined) patch.importance = body.importance;

  const memory = updateMemory(projectId, id, patch);
  if (!memory) {
    return NextResponse.json({ error: "memory not found or archived" }, { status: 404 });
  }

  publish(projectId, "memory:updated", {
    id: memory.id,
    scope: memory.scope,
    type: memory.type,
    sessionId: auth.session.id,
  });

  return NextResponse.json({ ok: true, memory });
}
