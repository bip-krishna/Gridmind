import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { getProject, getTask, createHandoff, listHandoffs, type HandoffStatus } from "@/lib/db";
import { publish } from "@/lib/events";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

const MAX_SUMMARY_LENGTH = 1000;
const MAX_COMPLETED_WORK_LENGTH = 4000;
const MAX_ARRAY_ITEMS = 50;
const MAX_ITEM_LENGTH = 500;

export async function POST(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const project = getProject(auth.session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  // Derive source session and task strictly server-side
  const sourceSessionId = auth.session.id;
  let sourceTaskId = auth.session.task_id;

  if (auth.session.role === "master") {
    if (typeof body.source_task_id === "string" && body.source_task_id.trim()) {
      const candidateSource = getTask(auth.session.project_id, body.source_task_id.trim());
      if (!candidateSource || candidateSource.project_id !== auth.session.project_id) {
        return NextResponse.json({ error: "source task not found in this project" }, { status: 404 });
      }
      sourceTaskId = candidateSource.id;
    }
  }

  if (!sourceTaskId) {
    return NextResponse.json(
      { error: "source task required — worker session has no assigned task for handoff" },
      { status: 400 }
    );
  }

  // Target task validation
  const targetTaskId = typeof body.target_task_id === "string" ? body.target_task_id.trim() : "";
  if (!targetTaskId) {
    return NextResponse.json({ error: "target_task_id is required" }, { status: 400 });
  }

  const targetTask = getTask(auth.session.project_id, targetTaskId);
  if (!targetTask || targetTask.project_id !== auth.session.project_id) {
    return NextResponse.json(
      { error: "target task not found in this project (cross-project handoffs are rejected)" },
      { status: 404 }
    );
  }

  // Validation: summary
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!summary) {
    return NextResponse.json({ error: "summary is required" }, { status: 400 });
  }
  if (summary.length > MAX_SUMMARY_LENGTH) {
    return NextResponse.json(
      { error: `summary exceeds maximum size of ${MAX_SUMMARY_LENGTH} characters (got ${summary.length})` },
      { status: 400 }
    );
  }

  // Validation: completed_work
  const completedWork = typeof body.completed_work === "string" ? body.completed_work.trim() : "";
  if (!completedWork) {
    return NextResponse.json({ error: "completed_work is required" }, { status: 400 });
  }
  if (completedWork.length > MAX_COMPLETED_WORK_LENGTH) {
    return NextResponse.json(
      { error: `completed_work exceeds maximum size of ${MAX_COMPLETED_WORK_LENGTH} characters (got ${completedWork.length})` },
      { status: 400 }
    );
  }

  // Validation helper for string arrays
  function validateStringArray(
    val: unknown,
    fieldName: string,
    maxItems = MAX_ARRAY_ITEMS,
    maxItemLen = MAX_ITEM_LENGTH
  ): { ok: true; items: string[] } | { ok: false; error: string } {
    if (val === undefined || val === null) return { ok: true, items: [] };
    if (!Array.isArray(val)) {
      return { ok: false, error: `${fieldName} must be an array of strings` };
    }
    if (val.length > maxItems) {
      return { ok: false, error: `${fieldName} exceeds maximum item count of ${maxItems} (got ${val.length})` };
    }
    const items: string[] = [];
    for (let i = 0; i < val.length; i++) {
      const item = val[i];
      if (typeof item !== "string") {
        return { ok: false, error: `${fieldName}[${i}] must be a string` };
      }
      if (item.length > maxItemLen) {
        return { ok: false, error: `${fieldName}[${i}] exceeds maximum length of ${maxItemLen} characters` };
      }
      items.push(item);
    }
    return { ok: true, items };
  }

  const filesVal = validateStringArray(body.changed_files, "changed_files", 50, 200);
  if (!filesVal.ok) return NextResponse.json({ error: filesVal.error }, { status: 400 });

  const decisionsVal = validateStringArray(body.decisions, "decisions", 20, 500);
  if (!decisionsVal.ok) return NextResponse.json({ error: decisionsVal.error }, { status: 400 });

  const blockersVal = validateStringArray(body.blockers, "blockers", 20, 500);
  if (!blockersVal.ok) return NextResponse.json({ error: blockersVal.error }, { status: 400 });

  const nextStepsVal = validateStringArray(body.next_steps, "next_steps", 20, 500);
  if (!nextStepsVal.ok) return NextResponse.json({ error: nextStepsVal.error }, { status: 400 });

  const handoffId = nanoid(14);
  const handoff = createHandoff(auth.session.project_id, {
    id: handoffId,
    source_session_id: sourceSessionId,
    source_task_id: sourceTaskId,
    target_task_id: targetTaskId,
    summary,
    completed_work: completedWork,
    changed_files: filesVal.items,
    decisions: decisionsVal.items,
    blockers: blockersVal.items,
    next_steps: nextStepsVal.items,
    status: "pending",
  });

  // Emit real-time event without leaking private memory/content
  publish(auth.session.project_id, "handoff:created", {
    handoff_id: handoff.id,
    project_id: auth.session.project_id,
    source_task_id: handoff.source_task_id,
    target_task_id: handoff.target_task_id,
  });

  return NextResponse.json({ ok: true, handoff }, { status: 201 });
}

export async function GET(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const project = getProject(auth.session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const url = new URL(req.url);
  const requestedTaskId = url.searchParams.get("task_id") || url.searchParams.get("taskId");
  const requestedStatus = url.searchParams.get("status") as HandoffStatus | null;

  // Worker authorization
  if (auth.session.role !== "master") {
    if (requestedTaskId && requestedTaskId !== auth.session.task_id) {
      return NextResponse.json(
        { error: "forbidden — worker cannot inspect another task's handoffs" },
        { status: 403 }
      );
    }

    const assignedTaskId = auth.session.task_id;
    if (!assignedTaskId) {
      return NextResponse.json({ ok: true, handoffs: [] });
    }

    const handoffs = listHandoffs(auth.session.project_id, {
      task_id: assignedTaskId,
      status: requestedStatus ?? undefined,
    });

    return NextResponse.json({ ok: true, handoffs });
  }

  // Master authorization
  let filterTaskId: string | undefined = undefined;
  if (requestedTaskId) {
    const task = getTask(auth.session.project_id, requestedTaskId);
    if (!task) {
      return NextResponse.json({ error: "task not found in this project" }, { status: 404 });
    }
    filterTaskId = requestedTaskId;
  }

  const handoffs = listHandoffs(auth.session.project_id, {
    task_id: filterTaskId,
    status: requestedStatus ?? undefined,
  });

  return NextResponse.json({ ok: true, handoffs });
}
