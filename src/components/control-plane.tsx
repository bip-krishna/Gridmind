"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn, extractRepoName } from "@/lib/utils";
import { useProjectPoll, useSSE } from "@/lib/hooks";
import { Button, Card, CardHeader, Dot, Empty, Input, Spinner, StatusIndicator } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-provider";
import { animateTabSwitch, animateListItems } from "@/lib/animations";
import { AgentsPanel } from "@/components/panels/agents-panel";
import { TasksPanel } from "@/components/panels/tasks-panel";
import { GitPanel } from "@/components/panels/git-panel";
import { TimelinePanel } from "@/components/panels/timeline-panel";
import { GithubPanel } from "@/components/panels/github-panel";
import { ContextPanel } from "@/components/panels/context-panel";
import { AgentSetupPanel } from "@/components/panels/agentsetup-panel";
import { HandoffsPanel } from "@/components/panels/handoffs-panel";
import dynamic from "next/dynamic";
import { composeTopologyCards, type AgentCardInfo } from "@/lib/topology";

const TeamGraph = dynamic(
  () => import("@/components/topology").then((m) => m.TeamGraph),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[220px] w-full items-center justify-center rounded-lg border border-border bg-bg-elevated text-[11px] text-fg-dim animate-pulse">
        Initializing canvas…
      </div>
    ),
  }
);

