import { terminalFailure, terminalJson, terminalManager, terminalResponse } from "@/lib/terminal";
import { terminalProject } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; terminalId: string }> }) {
  try {
    const { id, terminalId } = await params;
    const { owner } = terminalProject(req, id);
    const data = await terminalJson(req);
    terminalManager().input(id, owner, terminalId, data.data);
    return terminalResponse({ ok: true });
  } catch (error) { return terminalFailure(error); }
}
