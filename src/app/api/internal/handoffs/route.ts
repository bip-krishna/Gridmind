import { NextResponse } from "next/server";
import { authenticateAgent, validateProject } from "@/lib/internal-auth";
import { getProject } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Placeholder for future handoff system.
 * Currently validates auth and returns a stub response.
 */
export async function POST(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const project = getProject(auth.session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const projCheck = validateProject(auth.session, auth.session.project_id);
  if (!projCheck.ok) return NextResponse.json({ error: projCheck.error }, { status: projCheck.status });

  const body = (await req.json()) as { target?: string; payload?: Record<string, unknown> };

  // Stub: accept and acknowledge, but do not process yet
  return NextResponse.json({
    ok: true,
    message: "handoff received (not yet processed — Stage 2)",
    target: body.target ?? null,
  });
}
