import { NextResponse } from "next/server";
import { getProject, listDecisions, createDecision } from "@/lib/db";
import { publish } from "@/lib/events";
import { newId } from "@/lib/agents";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ decisions: listDecisions(id) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { title?: string; body?: string };
  if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const decision = createDecision(id, {
    id: newId(),
    title: body.title.trim(),
    body: body.body ?? "",
  });
  publish(id, "decision:created", { id: decision.id, title: decision.title });
  return NextResponse.json({ decision }, { status: 201 });
}