import { NextResponse } from "next/server";
import { authenticateAgent, validateProject } from "@/lib/internal-auth";
import { getProject } from "@/lib/db";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

const VALID_EVENT_TYPES = [
  "agent:status",
  "agent:progress",
  "agent:decision",
  "agent:context",
  "agent:result",
];

export async function POST(req: Request) {
  const auth = authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const project = getProject(auth.session.project_id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const projCheck = validateProject(auth.session, auth.session.project_id);
  if (!projCheck.ok) return NextResponse.json({ error: projCheck.error }, { status: projCheck.status });

  const body = (await req.json()) as { type?: string; payload?: Record<string, unknown> };

  if (!body.type) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }

  if (!VALID_EVENT_TYPES.includes(body.type)) {
    return NextResponse.json(
      { error: `invalid event type: ${body.type}. Valid: ${VALID_EVENT_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const payload = {
    ...(body.payload ?? {}),
    agent: auth.session.agent_type,
    sessionId: auth.session.id,
  };

  publish(auth.session.project_id, body.type, payload);

  return NextResponse.json({ ok: true, type: body.type });
}
