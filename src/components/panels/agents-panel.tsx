"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Dot, Empty, Field, Input, Select, Textarea, Spinner, CopyButton, SplitView, TerminalViewer, SectionLabel } from "@/components/ui";
import { agentTone, fmtTime, sessionStatusTone, timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Session = {
  id: string;
  agent_type: string;
  role: string;
  title: string;
  prompt: string;
  status: string;
  current_step: string;
  output: string;
  exit_code: number | null;
  active: boolean;
  started_at: number;
  ended_at: number | null;
};

type Adapters = Record<string, { available: boolean; label: string }>;

export function AgentsPanel({
  projectId,
  refreshKey,
  compact = false,
  onOpenFull,
  focusSessionId,
  onFocusConsumed,
}: {
  projectId: string;
  refreshKey: number;
  compact?: boolean;
  onOpenFull?: () => void;
  focusSessionId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [adapters, setAdapters] = useState<Adapters>({});
  const [selected, setSelected] = useState<Session | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [agentType, setAgentType] = useState("opencode");
  const [role, setRole] = useState("worker");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/projects/${projectId}/agents`);
    const data = await res.json();
    setSessions(data.sessions ?? []);
    setAdapters(data.adapters ?? {});
    if (!selected) setSelected(data.sessions?.[0] ?? null);
  }

  useEffect(() => {
    load();
  }, [projectId, refreshKey]);

  useEffect(() => {
    if (!focusSessionId || compact) return;
    const match = sessions.find((s) => s.id === focusSessionId);
    if (match) {
      setSelected(match);
      onFocusConsumed?.();
    }
  }, [focusSessionId, sessions, compact, onFocusConsumed]);

  const running = sessions.filter((s) => s.status === "running" || s.active).length;

  async function launch() {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentType,
          role,
          title: title.trim(),
          prompt: prompt.trim(),
        }),
      });
      setPrompt("");
      setTitle("");
      setShowForm(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const sessionsByStatus = useMemo(() => {
    const out: Record<string, Session[]> = { running: [], done: [], error: [], stopped: [] };
    for (const s of sessions) out[s.status]?.push(s);
    return out;
  }, [sessions]);

  if (compact) {
    return (
      <Card>
        <CardHeader
          title="Agent Sessions"
          subtitle={running ? `${running} active` : "idle"}
          right={
            <Button onClick={onOpenFull} variant="outline" size="xs">
              View all
            </Button>
          }
        />
        <div className="p-2">
          {sessions.length === 0 ? (
            <Empty title="No sessions yet" hint="Launch an agent to start working." />
          ) : (
            <div className="flex flex-col">
              {sessions.slice(0, 5).map((s) => (
                <SessionRow key={s.id} s={s} selected={false} onSelect={() => onOpenFull?.()} />
              ))}
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Launch form */}
      <Card>
        <CardHeader
          title="Agent Sessions"
          subtitle={running ? `${running} active` : "idle"}
          right={
            <Button onClick={() => setShowForm((v) => !v)} variant="outline">
              {showForm ? "Close" : "Run agent"}
            </Button>
          }
        />
        {showForm && (
          <div className="border-b border-border p-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Agent">
                <Select value={agentType} onChange={(e) => setAgentType(e.target.value)}>
                  {Object.entries(adapters).map(([k, v]) => (
                    <option key={k} value={k} disabled={!v?.available}>
                      {v?.label ?? k}
                      {v?.available ? "" : " (not installed)"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Role">
                <Select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="worker">worker</option>
                  <option value="master">master / orchestrator</option>
                </Select>
              </Field>
              <div className="col-span-2">
                <Field label="Title">
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fix login flow" />
                </Field>
              </div>
            </div>
            <div className="mt-4">
              <Field label="Prompt">
                <Textarea
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    role === "master"
                      ? "Direct the master agent — it will inspect the repo and coordinate workers."
                      : "Describe the task for the worker agent. It runs in the project repo."
                  }
                />
              </Field>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button onClick={launch} disabled={busy || adapters[agentType]?.available === false}>
                {busy ? <Spinner /> : null}
                {adapters[agentType]?.available === false ? "Agent not installed" : "Launch session"}
              </Button>
              <span className="text-[11px] text-fg-dim">
                {role === "master"
                  ? "master runs as the configured Master agent (Agent Setup)"
                  : adapters[agentType]?.available
                    ? `${adapters[agentType]?.label} CLI detected`
                    : "CLI not found on PATH"}
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* Session list + inspector */}
      {sessions.length === 0 ? (
        <Card>
          <Empty
            title="No sessions yet"
            hint="Launch an agent to start working. Output streams live into this list and the activity feed."
          />
        </Card>
      ) : (
        <SplitView
          list={
            <Card>
              <div className="p-2">
                <ColumnOfSessions
                  sessions={sessionsByStatus}
                  selected={selected}
                  onSelect={setSelected}
                  refreshKey={refreshKey}
                />
              </div>
            </Card>
          }
          detail={
            selected ? (
              <Card className="lg:sticky lg:top-16">
                <CardHeader
                  title={selected.title || "Untitled session"}
                  subtitle={`${selected.agent_type} · ${selected.role} · ${timeAgo(selected.started_at)}`}
                  right={<Badge tone={sessionStatusTone(selected.status)}>{selected.status}</Badge>}
                />
                <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-[11px] text-fg-dim">
                  <Dot tone={selected.active ? "amber" : "dim"} pulse={selected.active} />
                  <span className="font-mono uppercase">{selected.current_step}</span>
                  <span className="ml-auto">started {fmtTime(selected.started_at)}</span>
                  <CopyButton text={selected.prompt} label="copy prompt" />
                </div>
                <TerminalViewer output={selected.output} maxHeight="420px" />
              </Card>
            ) : (
              <Card>
                <Empty title="Select a session" hint="Click a session from the list to view its output." />
              </Card>
            )
          }
        />
      )}
    </div>
  );
}

function ColumnOfSessions({
  sessions,
  selected,
  onSelect,
  refreshKey,
}: {
  sessions: Record<string, Session[]>;
  selected: Session | null;
  onSelect: (s: Session) => void;
  refreshKey: number;
}) {
  const order = ["running", "done", "error", "stopped"];
  const labels: Record<string, string> = { running: "Running", done: "Completed", error: "Failed", stopped: "Stopped" };
  void refreshKey;

  return (
    <div className="flex flex-col gap-3">
      {order.map((bucket) => {
        const list = sessions[bucket] ?? [];
        if (list.length === 0) return null;
        return (
          <div key={bucket}>
            <SectionLabel className="px-2 pb-1">
              {labels[bucket]} · {list.length}
            </SectionLabel>
            <div className="flex flex-col">
              {list.map((s) => (
                <SessionRow key={s.id} s={s} selected={selected?.id === s.id} onSelect={() => onSelect(s)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SessionRow({ s, selected, onSelect }: { s: Session; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-100 cursor-pointer w-full",
        selected ? "bg-bg-subtle border border-border-strong" : "border border-transparent hover:bg-bg-subtle/60"
      )}
    >
      <Dot tone={agentTone(s.agent_type)} pulse={s.active} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-medium text-fg">{s.title || "Untitled"}</span>
          <Badge tone={s.role === "master" ? "accent" : "dim"} className="normal-case capitalize">
            {s.role}
          </Badge>
        </div>
        <div className="truncate text-[10px] text-fg-dim">
          {s.agent_type} — {s.status}
          {s.exit_code !== null && s.status === "error" ? ` (exit ${s.exit_code})` : ""}
        </div>
      </div>
      <span className="shrink-0 text-[10px] text-fg-dim">{timeAgo(s.started_at)}</span>
    </button>
  );
}
