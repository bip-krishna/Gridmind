"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn, extractRepoName } from "@/lib/utils";
import { useProjectPoll, useSSE } from "@/lib/hooks";
import { Input, Button, Card, CardHeader, Dot, Empty, Spinner } from "@/components/ui";
import { AgentsPanel } from "@/components/panels/agents-panel";
import { TasksPanel } from "@/components/panels/tasks-panel";
import { GitPanel } from "@/components/panels/git-panel";
import { TimelinePanel } from "@/components/panels/timeline-panel";
import { GithubPanel } from "@/components/panels/github-panel";
import { ContextPanel } from "@/components/panels/context-panel";
import { AgentSetupPanel } from "@/components/panels/agentsetup-panel";
import { TeamGraph } from "@/components/topology";
import { composeTopologyCards, type AgentCardInfo } from "@/lib/topology";

type Tab = "overview" | "agents" | "tasks" | "git" | "timeline" | "github" | "context" | "agentsetup";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    id: "agents",
    label: "Agents",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="10" rx="2" />
        <path d="M8 21h8M12 14v7" />
      </svg>
    ),
  },
  {
    id: "agentsetup",
    label: "Agent Setup",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <path d="M17 14v5M14.5 16.5h5" />
      </svg>
    ),
  },
  {
    id: "tasks",
    label: "Tasks",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="6" height="6" rx="1" />
        <path d="M12 8h9M12 14h9M12 20h9" />
        <path d="M5 15l1.5 1.5L9 14" />
      </svg>
    ),
  },
  {
    id: "git",
    label: "Git",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
        <path d="M6 9v6M6 9c6 0 8 3 9 6" /><circle cx="18" cy="15" r="3" />
        <path d="M6 15c6 0 8-3 9-6" />
      </svg>
    ),
  },
  {
    id: "timeline",
    label: "Timeline",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="6" r="2" /><circle cx="5" cy="12" r="2" /><circle cx="19" cy="12" r="2" /><circle cx="12" cy="18" r="2" />
        <path d="M12 8v8M7 12h4M2 12h3M17 12h5" />
      </svg>
    ),
  },
  {
    id: "github",
    label: "GitHub",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v6M12 16v6M2 12h6M16 12h6" />
      </svg>
    ),
  },
  {
    id: "context",
    label: "Context",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
];

