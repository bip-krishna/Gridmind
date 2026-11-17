import { NextResponse } from "next/server";
import { assertLocalGithubRequest, connectGithub, disconnectGithub, githubConnectionStatus, safeGithubError } from "@/lib/github-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  try {
    assertLocalGithubRequest(req);
    return NextResponse.json(githubConnectionStatus(), { headers: privateHeaders });
  } catch (error) {
    const safe = safeGithubError(error);
    return NextResponse.json({ error: safe.error }, { status: safe.status, headers: privateHeaders });
  }
}
export async function POST(req: Request) {
  try {
    assertLocalGithubRequest(req);
    let body: unknown;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: "Enter a valid connection request." }, { status: 400, headers: privateHeaders }); }
    const token = body && typeof body === "object" && "token" in body ? body.token : undefined;
    return NextResponse.json(await connectGithub(token), { headers: privateHeaders });
  } catch (error) {
    const safe = safeGithubError(error);
    return NextResponse.json({ error: safe.error }, { status: safe.status, headers: privateHeaders });
  }
}
export async function DELETE(req: Request) {
  try {
    assertLocalGithubRequest(req);
    return NextResponse.json(disconnectGithub(), { headers: privateHeaders });
  } catch (error) {
    const safe = safeGithubError(error);
    return NextResponse.json({ error: safe.error }, { status: safe.status, headers: privateHeaders });
  }
}
