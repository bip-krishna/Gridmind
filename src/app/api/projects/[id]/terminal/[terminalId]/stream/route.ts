import { terminalFailure, terminalStream } from "@/lib/terminal";
import { terminalProject } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; terminalId: string }> }) {
  try {
    const { id, terminalId } = await params;
    const { owner } = terminalProject(req, id);
    return terminalStream(req, id, owner, terminalId);
  } catch (error) { return terminalFailure(error); }
}
