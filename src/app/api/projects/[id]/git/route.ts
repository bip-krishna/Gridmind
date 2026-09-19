import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import {
  getRepoInfo,
  getLog,
  listBranches,
  getCurrentBranch,
  branchAheadBehind,
  getRecentPrs,
} from "@/lib/git";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [repoInfo, branches, commits, current, aheadBehind, recentPrs] = await Promise.all([
    getRepoInfo(project.repo_path).catch(() => null),
    listBranches(project.repo_path).catch(() => []),
    getLog(project.repo_path, 60).catch(() => []),
    getCurrentBranch(project.repo_path).catch(() => ""),
    branchAheadBehind(project.repo_path).catch(() => ""),
    getRecentPrs(project.repo_path).catch(() => []),
  ]);

  return NextResponse.json({ repoInfo, branches, current, aheadBehind, commits, recentPrs });
}