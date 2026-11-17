import { NextResponse } from "next/server";
import { getProject, type Project } from "@/lib/db";
import { getRepoInfo, getLog, listBranches } from "@/lib/git";
import { isGithubConfigured, parseGithubRepo } from "@/lib/github";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const repoInfo = await getRepoInfo(project.repo_path);
  const [branches, commits] = await Promise.all([
    listBranches(project.repo_path).catch(() => []),
    getLog(project.repo_path, 30).catch(() => []),
  ]);

  const github = {
    repo: project.github_repo ?? null,
    repoParsed: parseGithubRepo(project.github_repo),
    configured: isGithubConfigured(),
  };

  const payload = {
    project,
    git: { info: repoInfo, branches, commits },
    github,
  };

  return NextResponse.json(payload);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { github_repo?: string | null; name?: string };
  const patch: { github_repo?: string | null; name?: string } = {};
  if ("github_repo" in body) {
    if (body.github_repo !== null && typeof body.github_repo !== "string") return NextResponse.json({ error: "Enter a GitHub repository as owner/repository." }, { status: 400 });
    const repository = parseGithubRepo(body.github_repo);
    if (body.github_repo?.trim() && !repository) return NextResponse.json({ error: "Enter a valid GitHub repository as owner/repository." }, { status: 400 });
    patch.github_repo = repository ? `${repository.owner}/${repository.repo}` : null;
  }
  if ("name" in body && body.name?.trim()) patch.name = body.name.trim();

  const { updateProject } = await import("@/lib/db");
  const updated = updateProject(id, patch);
  return NextResponse.json({ project: updated as Project });
}
