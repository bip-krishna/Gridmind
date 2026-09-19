import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { detectMergeConflicts, listBranches, getCurrentBranch } from "@/lib/git";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const target = url.searchParams.get("target") ?? undefined;

  const [current, branches] = await Promise.all([
    getCurrentBranch(project.repo_path).catch(() => ""),
    listBranches(project.repo_path).catch(() => []),
  ]);

  const baseBranch = target && target !== current ? target : branches.find((b) => b !== current);
  if (!baseBranch) return NextResponse.json({ conflicts: [], scanned: null });

  const conflicts = await detectMergeConflicts(project.repo_path, baseBranch).catch(() => []);
  const info = await import("@/lib/git").then((m) => m.getRepoInfo(project.repo_path));

  return NextResponse.json({
    conflicts,
    scanned: {
      current,
      target: baseBranch,
      dirty: info?.dirty ?? false,
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { target?: string };
  const url = new URL(req.url);
  void url;

  const [current, branches] = await Promise.all([
    getCurrentBranch(project.repo_path).catch(() => ""),
    listBranches(project.repo_path).catch(() => []),
  ]);
  const target = body.target ?? branches.find((b) => b !== current);
  if (!target) return NextResponse.json({ conflicts: [], scanned: null });

  const conflicts = await detectMergeConflicts(project.repo_path, target).catch(() => []);
  return NextResponse.json({ conflicts, scanned: { current, target } });
}