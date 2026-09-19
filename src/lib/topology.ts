import type { AgentRole } from "@/lib/db";

export type AgentCardInfo = {
  id: string;
  name: string;
  agent_type: string;
  role: AgentRole;
  connected: boolean;
  working: boolean;
  statusLabel: string;
  statusTone: "green" | "amber" | "dim";
  taskTitle: string | null;
  branch: string | null;
  sessionId: string | null;
};

export type TopologyMember = {
  id: string;
  name: string;
  agent_type: string;
  role: AgentRole | string;
};

type OrchestrationLike = {
  master: TopologyMember | null;
  subagents: TopologyMember[];
};

type SessionLike = {
  id: string;
  agent_type: string;
  role: string;
  status: string;
  active: boolean;
  started_at: number;
};

type TaskLike = {
  id: string;
  title: string;
  status: string;
  assigned_agent: string | null;
  updated_at?: number;
};

export const AGENT_ROLE_LABEL: Record<AgentRole, string> = {
  master: "Master",
  worker: "Worker",
  reviewer: "Reviewer",
};

export function normalizeRole(role: string): AgentRole {
  if (role === "reviewer" || role === "master") return role;
  return "worker";
}

/** Static card (no live sessions) for a configured agent — used in assignment maps. */
export function memberToCard(
  m: TopologyMember,
  adapters: Record<string, { available: boolean; label: string }>
): AgentCardInfo {
  const connected = adapters[m.agent_type]?.available ?? false;
  return {
    id: m.id,
    name: m.name,
    agent_type: m.agent_type,
    role: normalizeRole(m.role),
    connected,
    working: false,
    statusLabel: connected ? "Idle" : "Offline",
    statusTone: connected ? "green" : "dim",
    taskTitle: null,
    branch: null,
    sessionId: null,
  };
}

function matchesAgentType(s: { agent_type: string }, agentType: string): boolean {
  return s.agent_type === agentType;
}

/** Latest session for an agent: prefer live sessions, then most recent by started_at. */
function latestSession(card: TopologyMember, sessions: SessionLike[]): SessionLike | null {
  const ofType = sessions.filter((s) => matchesAgentType(s, card.agent_type));
  if (ofType.length === 0) return null;
  const active = ofType.find((s) => s.active);
  if (active) return active;
  return ofType.reduce<SessionLike | null>((acc, s) => (acc === null || s.started_at > acc.started_at ? s : acc), null);
}

function latestTaskTitle(card: TopologyMember, tasks: TaskLike[]): string | null {
  const isMaster = card.role === "master";
  const relevant = tasks.filter((t) => {
    if (isMaster) return t.assigned_agent === "auto" || t.assigned_agent === "master";
    return t.assigned_agent === card.agent_type;
  });
  if (relevant.length === 0) return null;
  return (
    relevant.find((t) => t.status !== "done")?.title ??
    relevant[0].title ??
    null
  );
}

export function composeTopologyCards(opts: {
  orchestration: OrchestrationLike;
  sessions: SessionLike[];
  tasks: TaskLike[];
  branch: string | null;
  adapters: Record<string, { available: boolean; label: string }>;
}): AgentCardInfo[] {
  const { orchestration, sessions, tasks, branch, adapters } = opts;
  const team = orchestration.master
    ? [orchestration.master, ...orchestration.subagents]
    : orchestration.subagents;

  return team.map((a) => {
    const adapter = adapters[a.agent_type];
    const connected = adapter?.available ?? false;
    const live = latestSession(a, sessions);
    const working = live?.active ?? false;
    const role = normalizeRole(a.role);
    return {
      id: a.id,
      name: a.name,
      agent_type: a.agent_type,
      role,
      connected,
      working,
      statusLabel: working ? "Working" : connected ? "Idle" : "Offline",
      statusTone: working ? "amber" : connected ? "green" : "dim",
      taskTitle: latestTaskTitle(a, tasks),
      branch: branch ?? null,
      sessionId: live?.id ?? null,
    };
  });
}
