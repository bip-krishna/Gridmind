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
  if (body.content.length > 4000) {
    return NextResponse.json({ error: "content must not exceed 4000 characters" }, { status: 400 });
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
    if (task.project_id !== projectId) {
      return NextResponse.json({ error: "task does not belong to this project" }, { status: 403 });
    }
    if (auth.session.role !== "master") {
      if (!auth.session.task_id || auth.session.task_id !== body.task_id) {
        return NextResponse.json(
          { error: "forbidden — worker cannot create memory for another task" },
          { status: 403 }
        );
      }
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
  const includeArchived = url.searchParams.get("archived") === "true";

  if (scope && !VALID_SCOPES.includes(scope)) {
    return NextResponse.json({ error: `scope must be one of: ${VALID_SCOPES.join(", ")}` }, { status: 400 });
  }

  // Cross-task authorization on direct task_id query:
  // Workers cannot query another task's memories directly.
  if (taskId && auth.session.role !== "master") {
    if (!auth.session.task_id || auth.session.task_id !== taskId) {
      return NextResponse.json(
        { error: "forbidden — worker cannot access another task's memory" },
        { status: 403 }
      );
    }
  }

  // SEC-01: Never allow client to supply arbitrary session_id to access another session's private memory.
  // When scope is agent_private, query strictly for auth.session.id.
  const effectiveSessionId = scope === "agent_private" ? auth.session.id : undefined;

  let memories = listMemories(projectId, {
    scope: scope ?? undefined,
    task_id: taskId ?? undefined,
    session_id: effectiveSessionId,
    includeArchived,
  });

  // Server-side visibility enforcement:
  // 1. Private memories only visible to creating session
  // 2. Task memories visible only if session is authorized (master or assigned to that task)
  memories = memories.filter((m) => {
    if (m.scope === "agent_private" && m.session_id !== auth.session.id) {
      return false;
    }
    if (m.scope === "task") {
      if (auth.session.role !== "master") {
        if (!auth.session.task_id || m.task_id !== auth.session.task_id) {
          return false;
        }
      }
    }
    return true;
  });

  return NextResponse.json({ memories });
}
