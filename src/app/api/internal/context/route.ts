import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { setContext, getProject } from "@/lib/db";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const project = getProject(auth.session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const body = (await req.json()) as { key?: string; value?: string };

  if (!body.key?.trim()) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  if (body.value === undefined || body.value === null) {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }

  setContext(auth.session.project_id, body.key.trim(), body.value);

  publish(auth.session.project_id, "context:set", {
    key: body.key.trim(),
    agent: auth.session.agent_type,
    sessionId: auth.session.id,
  });

  return NextResponse.json({ ok: true, key: body.key.trim() });
}

export async function GET(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const requestedTaskId = url.searchParams.get("task_id") || url.searchParams.get("taskId");

  // Worker cross-task authorization check
  if (requestedTaskId && auth.session.role !== "master") {
    if (!auth.session.task_id || auth.session.task_id !== requestedTaskId) {
      return NextResponse.json(
        { error: "forbidden — worker cannot access another task's context" },
        { status: 403 }
      );
    }
  }

  const { getTask, listContext } = await import("@/lib/db");
  const { retrieveMemories } = await import("@/lib/memory");
  const { retrieveTaskHandoffs } = await import("@/lib/handoff");

  let effectiveTaskId = auth.session.task_id;
  if (auth.session.role === "master" && requestedTaskId) {
    const task = getTask(auth.session.project_id, requestedTaskId);
    if (!task) {
      return NextResponse.json({ error: "task not found in this project" }, { status: 404 });
    }
    effectiveTaskId = requestedTaskId;
  }

  const project = getProject(auth.session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const task = effectiveTaskId ? getTask(auth.session.project_id, effectiveTaskId) : null;
  const projectContext = listContext(auth.session.project_id);

  // Retrieve relevant memory context for the task/session
  const memoryResult = retrieveMemories({
    projectId: auth.session.project_id,
    sessionId: auth.session.id,
    taskId: effectiveTaskId,
    maxTokens: 1000,
  });

  // Stage 5B: Retrieve relevant handoffs for the task
  const handoffsResult = effectiveTaskId
    ? retrieveTaskHandoffs({
        projectId: auth.session.project_id,
        taskId: effectiveTaskId,
        maxTokens: 600,
      })
    : { handoffs: [], handoffsBrief: "", tokensUsed: 0, totalCandidates: 0, omittedCount: 0 };

  return NextResponse.json({
    ok: true,
    project: {
      id: project.id,
      name: project.name,
      repo_path: project.repo_path,
    },
    task: task ? {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      branch: task.branch,
      worktree_path: task.worktree_path,
    } : null,
    context: projectContext,
    memories: memoryResult.memories,
    contextBrief: memoryResult.contextBrief,
    handoffs: handoffsResult.handoffs,
    handoffsBrief: handoffsResult.handoffsBrief,
  });
}

