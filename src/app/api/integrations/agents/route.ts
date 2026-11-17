import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { assertLocalGithubRequest, GithubConnectionError } from "@/lib/github-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  try {
    assertLocalGithubRequest(req);
    const launcher = path.join(process.cwd(), "bin", "gridmind.mjs");
    if (!fs.existsSync(launcher)) {
      return NextResponse.json({ error: "Start the dashboard from your Gridmind installation folder to generate agent setup commands." },
        { status: 503, headers: privateHeaders });
    }
    return NextResponse.json({ platform: process.platform, node: process.execPath, launcher,
      shell: process.platform === "win32" ? "powershell" : "posix" }, { headers: privateHeaders });
  } catch (error) {
    const status = error instanceof GithubConnectionError ? error.status : 500;
    return NextResponse.json({ error: status === 403 ? "Agent setup is available from the local Gridmind dashboard." : "Could not load agent setup. Please try again." },
      { status, headers: privateHeaders });
  }
}
