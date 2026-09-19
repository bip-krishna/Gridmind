import { NextResponse } from "next/server";
import { isGithubConfigured } from "@/lib/github";
import { adaptersStatus } from "@/lib/agents";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    githubConfigured: isGithubConfigured(),
    agents: adaptersStatus(),
  });
}