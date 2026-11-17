import { NextResponse } from "next/server";
import { assertLocalGithubRequest, githubRepositories, safeGithubError } from "@/lib/github-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    assertLocalGithubRequest(req);
    const query = new URL(req.url).searchParams.get("q") || "";
    if (query.length > 100) return NextResponse.json({ error: "Repository search must be at most 100 characters." }, { status: 400 });
    return NextResponse.json(await githubRepositories(query), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const safe = safeGithubError(error);
    return NextResponse.json({ error: safe.error }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
  }
}
