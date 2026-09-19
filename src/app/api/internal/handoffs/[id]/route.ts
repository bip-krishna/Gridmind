import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { getProject, getHandoff } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const project = getProject(auth.session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const { id } = await params;
  const handoff = getHandoff(auth.session.project_id, id);

  if (!handoff) {
    return NextResponse.json({ error: "handoff not found in this project" }, { status: 404 });
  }

  // Worker authorization check
  if (auth.session.role !== "master") {
    const isSource = auth.session.task_id && handoff.source_task_id === auth.session.task_id;
    const isTarget = auth.session.task_id && handoff.target_task_id === auth.session.task_id;

    if (!isSource && !isTarget) {
      return NextResponse.json(
        { error: "forbidden — worker cannot inspect handoffs for another task" },
        { status: 403 }
      );
    }
  }

  return NextResponse.json({ ok: true, handoff });
}
