import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { retrieveMemories } from "@/lib/memory";
import { authenticateAgent } from "@/lib/internal-auth";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const url = new URL(req.url);
  const taskId = url.searchParams.get("task_id") || undefined;
  const query = url.searchParams.get("query") || undefined;
  const maxTokensParam = url.searchParams.get("max_tokens");
  const maxTokens = maxTokensParam ? parseInt(maxTokensParam, 10) : undefined;

  // SEC-04: Never allow caller to supply session_id via query param to unlock private memory.
  // Private memory is ONLY accessible if request carries a valid Bearer token for that session.
  let authenticatedSessionId: string | undefined = undefined;
  let effectiveTaskId = taskId;
  const auth = authenticateAgent(req);
  if (auth.ok) {
    if (auth.session.project_id !== id) {
      return NextResponse.json({ error: "project mismatch — agent does not belong to this project" }, { status: 403 });
    }
    authenticatedSessionId = auth.session.id;

    // Cross-task authorization:
    // A worker session cannot pass taskId of another task to access its context.
    if (auth.session.role !== "master") {
      if (taskId && taskId !== auth.session.task_id) {
        return NextResponse.json(
          { error: "forbidden — worker cannot access another task's context" },
          { status: 403 }
        );
      }
      effectiveTaskId = auth.session.task_id ?? undefined;
    }
  }

  const result = retrieveMemories({
    projectId: id,
    sessionId: authenticatedSessionId,
    taskId: effectiveTaskId,
    query,
    maxTokens,
  });

  return NextResponse.json({ ok: true, ...result });
}