type NavTab = "overview" | "agents" | "tasks" | "handoffs" | "git" | "timeline" | "github" | "context" | "agentsetup";

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ReactNode }[] = [
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
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
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
    id: "handoffs",
    label: "Handoffs",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 11l4 4-4 4" />
        <path d="M7 13l-4-4 4-4" />
        <path d="M21 15H9a4 4 0 01-4-4V7" />
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
  const [tab, setTab] = useState<NavTab>("overview");
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const { refreshKey, bump, connected } = useProjectPoll(projectId);
  const [poked, setPoked] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      animateTabSwitch(contentRef.current);
    }
  }, [tab]);

  // Close mobile nav on tab change
  useEffect(() => {
    setMobileNav(false);
  }, [tab]);

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
    <div className="flex min-h-screen bg-bg text-fg">
      {/* Mobile nav overlay */}
      {mobileNav && (
        <div
          className="sidebar-overlay lg:hidden"
          onClick={() => setMobileNav(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-border bg-bg-elevated transition-transform duration-150",
          mobileNav ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-bg-subtle text-fg">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold text-fg tracking-tight">{projectName}</div>
            <div className="truncate text-[10px] font-mono text-fg-dim">{extractRepoName(repoPath)}</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-2.5 py-2" aria-label="Main navigation">
          {NAV_ITEMS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors duration-100 cursor-pointer",
                tab === t.id
                  ? "bg-bg-subtle text-fg font-medium border border-border-strong"
                  : "text-fg-muted hover:text-fg hover:bg-bg-subtle/50 border border-transparent"
              )}
              aria-current={tab === t.id ? "page" : undefined}
            >
              <span className="shrink-0 text-fg-dim">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex items-center justify-between border-t border-border px-3.5 py-2.5">
          <Link href="/" className="flex items-center gap-1.5 text-[11px] text-fg-dim hover:text-fg transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>Projects</span>
          </Link>
          <ThemeToggle />
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 lg:ml-56">
        {/* Header */}
        <header className="sticky top-0 z-20 border-b border-border bg-bg/95 backdrop-blur-none">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 md:px-6">
            <div className="flex items-center gap-2.5">
              {/* Mobile hamburger */}
              <button
                onClick={() => setMobileNav(true)}
                className="flex lg:hidden size-7 items-center justify-center rounded-md border border-border text-fg-muted hover:text-fg transition-colors cursor-pointer"
                aria-label="Open navigation"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 12h18M3 6h18M3 18h18" />
                </svg>
              </button>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-semibold text-fg">{projectName}</span>
                <span className="text-fg-dim">/</span>
                <span className="capitalize text-fg-muted">{tab.replace("agentsetup", "agent setup")}</span>
                {githubRepo && <span className="font-mono text-fg-dim hidden md:inline">· {githubRepo}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusIndicator
                status={connected ? "online" : "offline"}
                label={connected ? "LIVE" : "OFFLINE"}
                pulse={connected}
              />
              <Button
                variant="outline"
                size="xs"
                onClick={poke}
                disabled={!connected}
                title="Publish a test event to the live SSE stream"
              >
                {poked ? "Poked" : "Poke"}
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={bump}
                title="Sync project state"
              >
                Sync
              </Button>
            </div>
          </div>
        </header>

        <main ref={contentRef} className="mx-auto max-w-7xl px-4 py-5 md:px-6">
          {tab === "overview" && (
            <div className="flex flex-col gap-4">
              <OverviewHeader projectId={projectId} refreshKey={refreshKey} />
              <OverviewTeam projectId={projectId} refreshKey={refreshKey} onOpenSession={openSession} onOpenSetup={() => setTab("agentsetup")} />
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
                <div className="xl:col-span-3">
                  <ActivityFeed projectId={projectId} refreshKey={refreshKey} />
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
          {tab === "handoffs" && <HandoffsPanel projectId={projectId} refreshKey={refreshKey} />}
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

/* ────────── Overview: Header Stats ────────── */

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
  const inProgress = taskList.filter((t) => t.status === "in_progress").length;
  const blocked = taskList.filter((t) => t.status === "blocked").length;
  const sessionsList = sessions.sessions ?? [];
  const running = sessionsList.filter((s) => s.status === "running").length;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
      <StatCard label="Branch" value={branch || "—"} mono />
      <StatCard
        label="Working Tree"
        value={dirty ? "dirty" : "clean"}
        tone={dirty ? "amber" : "green"}
      />
      <StatCard label="Tasks" value={`${doneTasks}/${taskList.length} done`} mono />
      <StatCard
        label="Active"
        value={inProgress > 0 ? `${inProgress} in progress` : blocked > 0 ? `${blocked} blocked` : "idle"}
        tone={inProgress > 0 ? "amber" : "dim"}
      />
      <StatCard
        label="Agents"
        value={running > 0 ? `${running} running` : "idle"}
        tone={running > 0 ? "accent" : "dim"}
        className="hidden lg:block"
      />
    </div>
  );
}

function StatCard({ label, value, mono, tone, className }: { label: string; value: string; mono?: boolean; tone?: "green" | "amber" | "accent" | "dim"; className?: string }) {
  const toneClass =
    tone === "green" ? "text-green" : tone === "amber" ? "text-amber" : tone === "accent" ? "text-fg" : "text-fg";
  return (
    <div className={cn("rounded-lg border border-border bg-bg-elevated px-3.5 py-2.5", className)}>
      <div className="text-[10px] uppercase tracking-wider text-fg-dim font-medium">{label}</div>
      <div className={cn("mt-1 text-base font-semibold", mono && "font-mono tabular-nums", toneClass)}>{value}</div>
    </div>
  );
}

/* ────────── Overview: Activity Feed ────────── */

function ActivityFeed({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [events, setEvents] = useState<Array<{ id: number; type: string; payload: Record<string, unknown>; ts: number }>>([]);
  const [filterType, setFilterType] = useState<string>("all");
  const feedRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (feedRef.current) {
      animateListItems(feedRef.current, "> div:last-child");
    }
  }, [events.length]);

  const all = [...events].sort((a, b) => a.ts - b.ts).slice(-60);
  const filtered = filterType === "all" ? all : all.filter((e) => e.type.startsWith(filterType));

  const filterOptions = [
    { id: "all", label: "All" },
    { id: "agent", label: "Agent" },
    { id: "task", label: "Task" },
    { id: "git", label: "Git" },
    { id: "handoff", label: "Handoff" },
    { id: "context", label: "Context" },
  ];

  return (
    <Card className="h-[380px] overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3.5 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-medium text-fg tracking-tight">Activity</h3>
          <StatusIndicator status={connected ? "online" : "offline"} pulse={connected} />
        </div>
        <div className="flex items-center gap-0.5">
          {filterOptions.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer",
                filterType === f.id ? "bg-bg-subtle text-fg" : "text-fg-dim hover:text-fg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={feedRef} className="h-[calc(380px-40px)] overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <Empty title="No activity recorded" hint="Kick off an agent or commit changes to see live workflow events." />
        ) : (
          <div className="flex flex-col">
            {filtered.map((e, i) => (
              <ActivityRow key={e.id || i} e={e} last={i === filtered.length - 1} />
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
    <div className="flex gap-2.5 px-2 py-1 text-[11px] leading-relaxed">
      <div className="flex flex-col items-center pt-1">
        <span className={cn("size-1.5 rounded-full shrink-0", meta.dot)} />
        {!last && <span className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className="min-w-0 pb-1 flex-1">
        <span className="font-mono text-fg-dim uppercase tracking-wider text-[9px]">{meta.label}</span>
        {meta.detail ? <span className="ml-2 text-fg font-medium">{meta.detail}</span> : null}
        {meta.sub && <div className="text-fg-dim font-mono text-[10px] mt-0.5">{meta.sub}</div>}
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
        dot: "bg-fg",
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
        dot: msg?.type === "status" ? "bg-amber" : "bg-fg-dim",
      };
    }
    case "git:commit":
      return {
        label: "commit",
        detail: String(payload.branch ?? ""),
        sub: payload.commit_sha ? `sha: ${String(payload.commit_sha).slice(0, 7)}` : String(payload.message ?? ""),
        dot: "bg-green",
      };
    case "git:branch-created":
      return { label: "branch created", detail: String(payload.branch ?? ""), dot: "bg-fg-dim" };
    case "git:branch-checkout":
      return { label: "branch checkout", detail: String(payload.branch ?? ""), dot: "bg-fg-dim" };
    case "task:created":
      return { label: "task created", detail: String(payload.title ?? ""), dot: "bg-fg" };
    case "task:updated":
      return { label: "task updated", detail: String(payload.status ?? ""), dot: "bg-fg-dim" };
    case "task:deleted":
      return { label: "task deleted", dot: "bg-red" };
    case "handoff:created":
      return {
        label: "handoff created",
        detail: `${String(payload.source_task_id ?? "")} → ${String(payload.target_task_id ?? "")}`,
        dot: "bg-amber",
      };
    case "handoff:accepted":
      return {
        label: "handoff accepted",
        detail: `${String(payload.source_task_id ?? "")} → ${String(payload.target_task_id ?? "")}`,
        dot: "bg-green",
      };
    case "context:set":
      return { label: "context set", detail: String(payload.key ?? ""), dot: "bg-fg-dim" };
    case "decision:created":
      return { label: "decision", detail: String(payload.title ?? ""), dot: "bg-fg" };
    case "issue:imported":
      return { label: "issue imported", detail: `#${String(payload.issueNumber ?? "")}`, dot: "bg-amber" };
    case "github:pr_created":
    case "pr:created":
      return {
        label: "PR created",
        detail: `#${String(payload.pr_number ?? payload.number ?? "")}`,
        sub: String(payload.head_branch ?? ""),
        dot: "bg-green",
      };
    case "agentsetup:master":
      return { label: "master set", detail: String(payload.agentType ?? ""), sub: String(payload.name ?? ""), dot: "bg-fg" };
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
        dot: "bg-fg-dim",
      };
    }
    case "agent:heartbeat":
      return { label: "…", dot: "bg-fg-dim" };
    default:
      return { label: type, dot: "bg-fg-dim" };
  }
}

/* ────────── Overview: Team Topology ────────── */

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
        title="Agent Team Topology"
        subtitle="Active multi-agent orchestration architecture"
        right={
          <Button variant="outline" size="xs" onClick={onOpenSetup}>
            Configure team
          </Button>
        }
      />
      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <div className="text-[13px] font-medium text-fg">No team configured</div>
          <p className="max-w-sm text-[11px] leading-relaxed text-fg-dim">
            Configure a master agent and subagents to enable automatic dispatch and coordination.
          </p>
          <Button variant="outline" size="sm" onClick={onOpenSetup} className="mt-2">
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
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-1 border-t border-border pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {cards.map((c) => (
                <button
                  key={c.id}
                  onClick={() => c.sessionId && onOpenSession(c.sessionId)}
                  className="flex items-center gap-1.5 rounded border border-border bg-bg-subtle px-2 py-0.5 text-[10px] font-mono text-fg-muted hover:text-fg hover:border-border-strong transition-colors cursor-pointer"
                  title={`${c.name} — ${c.statusLabel}`}
                >
                  <span className={cn("size-1.5 rounded-full shrink-0", c.working ? "bg-amber" : c.connected ? "bg-green" : "bg-fg-dim")} />
                  <span>{c.name}</span>
                  <span className="text-fg-dim font-normal uppercase">({c.role})</span>
                </button>
              ))}
            </div>
            <span className="text-[10px] font-mono text-fg-dim">
              {cards.filter((c) => c.working).length} working · {cards.filter((c) => !c.connected).length} offline
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ────────── Overview: Bottom Panels ────────── */

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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Master Orchestrator"
          subtitle="Dispatch directives to your configured master agent"
          right={
            <Button variant="outline" size="xs" onClick={onOpenSetup}>
              Agent Setup
            </Button>
          }
        />
        <div className="p-3.5">
          <MasterLaunchForm projectId={projectId} refreshKey={refreshKey} onOpenSetup={onOpenSetup} />
        </div>
      </Card>
      <Card>
        <TaskSummary projectId={projectId} refreshKey={refreshKey} />
      </Card>
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
    <div className="flex flex-col gap-2.5">
      {!masterName && (
        <div className="flex items-center justify-between gap-2 rounded border border-amber/25 bg-amber-soft px-3 py-2 text-[11px] text-amber">
          <span>No Master Agent configured.</span>
          <button onClick={onOpenSetup} className="font-semibold underline cursor-pointer">
            Configure
          </button>
        </div>
      )}
      {masterName && (
        <div className="flex items-center gap-2 rounded border border-border bg-bg-subtle px-3 py-1.5 text-[11px] font-mono text-fg-muted">
          <span className="text-[10px] text-fg-dim uppercase">master</span>
          <span className="font-semibold text-fg">{masterName}</span>
          <span className="text-fg-dim">({masterType})</span>
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
      <CardHeader
        title="Task Distribution"
        subtitle={`${tasks.length} tasks recorded`}
      />
      <div className="grid grid-cols-4 gap-px bg-border">
        {(["todo", "in_progress", "blocked", "done"] as const).map((s) => (
          <div key={s} className="bg-bg-elevated px-3 py-2">
            <div className="font-mono text-base font-semibold text-fg tabular-nums">{counts[s]}</div>
            <div className="text-[10px] uppercase font-mono tracking-wider text-fg-dim">{s.replace("_", " ")}</div>
          </div>
        ))}
      </div>
      <div className="p-2 divide-y divide-border/40">
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
