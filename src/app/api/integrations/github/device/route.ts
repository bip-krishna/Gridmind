import { NextResponse } from "next/server";
import { assertLocalGithubRequest, cancelGithubDeviceFlow, githubFlowCookie, requestGithubFlowId, safeGithubError, startGithubDeviceFlow } from "@/lib/github-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertLocalGithubRequest(req);
    const flow = await startGithubDeviceFlow(requestGithubFlowId(req));
    const response = NextResponse.json(flow, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(githubFlowCookie, flow.flowId, { httpOnly: true, sameSite: "strict", secure: new URL(req.url).protocol === "https:",
      path: "/api/integrations/github/device", maxAge: Math.max(1, Math.floor((flow.expiresAt - Date.now()) / 1000)) });
    return response;
  } catch (error) {
    const safe = safeGithubError(error);
    return NextResponse.json({ error: safe.error }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
  }
}
export async function DELETE(req: Request) {
  try {
    assertLocalGithubRequest(req);
    cancelGithubDeviceFlow(requestGithubFlowId(req));
    const response = NextResponse.json({ cancelled: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(githubFlowCookie, "", { httpOnly: true, sameSite: "strict", path: "/api/integrations/github/device", maxAge: 0 });
    return response;
  } catch (error) {
    const safe = safeGithubError(error);
    return NextResponse.json({ error: safe.error }, { status: safe.status });
  }
}
