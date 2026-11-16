import { NextResponse } from "next/server";
import { isGithubConfigured } from "@/lib/github";
import { adaptersStatus } from "@/lib/agents";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    db().prepare("SELECT 1").get();
    const pending = (db().prepare("SELECT count(*) AS count FROM memory_capture_queue").get() as { count: number }).count;
    return NextResponse.json({ ok: true, database: "ready", pendingMemoryCaptures: pending,
      githubConfigured: isGithubConfigured(), agents: adaptersStatus() });
  } catch {
    return NextResponse.json({ ok: false, database: "unavailable", error: "Database initialization or readiness check failed" }, { status: 503 });
  }
}
