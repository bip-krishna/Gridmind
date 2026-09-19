import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { recentEvents } from "@/lib/events";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const after = Number(url.searchParams.get("after") ?? 0);
  const events = recentEvents(id, 200).filter((e) => e.id > after);
  return NextResponse.json({ events });
}