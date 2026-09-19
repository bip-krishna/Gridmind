import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { github, parseGithubRepo, createPullRequest } from "@/lib/github";
import { publish } from "@/lib/events";
import { execAsync } from "@/lib/git";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const gh = github();
  const repo = parseGithubRepo(project.github_repo);
  if (!gh || !repo) {
    return NextResponse.json({ error: "GitHub not configured. Set GITHUB_TOKEN and project github_repo." }, { status: 400 });
  }

  const body = (await req.json()) as {
    title?: string;
    head?: string;
    base?: string;
    body?: string;
    push?: boolean;
  };

  const head = body.head?.trim() ?? (await execAsync("git branch --show-current", { cwd: project.repo_path }).then((r) => r.stdout.trim()));
  if (!head) return NextResponse.json({ error: "head branch is required" }, { status: 400 });
  if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });

  try {
    if (body.push) {
      await execAsync(`git push -u origin ${head}`, { cwd: project.repo_path });
    }
    const pr = await createPullRequest(gh, {
      repo,
      title: body.title.trim(),
      head,
      base: body.base?.trim() || "main",
      body: body.body,
    });
    publish(id, "pr:created", { number: pr.number, url: pr.url, head });
    return NextResponse.json({ pr }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "pr creation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}