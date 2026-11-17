import { terminalFailure, terminalManager, terminalResponse } from "@/lib/terminal";
import { terminalProject } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; terminalId: string }> }) {
  try {
    const { id, terminalId } = await params;
    const { owner } = terminalProject(req, id);
    return terminalResponse({ terminal: terminalManager().get(id, owner, terminalId) });
  } catch (error) { return terminalFailure(error); }
}
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; terminalId: string }> }) {
  try {
    const { id, terminalId } = await params;
    const { owner } = terminalProject(req, id);
    return terminalResponse({ terminal: await terminalManager().stop(id, owner, terminalId) });
  } catch (error) { return terminalFailure(error); }
}
