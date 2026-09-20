import { NextResponse } from "next/server";
import { getProject, listContext, setContext, deleteContext, buildContextBrief, listMemories } from "@/lib/db";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    context: listContext(id),
    brief: buildContextBrief(id),
    memories: listMemories(id, { includeArchived: false }),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { key?: string; value?: string };
  if (!body.key?.trim()) return NextResponse.json({ error: "key is required" }, { status: 400 });
  const key = body.key.trim();
  const value = body.value ?? "";

  setContext(id, key, value);
  publish(id, "context:set", { key, value, actor: "gridmind" });
  return NextResponse.json({ context: listContext(id) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  deleteContext(id, key);
  publish(id, "context:deleted", { key });
  return NextResponse.json({ context: listContext(id) });
}