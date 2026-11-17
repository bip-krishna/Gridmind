import { terminalFailure, terminalJson, terminalManager, terminalResponse } from "@/lib/terminal";
import { terminalProject } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { owner, cookie } = terminalProject(req, id, true);
    const manager = terminalManager();
    manager.prune();
    return terminalResponse({ sessions: manager.list(id, owner), launchers: manager.launchers() }, 200, cookie);
  } catch (error) { return terminalFailure(error); }
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { project, owner, cookie } = terminalProject(req, id, true);
    const data = await terminalJson(req);
    const terminal = await terminalManager().create(id, owner, project.repo_path, data);
    return terminalResponse({ terminal }, 201, cookie);
  } catch (error) { return terminalFailure(error); }
}
