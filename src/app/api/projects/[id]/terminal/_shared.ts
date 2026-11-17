import { getProject } from "@/lib/db";
import { assertLocalTerminalRequest, TerminalError, terminalOwner } from "@/lib/terminal";

export function terminalProject(req: Request, id: string, createOwner = false) {
  assertLocalTerminalRequest(req);
  const project = getProject(id);
  if (!project) throw new TerminalError("Project not found.", 404);
  return { project, ...terminalOwner(req, createOwner) };
}