export function ControlPlane({
  projectId,
  projectName,
  repoPath,
  githubRepo,
}: {
  projectId: string;
  projectName: string;
  repoPath: string;
  githubRepo: string | null;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const { refreshKey, bump, connected } = useProjectPoll(projectId);
  const [poked, setPoked] = useState(false);

  function openSession(sessionId: string) {
    setFocusSessionId(sessionId);
    setTab("agents");
  }

  async function poke() {
    try {
      await fetch(`/api/projects/${projectId}/stream/poke`, { method: "POST" });
      setPoked(true);
      setTimeout(() => setPoked(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-14 flex-col border-r border-border bg-bg-elevated md:w-52">
        <div className="mb-4 flex items-center gap-2.5 border-b border-border px-3 py-3.5 md:px-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-accent/40 bg-accent-soft">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7c8cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <div className="hidden min-w-0 md:block">
            <div className="truncate text-[13px] font-semibold text-fg">{projectName}</div>
            <div className="truncate text-[10px] text-fg-dim">{extractRepoName(repoPath)}</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-2 md:px-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors duration-100 cursor-pointer",
                tab === t.id
                  ? "bg-bg-subtle text-fg border border-border-strong"
                  : "text-fg-muted hover:text-fg hover:bg-bg-subtle/60 border border-transparent",
                tab !== t.id && "md:px-3"
              )}
            >
              <span className="shrink-0 text-fg-dim">{t.icon}</span>
              <span className="hidden md:inline">{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="border-t border-border px-3 py-3 md:px-4">
          <Link href="/" className="flex items-center gap-2 text-[11px] text-fg-dim hover:text-fg transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14l-4-4 4-4M5 10h11a4 4 0 010 8h-1" />
            </svg>
            <span className="hidden md:inline">All projects</span>
          </Link>
        </div>
      </aside>

      <div className="ml-14 flex-1 md:ml-52">
        <div className="border-b border-border bg-bg-elevated">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 md:px-6">
            <div className="flex items-center gap-2 text-[11px] text-fg-dim">
              <span className="font-mono">{repoPath}</span>
              {githubRepo && <span className="font-mono">· gh: {githubRepo}</span>}
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-dim sm:flex">
                <Dot tone={connected ? "green" : "red"} pulse={connected} />
                {connected ? "live" : "offline"}
              </span>
              <button
                onClick={poke}
                disabled={!connected}
                title="Publish a test event to the live SSE stream"
                className="rounded border border-border-strong bg-bg px-2 py-1 text-[10px] font-medium text-fg-muted hover:text-fg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
              >
                {poked ? "Poked ✓" : "Poke"}
              </button>
              <button
                onClick={bump}
                className="rounded border border-border-strong bg-bg px-2 py-1 text-[10px] font-medium text-fg-muted hover:text-fg transition-colors cursor-pointer"
              >
                Sync
              </button>
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-7xl px-4 py-5 md:px-6">
          {tab === "overview" && (
            <div className="flex flex-col gap-5">
              <OverviewHeader projectId={projectId} refreshKey={refreshKey} />
              <OverviewTeam projectId={projectId} refreshKey={refreshKey} onOpenSession={openSession} onOpenSetup={() => setTab("agentsetup")} />
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
                <div className="xl:col-span-3">
                  <ActivityFeedMini projectId={projectId} refreshKey={refreshKey} />
                </div>
                <div className="xl:col-span-2">
                  <AgentsPanel projectId={projectId} refreshKey={refreshKey} compact onOpenFull={() => setTab("agents")} />
                </div>
              </div>
              <OverviewPanels projectId={projectId} refreshKey={refreshKey} onOpenSetup={() => setTab("agentsetup")} />
            </div>
          )}
          {tab === "agents" && (
            <AgentsPanel projectId={projectId} refreshKey={refreshKey} focusSessionId={focusSessionId} onFocusConsumed={() => setFocusSessionId(null)} />
          )}
          {tab === "tasks" && <TasksPanel projectId={projectId} refreshKey={refreshKey} />}
          {tab === "git" && <GitPanel projectId={projectId} refreshKey={refreshKey} />}
          {tab === "timeline" && <TimelinePanel projectId={projectId} refreshKey={refreshKey} />}
          {tab === "github" && <GithubPanel projectId={projectId} refreshKey={refreshKey} />}
          {tab === "context" && <ContextPanel projectId={projectId} refreshKey={refreshKey} />}
          {tab === "agentsetup" && (
            <AgentSetupPanel projectId={projectId} refreshKey={refreshKey} onOpenSession={openSession} />
          )}
        </main>
      </div>
    </div>
  );
}

function OverviewHeader({
  projectId,
  refreshKey,
}: {
  projectId: string;
  refreshKey: number;
}) {
  const [data, setData] = useState<{ git?: { info?: { dirty?: boolean; branch?: string }; commits?: unknown[]; branches?: string[] } }>({});
  const [tasks, setTasks] = useState<{ tasks?: { status: string }[] }>({});
  const [sessions, setSessions] = useState<{ sessions?: { status: string }[] }>({});

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch(`/api/projects/${projectId}/git`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/projects/${projectId}/tasks`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/projects/${projectId}/agents`).then((r) => r.json()).catch(() => ({})),
    ]).then(([g, t, s]) => {
      if (!mounted) return;
      setData(g);
      setTasks(t);
      setSessions(s);
    });
    return () => {
      mounted = false;
    };
  }, [projectId, refreshKey]);

  const dirty = data.git?.info?.dirty;
  const branch = data.git?.info?.branch;
  const taskList = tasks.tasks ?? [];
  const doneTasks = taskList.filter((t) => t.status === "done").length;
  const sessionsList = sessions.sessions ?? [];
  const running = sessionsList.filter((s) => s.status === "running").length;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Git branch" value={branch || "—"} mono />
      <StatCard
        label="Working tree"
        value={dirty ? "dirty" : "clean"}
        tone={dirty ? "amber" : "green"}
      />
      <StatCard label="Tasks done" value={`${doneTasks}/${taskList.length}`} />
      <StatCard label="Agent sessions" value={running > 0 ? `${running} running` : "idle"} tone={running > 0 ? "accent" : "dim"} />
    </div>
  );
}

function StatCard({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "green" | "amber" | "accent" | "dim" }) {
  const toneClass =
    tone === "green" ? "text-green" : tone === "amber" ? "text-amber" : tone === "accent" ? "text-accent" : "text-fg";
  return (
    <div className="rounded-xl border border-border bg-bg-elevated px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold", mono && "font-mono text-base", toneClass)}>{value}</div>
    </div>
  );
}

