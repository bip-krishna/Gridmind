"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Confirmation, Empty, Field, Input, Select, Textarea, type BadgeTone } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
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
  updated_at: number;
  created_at: number;
};

const STATUSES = ["todo", "queued", "in_progress", "blocked", "done", "failed"] as const;

type TeamMember = { id: string; name: string; agent_type: string; role: AgentRole };

export function TasksPanel({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignedAgent, setAssignedAgent] = useState("opencode");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [master, setMaster] = useState<AgentCardInfo | null>(null);
  const [subs, setSubs] = useState<AgentCardInfo[]>([]);

  async function load() {
    const res = await fetch(`/api/projects/${projectId}/tasks`);
    const data = await res.json();
    setTasks(data.tasks ?? []);
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
            <div className="flex flex-col">
              {filtered.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onStatus={(status) => patch(t.id, { status })}
                  onAssign={(agent) => patch(t.id, { assigned_agent: agent })}
                  onDelete={() => setConfirmDelete(t.id)}
                  showConfirm={confirmDelete === t.id}
                  onConfirmDelete={() => remove(t.id)}
                  onCancelDelete={() => setConfirmDelete(null)}
                />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function TaskRow({
  task,
  onStatus,
  onAssign,
  onDelete,
  showConfirm,
  onConfirmDelete,
  onCancelDelete,
}: {
  task: Task;
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
    <div className="group flex items-start gap-3 rounded-lg border border-transparent px-2.5 py-2 hover:border-border hover:bg-bg-subtle/40 transition-colors duration-100">
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
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
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
        </div>
        {task.description && <div className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-fg-dim">{task.description}</div>}
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-fg-dim">
          <Select
            value={task.assigned_agent === "master" ? "auto" : (task.assigned_agent ?? "")}
            onChange={(e) => onAssign(e.target.value)}
            className="h-5 w-24 text-[10px] px-1.5"
          >
            <option value="" disabled>
              unassigned
            </option>
            <option value="auto">Auto / Master</option>
            <option value="opencode">OpenCode</option>
            <option value="codex">Codex</option>
          </Select>
          {task.session_id && (
            <span className="font-mono text-cyan">
              session {task.session_id.slice(0, 8)}
            </span>
          )}
          {task.branch && <span className="font-mono">@{task.branch}</span>}
          <span>updated {timeAgo(task.updated_at)}</span>
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
  );
}
