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