function ActivityFeedMini({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  return <ActivityFeed projectId={projectId} refreshKey={refreshKey} />;
}

function ActivityFeed({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [events, setEvents] = useState<Array<{ id: number; type: string; payload: Record<string, unknown>; ts: number }>>([]);
  const { connected } = useSSE(projectId, (e) => {
    setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [...prev, e].slice(-80)));
  });

  useEffect(() => {
    let mounted = true;
    fetch(`/api/projects/${projectId}/events`)
      .then((r) => r.json())
      .then((d) => {
        if (mounted) setEvents((d.events ?? []).slice(-80));
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [projectId, refreshKey]);

  const all = [...events].sort((a, b) => a.ts - b.ts).slice(-60);

  return (
    <Card className="h-[420px] overflow-hidden">
      <CardHeader
        title="Activity"
        subtitle={connected ? "live stream" : "offline"}
        right={<Dot tone={connected ? "green" : "red"} pulse={connected} />}
      />
      <div className="h-[calc(420px-49px)] overflow-y-auto p-2">
        {all.length === 0 ? (
          <Empty title="No activity yet" hint="Kick off an agent or make a change to the repo." />
        ) : (
          <div className="flex flex-col">
            {all.map((e, i) => (
              <ActivityRow key={e.id || i} e={e} last={i === all.length - 1} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function ActivityRow({ e, last }: { e: { type: string; payload: Record<string, unknown>; ts: number }; last: boolean }) {
  const meta = eventMeta(e.type, e.payload);
  return (
    <div className="flex gap-2 px-1.5 py-1 text-[11px] leading-relaxed">
      <div className="flex flex-col items-center pt-0.5">
        <span className={cn("mt-1 size-1.5 rounded-full", meta.dot)} />
        {!last && <span className="mt-0.5 w-px flex-1 bg-border" />}
      </div>
      <div className="min-w-0 pb-1">
        <span className="text-fg-muted font-semibold uppercase tracking-wide text-[9px]">{meta.label}</span>
        {meta.detail ? <span className="ml-1.5 text-fg">{meta.detail}</span> : null}
        {meta.sub && <div className="text-fg-dim text-[10px]">{meta.sub}</div>}
      </div>
    </div>
  );
}

function eventMeta(type: string, payload: Record<string, unknown>): { label: string; detail?: string; sub?: string; dot: string } {
  switch (type) {
    case "agent:started":
      return {
        label: "agent started",
        detail: String(payload.agentType ?? ""),
        sub: String(payload.title ?? ""),
        dot: "bg-accent",
      };
    case "agent:finished":
      return {
        label: "agent finished",
        detail: String(payload.status ?? ""),
        sub: String(payload.exitCode ?? ""),
        dot: payload.status === "done" ? "bg-green" : "bg-amber",
      };
    case "agent:error":
      return { label: "agent error", detail: String(payload.message ?? ""), dot: "bg-red" };
    case "agent:event": {
      const msg = payload.msg as { type?: string; text?: string; step?: string } | undefined;
      const step = msg?.step ?? "output";
      return {
        label: `${String(payload.role ?? "agent")} · ${step}`,
        detail: msg?.type === "status" ? String(msg.text ?? "") : undefined,
        sub: msg?.type === "output" ? String(msg.text ?? "").slice(0, 220) : undefined,
        dot: msg?.type === "status" ? "bg-amber" : "bg-cyan",
      };
    }
    case "git:commit":
      return { label: "commit", detail: String(payload.branch ?? ""), sub: String(payload.message ?? ""), dot: "bg-green" };
    case "git:branch-created":
      return { label: "branch created", detail: String(payload.branch ?? ""), dot: "bg-cyan" };
    case "git:branch-checkout":
      return { label: "branch checkout", detail: String(payload.branch ?? ""), dot: "bg-cyan" };
    case "task:created":
      return { label: "task created", detail: String(payload.title ?? ""), dot: "bg-accent" };
    case "task:updated":
      return { label: "task updated", detail: String(payload.status ?? ""), dot: "bg-purple" };
    case "task:deleted":
      return { label: "task deleted", dot: "bg-red" };
    case "context:set":
      return { label: "context set", detail: String(payload.key ?? ""), dot: "bg-green" };
    case "decision:created":
      return { label: "decision", detail: String(payload.title ?? ""), dot: "bg-purple" };
    case "issue:imported":
      return { label: "issue imported", detail: `#${String(payload.issueNumber ?? "")}`, dot: "bg-amber" };
    case "pr:created":
      return { label: "PR created", detail: `#${String(payload.number ?? "")}`, dot: "bg-green" };
    case "agentsetup:master":
      return { label: "master set", detail: String(payload.agentType ?? ""), sub: String(payload.name ?? ""), dot: "bg-purple" };
    case "agentsetup:change": {
      if (payload.removed) {
        return {
          label: "agent removed",
          detail: `${String(payload.role ?? "")} ${String(payload.agentType ?? "")}`,
          dot: "bg-red",
        };
      }
      return {
        label: "agent updated",
        detail: `${String(payload.role ?? "")} · ${String(payload.agentType ?? "")}`,
        sub: String(payload.name ?? ""),
        dot: "bg-purple",
      };
    }
    case "agent:heartbeat":
      return { label: "…", dot: "bg-dim" };
    default:
      return { label: type, dot: "bg-fg-dim" };
  }
}

function OverviewTeam({
  projectId,
  refreshKey,
  onOpenSession,
  onOpenSetup,
}: {
  projectId: string;
  refreshKey: number;
  onOpenSession: (sessionId: string) => void;
  onOpenSetup: () => void;
}) {
  type TeamState = {
    orchestration: {
      master: { id: string; name: string; agent_type: string; role: string } | null;
      subagents: { id: string; name: string; agent_type: string; role: string }[];
    } | null;
    adapters: Record<string, { available: boolean; label: string }>;
    sessions: Array<{ id: string; agent_type: string; role: string; active: boolean; status: string; started_at: number }>;
    tasks: Array<{ id: string; title: string; status: string; assigned_agent: string | null }>;
    branch: string | null;
  };
  const [state, setState] = useState<TeamState | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch(`/api/projects/${projectId}/agentsetup`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/projects/${projectId}/agents`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/projects/${projectId}/tasks`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/projects/${projectId}/git`).then((r) => r.json()).catch(() => ({})),
    ]).then(([set, ag, tk, g]) => {
      if (!mounted) return;
      setState({
        orchestration: (set as { orchestration?: TeamState["orchestration"] }).orchestration ?? null,
        adapters: (set as { adapters?: TeamState["adapters"] }).adapters ?? {},
        sessions: (ag as { sessions?: TeamState["sessions"] }).sessions ?? [],
        tasks: (tk as { tasks?: TeamState["tasks"] }).tasks ?? [],
        branch: (g as { info?: { branch?: string | null } }).info?.branch ?? null,
      });
    });
    return () => {
      mounted = false;
    };
  }, [projectId, refreshKey]);

  const cards = useMemo<AgentCardInfo[]>(() => {
    if (!state) return [];
    return composeTopologyCards({
      orchestration: state.orchestration ?? { master: null, subagents: [] },
      sessions: state.sessions,
      tasks: state.tasks,
      branch: state.branch,
      adapters: state.adapters,
    });
  }, [state]);

  return (
    <Card>
      <CardHeader
        title="Team topology"
        subtitle="Click an agent to open its latest session"
        right={
          <button
            onClick={onOpenSetup}
            className="rounded border border-border-strong bg-bg px-2 py-1 text-[10px] font-medium text-fg-muted transition-colors hover:text-fg cursor-pointer"
          >
            Configure team
          </button>
        }
      />
      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <div className="text-[13px] font-medium text-fg-muted">No team configured</div>
          <p className="max-w-sm text-[11px] leading-relaxed text-fg-dim">
            Configure a master agent and subagents to visualize and run orchestration.
          </p>
          <Button variant="outline" onClick={onOpenSetup}>
            Configure Master
          </Button>
        </div>
      ) : (
        <div className="p-3">
          <TeamGraph
            cards={cards}
            compact
            height={220}
            onSelect={(c) => c.sessionId && onOpenSession(c.sessionId)}
            emptyHint="Configure a master agent to enable orchestration."
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex flex-wrap items-center gap-2">
              {cards.map((c) => (
                <button
                  key={c.id}
                  onClick={() => c.sessionId && onOpenSession(c.sessionId)}
                  className="flex items-center gap-1.5 rounded-full border border-border-strong bg-bg px-2 py-0.5 text-[10px] text-fg-muted transition-colors hover:border-accent/50 hover:text-fg cursor-pointer"
                  title={`${c.name} — ${c.statusLabel}`}
                >
                  <span className={cn("size-1.5 rounded-full", c.working ? "bg-amber" : c.connected ? "bg-green" : "bg-fg-dim")} />
                  {c.name} · {c.role.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-fg-dim">
              {cards.filter((c) => c.working).length} working · {cards.filter((c) => !c.connected).length} offline
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

function OverviewPanels({
  projectId,
  refreshKey,
  onOpenSetup,
}: {
  projectId: string;
  refreshKey: number;
  onOpenSetup: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-bg-elevated">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h3 className="text-[13px] font-semibold">Master orchestrator</h3>
            <p className="text-[11px] text-fg-dim">Coordinate work with your configured master agent.</p>
          </div>
          <button
            onClick={onOpenSetup}
            className="rounded border border-border-strong bg-bg px-2 py-1 text-[10px] font-medium text-fg-muted transition-colors hover:text-fg cursor-pointer"
          >
            Agent Setup
          </button>
        </div>
        <div className="px-4 pb-4">
          <MasterLaunchForm projectId={projectId} refreshKey={refreshKey} onOpenSetup={onOpenSetup} />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-bg-elevated">
        <TaskSummary projectId={projectId} refreshKey={refreshKey} />
      </div>
    </div>
  );
}

function MasterLaunchForm({
  projectId,
  refreshKey,
  onOpenSetup,
}: {
  projectId: string;
  refreshKey: number;
  onOpenSetup: () => void;
}) {
  const [directive, setDirective] = useState("Assess the state of this repository and plan the next step.");
  const [busy, setBusy] = useState(false);
  const [masterName, setMasterName] = useState<string | null>(null);
  const [masterType, setMasterType] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/projects/${projectId}/agentsetup`)
      .then((r) => r.json())
      .then((d) => {
        if (!mounted) return;
        setMasterName(d.orchestration?.master?.name ?? null);
        setMasterType(d.orchestration?.master?.agent_type ?? null);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [projectId, refreshKey]);

  async function run() {
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType: "opencode", role: "master", prompt: directive.trim() }),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {!masterName && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber/25 bg-amber-soft px-3 py-2">
          <span className="text-[11px] text-amber">⚠ No Master Agent configured.</span>
          <button onClick={onOpenSetup} className="text-[11px] font-medium text-amber underline cursor-pointer">
            Configure Master
          </button>
        </div>
      )}
      {masterName && (
        <div className="flex items-center gap-2 rounded-md border border-border-strong bg-bg-subtle px-3 py-1.5 text-[11px] text-fg-muted">
          <span className="uppercase tracking-wide text-[9px] text-fg-dim">master</span>
          <span className="font-medium text-fg">{masterName}</span>
          <span className="font-mono normal-case text-[10px]">{masterType}</span>
        </div>
      )}
      <Input value={directive} onChange={(e) => setDirective(e.target.value)} placeholder="Directive for the master agent" />
      <Button onClick={run} disabled={busy || !directive.trim()}>
        {busy ? <Spinner /> : null}
        Run master agent
      </Button>
    </div>
  );
}

function TaskSummary({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [tasks, setTasks] = useState<{ status: string; title: string; id: string }[]>([]);
  useEffect(() => {
    let mounted = true;
    fetch(`/api/projects/${projectId}/tasks`)
      .then((r) => r.json())
      .then((d) => {
        if (mounted) setTasks(d.tasks ?? []);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [projectId, refreshKey]);

  const counts = { todo: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const t of tasks) counts[t.status as keyof typeof counts] = (counts[t.status as keyof typeof counts] ?? 0) + 1;

  return (
    <div>
      <div className="px-4 py-3">
        <h3 className="text-[13px] font-semibold">Task board</h3>
        <p className="text-[11px] text-fg-dim">{tasks.length} tasks across 4 states</p>
      </div>
      <div className="grid grid-cols-4 gap-px border-t border-border">
        {(["todo", "in_progress", "blocked", "done"] as const).map((s) => (
          <div key={s} className="bg-bg-elevated px-3 py-2.5">
            <div className="font-mono text-base font-semibold text-fg">{counts[s]}</div>
            <div className="text-[10px] uppercase tracking-wide text-fg-dim">{s.replace("_", " ")}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-2">
        {tasks.slice(0, 4).map((t) => (
          <div key={t.id} className="flex items-center gap-2 px-2 py-1 text-[11px]">
            <Dot tone={t.status === "done" ? "green" : t.status === "in_progress" ? "amber" : "dim"} />
            <span className="truncate text-fg-muted">{t.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}