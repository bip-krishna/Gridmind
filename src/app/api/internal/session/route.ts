import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { getProject, getTask } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Returns authenticated session identity for the caller.
 * Used by MCP and internal agents to discover their project, session, role, and task.
 */
export async function GET(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const session = auth.session;
  const project = getProject(session.project_id);
  const task = session.task_id ? getTask(session.project_id, session.task_id) : null;

  return NextResponse.json({
    ok: true,
    session_id: session.id,
    project_id: session.project_id,
    task_id: session.task_id,
    role: session.role,
    agent_type: session.agent_type,
    title: session.title,
    status: session.status,
    project: project ? { id: project.id, name: project.name } : null,
    task: task ? {
      id: task.id,
      title: task.title,
      status: task.status,
      branch: task.branch,
      worktree_path: task.worktree_path,
    } : null,
  });
}
