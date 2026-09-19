"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LiveEvent = {
  id: number;
  projectId: string;
  type: string;
  payload: Record<string, unknown>;
  ts: number;
};

const REFRESH_TYPES: Set<string> = new Set([
  "agent:started",
  "agent:finished",
  "agent:error",
  "task:created",
  "task:updated",
  "task:deleted",
  "task:started",
  "task:completed",
  "task:failed",
  "task:blocked",
  "session:started",
  "session:finished",
  "git:commit",
  "git:branch-created",
  "git:branch-checkout",
  "context:set",
  "context:deleted",
  "decision:created",
  "issue:imported",
  "pr:created",
  "agentsetup:master",
  "agentsetup:change",
]);
export { REFRESH_TYPES };
export type { LiveEvent };

export function useSSE(projectId: string, onEvent?: (e: LiveEvent) => void) {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const es = new EventSource(`/api/projects/${projectId}/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as LiveEvent;
        if (onEventRef.current) onEventRef.current(data);
      } catch {
        /* keepalive */
      }
    };
    return () => es.close();
  }, [projectId]);

  return { connected };
}

export function useProjectPoll(projectId: string, intervalMs = 9000): {
  refreshKey: number;
  bump: () => void;
  connected: boolean;
} {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  const { connected } = useSSE(projectId, (e) => {
    if (REFRESH_TYPES.has(e.type)) bump();
  });

  useEffect(() => {
    const t = setInterval(bump, intervalMs);
    return () => clearInterval(t);
  }, [bump, intervalMs]);

  return { refreshKey, bump, connected };
}

export type FetchState<T> = { data: T | null; error: string | null; loading: boolean };

export function useFetch<T>(url: string, refreshKey: number): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: null, error: null, loading: true });

  useEffect(() => {
    let ignore = false;
    setState((s) => ({ ...s, loading: true }));
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (!ignore) setState({ data: data as T, error: null, loading: false });
      })
      .catch((err) => {
        if (!ignore) setState({ data: null, error: String(err), loading: false });
      });
    return () => {
      ignore = true;
    };
  }, [url, refreshKey]);

  return state;
}