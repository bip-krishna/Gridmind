import { NextResponse } from "next/server";
import { assertLocalGithubRequest, githubFlowCookie, pollGithubDeviceFlow, requestGithubFlowId, safeGithubError } from "@/lib/github-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertLocalGithubRequest(req);
    let body: unknown;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: "Enter a valid sign-in request." }, { status: 400 }); }
    const flowId = body && typeof body === "object" && "flowId" in body ? body.flowId : undefined;
    const result = await pollGithubDeviceFlow(flowId, requestGithubFlowId(req));
    const response = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    if (result.status === "connected") response.cookies.set(githubFlowCookie, "", { httpOnly: true, sameSite: "strict", path: "/api/integrations/github/device", maxAge: 0 });
    return response;
  } catch (error) {
    const safe = safeGithubError(error);
    return NextResponse.json({ error: safe.error }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
  }
}
