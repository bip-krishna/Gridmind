import { NextResponse } from "next/server";
import { getProject, getTask } from "@/lib/db";
import { provisionWorktree, removeWorktree, reconcileWorktree, inspectWorktree } from "@/lib/worktree";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as {
    action: string;
    taskId?: string;
    force?: boolean;
  };

  if (!body.taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const task = getTask(id, body.taskId);
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  try {
    switch (body.action) {
      case "provision": {
        const updated = await provisionWorktree(id, body.taskId);
        return NextResponse.json({ task: updated });
      }
      case "remove": {
        const updated = await removeWorktree(id, body.taskId, body.force ?? false);
        return NextResponse.json({ task: updated });
      }
      case "reconcile": {
        await reconcileWorktree(id, body.taskId);
        const updated = getTask(id, body.taskId);
        return NextResponse.json({ task: updated });
      }
      case "inspect": {
        const result = await inspectWorktree(id, body.taskId);
        if (!result) {
          return NextResponse.json({ error: "no worktree for this task" }, { status: 404 });
        }
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "worktree operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
