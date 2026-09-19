import { NextResponse } from "next/server";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
} from "@/lib/db";
import { newId } from "@/lib/agents";
import { invalidateRepoInfo, getRepoInfo } from "@/lib/git";
import fs from "node:fs";

export const runtime = "nodejs";

export async function GET() {
  const projects = listProjects().map((p) => ({ ...p }));
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    name?: string;
    repo_path?: string;
    github_repo?: string;
  };
  const name = body.name?.trim();
  let repoPath = body.repo_path?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!repoPath) return NextResponse.json({ error: "repo_path is required" }, { status: 400 });

  repoPath = repoPath.replace(/^~/, process.env.HOME ?? "");
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    return NextResponse.json({ error: "repo_path is not a valid directory" }, { status: 400 });
  }

  invalidateRepoInfo(repoPath);
  const info = await getRepoInfo(repoPath);
  if (!info.isRepo) {
    return NextResponse.json({ error: "directory is not a git repository" }, { status: 400 });
  }

  const project = createProject({
    id: newId(),
    name,
    repo_path: repoPath,
    github_repo: body.github_repo ?? null,
  });

  invalidateRepoInfo(repoPath);
  return NextResponse.json({ project }, { status: 201 });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.pathname.split("/").pop();
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  deleteProject(id);
  invalidateRepoInfo(project.repo_path);
  return NextResponse.json({ ok: true });
}