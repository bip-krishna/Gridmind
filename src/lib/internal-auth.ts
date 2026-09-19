import { getSessionByToken, type Session } from "./db";

export type AuthResult =
  | { ok: true; session: Session }
  | { ok: false; error: string; status: number };

/**
 * Authenticate an agent request via Bearer token.
 * The token is unique per session and generated at spawn time.
 */
export function authenticateAgent(req: Request): AuthResult {
  const auth = req.headers.get("authorization");
  if (!auth) {
    return { ok: false, error: "missing Authorization header", status: 401 };
  }

  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, error: "invalid Authorization format (expected Bearer <token>)", status: 401 };
  }

  const token = match[1].trim();
  if (!token) {
    return { ok: false, error: "empty token", status: 401 };
  }

  const session = getSessionByToken(token);
  if (!session) {
    return { ok: false, error: "invalid token", status: 401 };
  }

  return { ok: true, session };
}

/** Validate that a request targets the same project as the authenticated session. */
export function validateProject(session: Session, projectId: string): AuthResult {
  if (session.project_id !== projectId) {
    return { ok: false, error: "project mismatch — agent does not belong to this project", status: 403 };
  }
  return { ok: true, session };
}
