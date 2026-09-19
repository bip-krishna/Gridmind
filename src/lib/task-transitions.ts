/**
 * Task status transition rules.
 *
 * Terminal states (done, failed) cannot transition to any other state.
 * All other transitions are validated against the allowed map.
 */

const TRANSITIONS: Record<string, string[]> = {
  todo: ["queued", "in_progress"],
  queued: ["in_progress", "failed"],
  in_progress: ["done", "failed", "blocked"],
  blocked: ["in_progress", "failed"],
  // done and failed are terminal — no outgoing transitions
};

const TERMINAL = new Set(["done", "failed"]);

/**
 * Returns null if the transition is valid, or an error message if not.
 */
export function validateTaskTransition(from: string, to: string): string | null {
  if (from === to) return null; // idempotent — no-op transition is allowed
  if (TERMINAL.has(from)) {
    return `task is in terminal state "${from}" and cannot transition to "${to}"`;
  }
  const allowed = TRANSITIONS[from];
  if (!allowed) {
    return `unknown task status "${from}"`;
  }
  if (!allowed.includes(to)) {
    return `invalid transition from "${from}" to "${to}". Allowed: ${allowed.join(", ")}`;
  }
  return null;
}

/**
 * Check if a status is terminal.
 */
export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}
