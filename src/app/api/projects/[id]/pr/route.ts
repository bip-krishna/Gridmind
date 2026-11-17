import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { github, parseGithubRepo, createPullRequest } from "@/lib/github";
import { publish } from "@/lib/events";
import { validatePrBranch, currentPrBranch, pushPrBranch, githubPushTargetMatches } from "@/lib/github-pr";

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

  let body: {
    title?: string;
    head?: string;
    base?: string;
    body?: string;
    push?: boolean;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Enter a valid pull request." }, { status: 400 }); }
  if (!body || typeof body.title !== "string" || !body.title.trim() || body.title.length > 256
    || (body.body !== undefined && (typeof body.body !== "string" || body.body.length > 60000))
    || (body.push !== undefined && typeof body.push !== "boolean")) {
    return NextResponse.json({ error: "Provide a title (up to 256 characters), valid description, and push option." }, { status: 400 });
  }

  try {
    const head = await validatePrBranch(project.repo_path, body.head ?? await currentPrBranch(project.repo_path));
    const base = await validatePrBranch(project.repo_path, body.base ?? "main");
    if (!head || !base) return NextResponse.json({ error: "Choose valid head and base branches." }, { status: 400 });
    if (head === base) return NextResponse.json({ error: "Choose a branch different from the merge destination." }, { status: 400 });
    if (body.push) {
      if (!await githubPushTargetMatches(project.repo_path, repo)) return NextResponse.json({ error: "Your local origin does not match the linked GitHub repository. Check the repository selection and Git remote before pushing." }, { status: 400 });
      await pushPrBranch(project.repo_path, head);
    }
    const pr = await createPullRequest(gh, {
      repo,
      title: body.title.trim(),
      head,
      base,
      body: body.body,
    });
    publish(id, "pr:created", { number: pr.number, url: pr.url, head });
    return NextResponse.json({ pr }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "The pull request could not be created. Check repository permissions, that the branch is pushed, and your Git credentials before retrying." }, { status: 502 });
  }
}
