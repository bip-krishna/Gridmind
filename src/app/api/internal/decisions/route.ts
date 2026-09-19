import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/internal-auth";
import { createDecision, getProject } from "@/lib/db";
import { newId } from "@/lib/agents";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const project = getProject(auth.session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const body = (await req.json()) as { title?: string; body?: string };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!body.body?.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const decision = createDecision(auth.session.project_id, {
    id: newId(),
    title: body.title.trim(),
    body: body.body.trim(),
  });

  publish(auth.session.project_id, "decision:created", {
    id: decision.id,
    title: decision.title,
    agent: auth.session.agent_type,
    sessionId: auth.session.id,
  });

  return NextResponse.json({ decision }, { status: 201 });
}
