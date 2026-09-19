import type { EventRecord } from "./db";
import { insertEvent, listEvents } from "./db";

export type BusHandlers = { [projectId: string]: Set<(e: EventRecord) => void> };

const globalForBus = globalThis as unknown as {
  __gridmindBus?: { handlers: BusHandlers };
};

function bus(): { handlers: BusHandlers } {
  if (!globalForBus.__gridmindBus) globalForBus.__gridmindBus = { handlers: {} };
  return globalForBus.__gridmindBus;
}

export function publish(projectId: string, type: string, payload: unknown): EventRecord {
  const record = insertEvent(projectId, type, payload);
  const handlers = bus().handlers[projectId];
  if (handlers) {
    for (const h of Array.from(handlers)) {
      try {
        h(record);
      } catch {
        /* subscriber error ignored */
      }
    }
  }
  return record;
}

export function subscribe(
  projectId: string,
  handler: (e: EventRecord) => void
): () => void {
  const handlers = bus().handlers;
  if (!handlers[projectId]) handlers[projectId] = new Set();
  handlers[projectId].add(handler);
  return () => {
    handlers[projectId].delete(handler);
    if (handlers[projectId].size === 0) delete handlers[projectId];
  };
}

export function recentEvents(projectId: string, limit = 100): EventRecord[] {
  return listEvents(projectId, limit);
}

export function toEventJSON(e: EventRecord): string {
  const payload = JSON.parse(e.payload);
  return JSON.stringify({ id: e.id, projectId: e.project_id, type: e.type, payload, ts: e.created_at });
}