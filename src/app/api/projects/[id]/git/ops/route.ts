import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import {
  getCurrentBranch,
  createBranch,
  checkoutBranch,
  listBranches,
  commitAll,
  diffByCommit,
  diffWorkingTree,
  getRepoInfo,
  type GitDiffFile,
} from "@/lib/git";
import { publish } from "@/lib/events";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as {
    action: string;
    branch?: string;
    message?: string;
    base?: string;
  };

  try {
    switch (body.action) {
      case "create-branch": {
        if (!body.branch?.trim()) return NextResponse.json({ error: "branch is required" }, { status: 400 });
        await createBranch(project.repo_path, body.branch.trim());
        publish(id, "git:branch-created", { branch: body.branch.trim() });
        return NextResponse.json({ ok: true, current: body.branch.trim(), branches: await listBranches(project.repo_path) });
      }
      case "checkout": {
        if (!body.branch?.trim()) return NextResponse.json({ error: "branch is required" }, { status: 400 });
        await checkoutBranch(project.repo_path, body.branch.trim());
        publish(id, "git:branch-checkout", { branch: body.branch.trim() });
        return NextResponse.json({ ok: true, current: body.branch.trim(), branches: await listBranches(project.repo_path) });
      }
      case "commit": {
        if (!body.message?.trim()) return NextResponse.json({ error: "message is required" }, { status: 400 });
        await commitAll(project.repo_path, body.message.trim());
        const [current, info] = await Promise.all([
          getCurrentBranch(project.repo_path),
          getRepoInfo(project.repo_path),
        ]);
        publish(id, "git:commit", { branch: current, message: body.message.trim() });
        return NextResponse.json({ ok: true, current, dirty: info.dirty });
      }
      case "diff": {
        const files: GitDiffFile[] = body.base
          ? await diffByCommit(project.repo_path, body.base)
          : await diffWorkingTree(project.repo_path);
        return NextResponse.json({ files });
      }
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "git operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}