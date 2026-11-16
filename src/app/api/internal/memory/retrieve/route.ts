import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { getProject, getTask } from "@/lib/db";
import { retrieveMemories } from "@/lib/memory";
import { retrievalInput } from "@/lib/retrieval-input";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const projectId = auth.session.project_id;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  let input: unknown;
  try {
    const text = await req.text();
    input = text.trim() ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = retrievalInput.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const body = parsed.data;

  // Task authorization for retrieval
  const requestedTaskId = body.task_id || body.taskId;
  if (requestedTaskId && auth.session.role !== "master") {
    if (!auth.session.task_id || auth.session.task_id !== requestedTaskId) {
      return NextResponse.json(
        { error: "forbidden — worker cannot retrieve another task's memory" },
        { status: 403 }
      );
    }
  }

  let effectiveTaskId = auth.session.task_id;
  if (auth.session.role === "master" && requestedTaskId) {
    const task = getTask(projectId, requestedTaskId);
    if (!task) {
      return NextResponse.json({ error: "task not found in this project" }, { status: 404 });
    }
    effectiveTaskId = requestedTaskId;
  }

  const result = retrieveMemories({
    projectId,
    sessionId: auth.session.id,
    taskId: effectiveTaskId,
    query: body.query,
    maxTokens: body.max_tokens,
    scopes: body.scopes,
    types: body.types,
  });

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const projectId = auth.session.project_id;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const url = new URL(req.url);
  const query = url.searchParams.get("query") || undefined;
  const maxTokensParam = url.searchParams.get("max_tokens");
  const parsed = retrievalInput.safeParse({
    query, max_tokens: maxTokensParam === null ? undefined : Number(maxTokensParam),
    scopes: url.searchParams.has("scope") ? [url.searchParams.get("scope")] : undefined,
    types: url.searchParams.has("type") ? [url.searchParams.get("type")] : undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const maxTokens = parsed.data.max_tokens;
  const requestedTaskId = url.searchParams.get("task_id") || url.searchParams.get("taskId");

  // Task authorization for retrieval
  if (requestedTaskId && auth.session.role !== "master") {
    if (!auth.session.task_id || auth.session.task_id !== requestedTaskId) {
      return NextResponse.json(
        { error: "forbidden — worker cannot retrieve another task's memory" },
        { status: 403 }
      );
    }
  }

  let effectiveTaskId = auth.session.task_id;
  if (auth.session.role === "master" && requestedTaskId) {
    const task = getTask(projectId, requestedTaskId);
    if (!task) {
      return NextResponse.json({ error: "task not found in this project" }, { status: 404 });
    }
    effectiveTaskId = requestedTaskId;
  }

  const result = retrieveMemories({
    projectId,
    sessionId: auth.session.id,
    taskId: effectiveTaskId,
    query,
    maxTokens,
    scopes: parsed.data.scopes,
    types: parsed.data.types,
  });

  return NextResponse.json({ ok: true, ...result });
}

