import { db, createMemory, getMemory, type Memory } from "./db";
import { publish } from "./events";
import { createHash } from "node:crypto";

/** Durable retry queue: a successful engineering action must not silently lose memory. */
export function captureMemory(projectId: string, input: Omit<Parameters<typeof createMemory>[1], "id">) {
  const id = "capture_" + createHash("sha256").update(JSON.stringify([
    projectId, input.scope, input.type, input.content, input.importance ?? 1,
    input.source, input.session_id ?? null, input.task_id ?? null,
  ])).digest("hex");
  if (getMemory(projectId, id)) return flushMemoryCaptures(projectId);
  db().prepare("INSERT OR IGNORE INTO memory_capture_queue (id, project_id, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(id, projectId, JSON.stringify({ ...input, id }), Date.now());
  return flushMemoryCaptures(projectId);
}

export function flushMemoryCaptures(projectId: string): { captured: boolean; pending: number } {
  const rows = db().prepare("SELECT id, payload FROM memory_capture_queue WHERE project_id = ? ORDER BY created_at, id")
    .all(projectId) as { id: string; payload: string }[];
  for (const row of rows) {
    let memory: Memory;
    try {
      memory = db().transaction(() => {
        const result = getMemory(projectId, row.id) ?? createMemory(projectId, JSON.parse(row.payload));
        db().prepare("DELETE FROM memory_capture_queue WHERE id = ?").run(row.id);
        return result;
      })();
    } catch (error) {
      // Do not log the content or raw database error, which can contain private data.
      db().prepare("UPDATE memory_capture_queue SET attempts = attempts + 1 WHERE id = ?").run(row.id);
      console.error("[GridMind] Memory capture pending retry", { projectId, captureId: row.id, errorType: error instanceof Error ? error.name : "Error" });
      continue;
    }
    try {
      publish(projectId, "memory:created", { id: memory.id, scope: memory.scope, type: memory.type, source: memory.source });
    } catch {
      console.error("[GridMind] Memory saved; event notification failed", { projectId, memoryId: memory.id });
    }
  }
  const pending = (db().prepare("SELECT count(*) AS count FROM memory_capture_queue WHERE project_id = ?").get(projectId) as { count: number }).count;
  if (pending > 0) {
    try { publish(projectId, "memory:capture-pending", { pending }); }
    catch { console.error("[GridMind] Pending memory notification failed", { projectId }); }
  }
  return { captured: pending === 0, pending };
}
