import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import {
  createMemory,
  getProject,
  getTask,
  listMemories,
  type MemoryScope,
  type MemoryType,
  type MemorySource,
} from "@/lib/db";
import { publish } from "@/lib/events";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

const VALID_SCOPES: MemoryScope[] = ["project_shared", "agent_private", "task"];
const VALID_TYPES: MemoryType[] = ["fact", "discovery", "constraint", "note"];
const VALID_SOURCES: MemorySource[] = ["agent", "user", "task", "decision"];

export async function POST(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const projectId = auth.session.project_id;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const body = (await req.json()) as {
    scope?: string;
    type?: string;
    content?: string;
    importance?: number;
    source?: string;
    task_id?: string;
  };

  if (!body.scope || !VALID_SCOPES.includes(body.scope as MemoryScope)) {
    return NextResponse.json({ error: `scope must be one of: ${VALID_SCOPES.join(", ")}` }, { status: 400 });
  }
  if (!body.type || !VALID_TYPES.includes(body.type as MemoryType)) {
    return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!body.content?.trim()) {
    return NextResponse.json({ error: "content is required and must be non-empty" }, { status: 400 });
  }
  if (!body.source || !VALID_SOURCES.includes(body.source as MemorySource)) {
    return NextResponse.json({ error: `source must be one of: ${VALID_SOURCES.join(", ")}` }, { status: 400 });
  }
  if (body.importance !== undefined && (body.importance < 1 || body.importance > 3)) {
    return NextResponse.json({ error: "importance must be between 1 and 3" }, { status: 400 });
  }

  const scope = body.scope as MemoryScope;
  let sessionId: string | null = null;
  let taskId: string | null = null;

  if (scope === "agent_private") {
    sessionId = auth.session.id;
  }

  if (scope === "task") {
    if (!body.task_id) {
      return NextResponse.json({ error: "task_id is required for task-scoped memory" }, { status: 400 });
    }
    const task = getTask(projectId, body.task_id);
    if (!task) {
      return NextResponse.json({ error: "task not found in this project" }, { status: 404 });
    }
    taskId = body.task_id;
    sessionId = auth.session.id;
  }

  const memory = createMemory(projectId, {
    id: nanoid(14),
    scope,
    type: body.type as MemoryType,
    content: body.content.trim(),
    importance: body.importance ?? 1,
    source: body.source as MemorySource,
    session_id: sessionId,
    task_id: taskId,
  });

  publish(projectId, "memory:created", {
    id: memory.id,
    scope: memory.scope,
    type: memory.type,
    source: memory.source,
    sessionId: auth.session.id,
  });

  return NextResponse.json({ ok: true, memory }, { status: 201 });
}

export async function GET(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const projectId = auth.session.project_id;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") as MemoryScope | null;
  const taskId = url.searchParams.get("task_id");
  const sessionId = url.searchParams.get("session_id");
  const includeArchived = url.searchParams.get("archived") === "true";

  if (scope && !VALID_SCOPES.includes(scope)) {
    return NextResponse.json({ error: `scope must be one of: ${VALID_SCOPES.join(", ")}` }, { status: 400 });
  }

  const memories = listMemories(projectId, {
    scope: scope ?? undefined,
    task_id: taskId ?? undefined,
    session_id: sessionId ?? undefined,
    includeArchived,
  });

  return NextResponse.json({ memories });
}
