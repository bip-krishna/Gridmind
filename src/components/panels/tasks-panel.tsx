"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Confirmation, Empty, Field, Input, Select, Textarea, type BadgeTone } from "@/components/ui";
import { timeAgo, cn } from "@/lib/utils";
import { MiniChain } from "@/components/topology";
import { memberToCard, type AgentCardInfo } from "@/lib/topology";
import type { AgentRole } from "@/lib/db";

type Task = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigned_agent: string | null;
  session_id: string | null;
  issue_number: number | null;
  branch: string | null;
  worktree_path?: string | null;
  worktree_branch?: string | null;
  worktree_status?: string | null;
  latest_commit?: string | null;
  pr_number?: number | null;
  pr_url?: string | null;
  updated_at: number;
  created_at: number;
};

type HandoffItem = {
  id: string;
  source_task_id: string;
  target_task_id: string;
  summary: string;
  status: string;
  commit_sha?: string | null;
  branch?: string | null;
  created_at: number;
};

const STATUSES = ["todo", "queued", "in_progress", "blocked", "done", "failed"] as const;

type TeamMember = { id: string; name: string; agent_type: string; role: AgentRole };

export function TasksPanel({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignedAgent, setAssignedAgent] = useState("opencode");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [showWorkflowGraph, setShowWorkflowGraph] = useState(true);

  const [master, setMaster] = useState<AgentCardInfo | null>(null);
  const [subs, setSubs] = useState<AgentCardInfo[]>([]);

  async function load() {
    const [tasksRes, handoffsRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/tasks`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/projects/${projectId}/handoffs`).then((r) => r.json()).catch(() => ({})),
    ]);
    setTasks(tasksRes.tasks ?? []);
    setHandoffs(handoffsRes.handoffs ?? []);
  }

  async function loadTeam() {
    const setup = await fetch(`/api/projects/${projectId}/agentsetup`).then((r) => r.json()).catch(() => ({}));
    const orch = (setup as { orchestration?: { master: TeamMember | null; subagents: TeamMember[] } }).orchestration ?? null;
    const adapters = (setup as { adapters?: Record<string, { available: boolean; label: string }> }).adapters ?? {};
    if (orch) {
      setMaster(orch.master ? memberToCard(orch.master, adapters) : null);
      setSubs(orch.subagents.map((s) => memberToCard(s, adapters)));
    }
  }

  useEffect(() => {
    load();
    loadTeam();
  }, [projectId, refreshKey]);

  const autoTasks = tasks.filter((t) => t.assigned_agent === "auto" || t.assigned_agent === "master");

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description, priority, assigned_agent: assignedAgent }),
      });
      setTitle("");
      setDescription("");
      setShowForm(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patch(taskId: string, patchBody: Record<string, unknown>) {
    await fetch(`/api/projects/${projectId}/tasks`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, ...patchBody }),
    });
    await load();
  }

  async function remove(taskId: string) {
    await fetch(`/api/projects/${projectId}/tasks?taskId=${taskId}`, { method: "DELETE" });
    setConfirmDelete(null);
    await load();
  }

  const filtered = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
  const counts = (s: string) => tasks.filter((t) => t.status === s).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Stage 5C Phase 8: Project-Level Agent Workflow Visualization */}
      {tasks.length > 0 && (
        <Card>
          <CardHeader
            title="Agent Coordination & Git Workflow Chain"
            subtitle="Live trace: Agent → Worktree → Commit → Handoff → Next Task → PR"
            right={
              <button
                onClick={() => setShowWorkflowGraph((v) => !v)}
                className="rounded border border-border px-2 py-1 text-[11px] font-medium text-fg-muted hover:text-fg transition-colors"
              >
                {showWorkflowGraph ? "Hide Flow" : "Show Flow"}
              </button>
            }
          />
          {showWorkflowGraph && (
            <div className="p-4 border-t border-border bg-bg-subtle/30 overflow-x-auto">
              <WorkflowChainVisualization tasks={tasks} handoffs={handoffs} />
            </div>
          )}
        </Card>
      )}

      {autoTasks.length > 0 && (
        <Card>
          <CardHeader
            title="Dispatch via Master"
            subtitle="Auto-assigned tasks route through the configured master, which picks the subagent."
            right={<Badge tone="purple">{autoTasks.length}</Badge>}
          />
          <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
            {autoTasks.map((t) => (
              <div key={t.id} className="rounded-lg border border-border bg-bg-subtle p-3">
                <MiniChain taskTitle={t.title} master={master} subs={subs} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Tasks"
          subtitle={`${tasks.length} total`}
          right={
            <Button onClick={() => setShowForm((v) => !v)} variant="outline">
              {showForm ? "Close" : "New task"}
            </Button>
          }
        />
        <div className="flex items-center gap-1 border-b border-border px-3 py-2">
          {(["all", ...STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                filter === s ? "bg-bg-subtle text-fg border border-border-strong" : "text-fg-muted hover:text-fg"
              )}
            >
              {s.replace("_", " ")}
              {s !== "all" && <span className="ml-1 text-fg-dim">{counts(s)}</span>}
            </button>
          ))}
        </div>

        {showForm && (
          <div className="border-b border-border p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="md:col-span-3">
                <Field label="Title">
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Implement X" autoFocus />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Description">
                  <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Acceptance criteria, notes…" />
                </Field>
              </div>
              <div className="flex flex-col gap-4">
                <Field label="Priority">
                  <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="urgent">urgent</option>
                  </Select>
                </Field>
                <Field label="Assign to">
                  <Select value={assignedAgent} onChange={(e) => setAssignedAgent(e.target.value)}>
                    <option value="auto">Auto / Master</option>
                    <option value="opencode">OpenCode</option>
                    <option value="codex">Codex</option>
                  </Select>
                </Field>
              </div>
            </div>
            <div className="mt-3">
              <Button onClick={create} disabled={busy || !title.trim()}>
                {busy ? "Creating…" : "Create task"}
              </Button>
            </div>
          </div>
        )}

        <div className="p-2">
          {filtered.length === 0 ? (
            <Empty title="No tasks here" hint="Create a task or import a GitHub issue from the GitHub tab." />
          ) : (
            <div className="flex flex-col divide-y divide-border/30">
              {filtered.map((t) => {
                const outgoingHandoff = handoffs.find((h) => h.source_task_id === t.id);
                const incomingHandoff = handoffs.find((h) => h.target_task_id === t.id);
                const isExpanded = expandedTaskId === t.id;

                return (
                  <TaskRow
                    key={t.id}
                    task={t}
                    outgoingHandoff={outgoingHandoff}
                    incomingHandoff={incomingHandoff}
                    isExpanded={isExpanded}
                    onToggleExpand={() => setExpandedTaskId(isExpanded ? null : t.id)}
                    onStatus={(status) => patch(t.id, { status })}
                    onAssign={(agent) => patch(t.id, { assigned_agent: agent })}
                    onDelete={() => setConfirmDelete(t.id)}
                    showConfirm={confirmDelete === t.id}
                    onConfirmDelete={() => remove(t.id)}
                    onCancelDelete={() => setConfirmDelete(null)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function WorkflowChainVisualization({
  tasks,
  handoffs,
}: {
  tasks: Task[];
  handoffs: HandoffItem[];
}) {
  return (
    <div className="flex items-center gap-3 overflow-x-auto py-2">
      {tasks.map((t, idx) => {
        const outHandoff = handoffs.find((h) => h.source_task_id === t.id);
        const agentName = t.assigned_agent || "unassigned";

        return (
          <div key={t.id} className="flex items-center gap-3 shrink-0">
            {/* Task Node */}
            <div className="w-56 rounded-xl border border-border bg-bg-elevated p-3 shadow-sm hover:border-accent/40 transition-colors">
              <div className="flex items-center justify-between gap-1 text-[10px] text-fg-dim">
                <span className="font-semibold text-fg uppercase">{agentName}</span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded font-mono",
                  t.status === "done" ? "bg-green/10 text-green" : "bg-bg-subtle text-fg-muted"
                )}>
                  {t.status}
                </span>
              </div>
              <div className="mt-1 font-medium text-xs text-fg truncate" title={t.title}>
                {t.title}
              </div>

              {/* Worktree & Branch */}
              <div className="mt-2 space-y-1 text-[10px] font-mono text-fg-dim border-t border-border/50 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-fg-muted">Worktree:</span>
                  <span className={cn(
                    t.worktree_status === "ready" ? "text-green" : "text-fg-dim"
                  )}>
                    {t.worktree_status || "none"}
                  </span>
                </div>
                {t.worktree_branch && (
                  <div className="flex items-center justify-between">
                    <span className="text-fg-muted">Branch:</span>
                    <span className="text-cyan truncate max-w-[120px]" title={t.worktree_branch}>
                      @{t.worktree_branch}
                    </span>
                  </div>
                )}
                {t.latest_commit && (
                  <div className="flex items-center justify-between">
                    <span className="text-fg-muted">Commit:</span>
                    <span className="text-amber font-mono font-semibold">
                      {t.latest_commit.slice(0, 7)}
                    </span>
                  </div>
                )}
                {t.pr_number && (
                  <div className="flex items-center justify-between text-green">
                    <span>PR:</span>
                    {t.pr_url ? (
                      <a href={t.pr_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-green-light">
                        #{t.pr_number} ↗
                      </a>
                    ) : (
                      <span>#{t.pr_number}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Handoff Edge */}
            {outHandoff && (
              <div className="flex flex-col items-center justify-center px-1 text-center">
                <div className="flex items-center gap-1">
                  <div className="h-0.5 w-6 bg-accent/60" />
                  <div className={cn(
                    "rounded-full px-2 py-0.5 text-[9px] font-mono font-semibold uppercase border",
                    outHandoff.status === "accepted"
                      ? "border-green/40 bg-green/10 text-green"
                      : "border-amber/40 bg-amber/10 text-amber"
                  )}>
                    Handoff: {outHandoff.status}
                  </div>
                  <div className="h-0.5 w-6 bg-accent/60" />
                  <span className="text-accent text-xs">▶</span>
                </div>
                {outHandoff.commit_sha && (
                  <span className="mt-1 text-[9px] font-mono text-fg-dim">
                    ref: {outHandoff.commit_sha.slice(0, 7)}
                  </span>
                )}
              </div>
            )}

            {!outHandoff && idx < tasks.length - 1 && (
              <div className="h-0.5 w-6 bg-border" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TaskRow({
  task,
  outgoingHandoff,
  incomingHandoff,
  isExpanded,
  onToggleExpand,
  onStatus,
  onAssign,
  onDelete,
  showConfirm,
  onConfirmDelete,
  onCancelDelete,
}: {
  task: Task;
  outgoingHandoff?: HandoffItem;
  incomingHandoff?: HandoffItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onStatus: (s: string) => void;
  onAssign: (a: string) => void;
  onDelete: () => void;
  showConfirm: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const statusTone = (s: string): BadgeTone => {
    switch (s) {
      case "in_progress": return "amber";
      case "blocked": return "amber";
      case "done": return "green";
      case "failed": return "red";
      case "queued": return "cyan";
      default: return "dim";
    }
  };

  return (
    <div className="group flex flex-col py-2 px-2.5 hover:bg-bg-subtle/40 rounded-lg transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-1 pt-0.5">
          <Select value={task.status} onChange={(e) => onStatus(e.target.value)} className="h-6 w-30 text-[10px] px-1.5">
            <option value="todo">todo</option>
            <option value="queued">queued</option>
            <option value="in_progress">in_progress</option>
            <option value="blocked">blocked</option>
            <option value="done">done</option>
            <option value="failed">failed</option>
          </Select>
        </div>

        <div className="min-w-0 flex-1 cursor-pointer" onClick={onToggleExpand}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[13px] font-medium text-fg", task.status === "done" && "line-through text-fg-dim")}>
              {task.title}
            </span>
            {task.issue_number && <Badge tone="amber">GH-{task.issue_number}</Badge>}
            <Badge tone={task.priority === "urgent" ? "red" : task.priority === "high" ? "amber" : "dim"}>
              {task.priority}
            </Badge>
            <Badge tone={statusTone(task.status)}>
              {task.status.replace("_", " ")}
            </Badge>

            {/* Stage 5C Workflow Badges */}
            {task.worktree_status && task.worktree_status !== "none" && (
              <Badge tone={task.worktree_status === "ready" ? "green" : "dim"}>
                wt: {task.worktree_status}
              </Badge>
            )}
            {task.latest_commit && (
              <Badge tone="purple">
                git: {task.latest_commit.slice(0, 7)}
              </Badge>
            )}
            {task.pr_number && (
              <Badge tone="green">
                PR #{task.pr_number}
              </Badge>
            )}
            {outgoingHandoff && (
              <Badge tone={outgoingHandoff.status === "accepted" ? "green" : "amber"}>
                Handoff → {outgoingHandoff.status}
              </Badge>
            )}
            {incomingHandoff && (
              <Badge tone={incomingHandoff.status === "accepted" ? "cyan" : "amber"}>
                Incoming Handoff ({incomingHandoff.status})
              </Badge>
            )}
          </div>

          {task.description && <div className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-fg-dim line-clamp-1">{task.description}</div>}

          <div className="mt-1.5 flex items-center gap-3 text-[10px] text-fg-dim flex-wrap">
            <Select
              value={task.assigned_agent === "master" ? "auto" : (task.assigned_agent ?? "")}
              onChange={(e) => onAssign(e.target.value)}
              className="h-5 w-24 text-[10px] px-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <option value="" disabled>unassigned</option>
              <option value="auto">Auto / Master</option>
              <option value="opencode">OpenCode</option>
              <option value="codex">Codex</option>
            </Select>

            {task.session_id && (
              <span className="font-mono text-cyan">
                session {task.session_id.slice(0, 8)}
              </span>
            )}
            {task.worktree_branch && <span className="font-mono text-fg-muted">@{task.worktree_branch}</span>}
            <span>updated {timeAgo(task.updated_at)}</span>
            <span className="text-accent underline text-[10px]">{isExpanded ? "Collapse ▲" : "Workflow Chain ▼"}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {showConfirm ? (
            <Confirmation onConfirm={onConfirmDelete} onCancel={onCancelDelete} />
          ) : (
            <button onClick={onDelete} className="rounded p-1 text-fg-dim hover:text-red transition-colors cursor-pointer" title="Delete task">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Stage 5C Phase 7: Task Detail Chain */}
      {isExpanded && (
        <div className="mt-3 rounded-lg border border-border bg-bg-elevated p-3 text-xs">
          <div className="font-semibold text-fg-muted uppercase tracking-wider text-[10px] mb-2">
            Execution & Coordination Chain
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono text-[11px]">
            <div className="rounded border border-border p-2 bg-bg-subtle">
              <div className="text-[9px] text-fg-dim uppercase">1. Task</div>
              <div className="font-semibold text-fg truncate">{task.title}</div>
              <div className="text-[10px] text-fg-dim">status: {task.status}</div>
            </div>

            <div className="rounded border border-border p-2 bg-bg-subtle">
              <div className="text-[9px] text-fg-dim uppercase">2. Agent Session</div>
              <div className="text-cyan">{task.assigned_agent || "unassigned"}</div>
              <div className="text-[10px] text-fg-dim truncate">
                {task.session_id ? `id: ${task.session_id.slice(0, 8)}` : "no active session"}
              </div>
            </div>

            <div className="rounded border border-border p-2 bg-bg-subtle">
              <div className="text-[9px] text-fg-dim uppercase">3. Worktree & Git</div>
              <div className="text-fg-muted truncate">{task.worktree_branch || "no branch"}</div>
              <div className="text-[10px] text-fg-dim truncate">
                {task.latest_commit ? `commit: ${task.latest_commit.slice(0, 7)}` : "no commit yet"}
              </div>
            </div>

            <div className="rounded border border-border p-2 bg-bg-subtle">
              <div className="text-[9px] text-fg-dim uppercase">4. Handoff & PR</div>
              <div className="truncate">
                {outgoingHandoff ? (
                  <span className="text-amber">→ {outgoingHandoff.target_task_id} ({outgoingHandoff.status})</span>
                ) : (
                  <span className="text-fg-dim">no handoff</span>
                )}
              </div>
              <div className="text-[10px]">
                {task.pr_number ? (
                  <a href={task.pr_url ?? "#"} target="_blank" rel="noopener noreferrer" className="text-green underline">
                    PR #{task.pr_number} ↗
                  </a>
                ) : (
                  <span className="text-fg-dim">no PR created</span>
                )}
              </div>
            </div>
          </div>

          {task.worktree_path && (
            <div className="mt-2 text-[10px] text-fg-dim font-mono">
              <span className="text-fg-muted">Worktree Path:</span> {task.worktree_path}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
