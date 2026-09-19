"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Dot, Field, Input, Select, Spinner } from "@/components/ui";
import { TeamGraph, MiniChain } from "@/components/topology";
import { composeTopologyCards, AGENT_ROLE_LABEL, type AgentCardInfo } from "@/lib/topology";
import { cn, agentTone } from "@/lib/utils";
import type { AgentRole } from "@/lib/db";

type SetupAgent = {
  id: string;
  name: string;
  agent_type: string;
  role: AgentRole;
};

type Adapters = Record<string, { available: boolean; label: string }>;

export function AgentSetupPanel({
  projectId,
  refreshKey,
  onOpenSession,
}: {
  projectId: string;
  refreshKey: number;
  onOpenSession?: (sessionId: string) => void;
}) {
  const [orchestration, setOrchestration] = useState<{ master: SetupAgent | null; subagents: SetupAgent[] } | null>(null);
  const [adapters, setAdapters] = useState<Adapters>({});
  const [sessions, setSessions] = useState<Array<{ id: string; agent_type: string; role: string; active: boolean; status: string; started_at: number }>>([]);
  const [tasks, setTasks] = useState<Array<{ id: string; title: string; status: string; assigned_agent: string | null }>>([]);
  const [branch, setBranch] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // master form
  const [masterType, setMasterType] = useState<string>("opencode");
  const [masterName, setMasterName] = useState<string>("");

  // add-subagent form
  const [subType, setSubType] = useState<string>("opencode");
  const [subRole, setSubRole] = useState<string>("worker");
  const [subName, setSubName] = useState<string>("");
  const [showAddForm, setShowAddForm] = useState(false);

  async function loadSetup() {
    const res = await fetch(`/api/projects/${projectId}/agentsetup`);
    const data = await res.json();
    setOrchestration(data.orchestration ?? { master: null, subagents: [] });
    setAdapters(data.adapters ?? {});
  }

  async function loadContext() {
    const [a, t, g] = await Promise.all([
      fetch(`/api/projects/${projectId}/agents`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/projects/${projectId}/tasks`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/projects/${projectId}/git`).then((r) => r.json()).catch(() => ({})),
    ]);
    setSessions((a as { sessions?: typeof sessions }).sessions ?? []);
    setTasks((t as { tasks?: typeof tasks }).tasks ?? []);
    setBranch((g as { info?: { branch?: string | null } }).info?.branch ?? null);
  }

  useEffect(() => {
    loadSetup();
    loadContext();
  }, [projectId, refreshKey]);

  const cards = useMemo<AgentCardInfo[]>(
    () =>
      composeTopologyCards({
        orchestration: orchestration ?? { master: null, subagents: [] },
        sessions,
        tasks,
        branch,
        adapters,
      }),
    [orchestration, sessions, tasks, branch, adapters]
  );

  async function setMaster() {
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/agentsetup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_type: masterType, role: "master", name: masterName.trim() }),
      });
      setNotice(`Master set to ${adapters[masterType]?.label ?? masterType}.`);
      await loadSetup();
    } finally {
      setBusy(false);
    }
  }

  async function addSubagent() {
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/agentsetup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_type: subType, role: subRole, name: subName.trim() }),
      });
      setSubName("");
      setShowAddForm(false);
      await loadSetup();
    } finally {
      setBusy(false);
    }
  }

  async function renameAgent(id: string, name: string) {
    await fetch(`/api/projects/${projectId}/agentsetup`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: id, name }),
    });
    await loadSetup();
  }

  async function removeAgent(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/agentsetup?agentId=${id}`, { method: "DELETE" });
      await loadSetup();
    } finally {
      setBusy(false);
    }
  }

  const master = orchestration?.master ?? null;
  const masterCard = cards.find((c) => c.role === "master") ?? null;
  const subCards = cards.filter((c) => c.role !== "master");

  const autoTasks = tasks.filter((t) => t.assigned_agent === "auto" || t.assigned_agent === "master");

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-green/25 bg-green-soft px-3 py-2 text-[11px] text-green">
          <span>{notice}</span>
          <Button size="xs" variant="ghost" onClick={() => setNotice(null)}>
            dismiss
          </Button>
        </div>
      )}

      {!master && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber/25 bg-amber-soft px-4 py-3.5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-amber">
              <span aria-hidden>⚠</span> No Master Agent configured
            </div>
            <p className="mt-0.5 text-[11px] text-fg-muted">
              Select a Master Agent to enable orchestration. Subagents coordinate through it.
            </p>
          </div>
          <a
            href="#master-config"
            className="inline-flex h-7.5 items-center rounded-md bg-amber px-3 text-xs font-semibold text-[#14100a] hover:bg-amber/90 transition-colors cursor-pointer"
          >
            Configure Master
          </a>
        </div>
      )}

      <Card>
        <CardHeader
          title="Agent topology"
          subtitle={
            master
              ? `${master.name} coordinates ${subCards.length} subagent${subCards.length === 1 ? "" : "s"}`
              : "No orchestration configured"
          }
          right={
            master ? <Badge tone="green">{cards.every((c) => c.connected) ? "team ready" : "some agents offline"}</Badge> : <Badge tone="amber">no master</Badge>
          }
        />
        <div className="p-4">
          <TeamGraph
            cards={cards}
            height={master ? 380 : 160}
            onSelect={(c) => c.sessionId && onOpenSession?.(c.sessionId)}
            emptyHint="Add a master agent and subagents below to build your engineering team."
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div id="master-config" className="contents">
        <Card>
          <CardHeader
            title="Master / Orchestrator"
            subtitle="Coordinates tasks, reads context, assigns work, reviews output."
            right={master ? <Badge tone="purple">{master.agent_type}</Badge> : <Badge tone="amber">not set</Badge>}
          />
          <div className="flex flex-col gap-4 p-4">
            {master && masterCard && (
              <div className="flex items-center gap-3 rounded-lg border border-border-strong bg-bg-subtle px-3 py-2.5">
                <Dot tone={masterCard.statusTone} pulse={masterCard.working} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12px] font-semibold text-fg">{master.name}</span>
                    <Badge tone={agentTone(master.agent_type)}>{master.agent_type}</Badge>
                  </div>
                  <div className="text-[10px] text-fg-dim">
                    {masterCard.connected
                      ? "connected · ready to orchestrate"
                      : "disconnected · CLI not found on PATH"}
                  </div>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wide text-fg-dim">
                  {masterCard.statusLabel}
                </span>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Field label="Available agents">
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(adapters).map(([k, v]) => (
                    <button
                      key={k}
                      onClick={() => setMasterType(k)}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors cursor-pointer",
                        masterType === k
                          ? "border-accent bg-accent-soft text-fg"
                          : "border-border-strong bg-bg text-fg-muted hover:border-fg-dim"
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", v.available ? "bg-green" : "bg-fg-dim")} />
                      {v.label}
                      {!v.available && <span className="text-[9px] font-normal text-fg-dim">not installed</span>}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Display name">
                <Input
                  value={masterName}
                  onChange={(e) => setMasterName(e.target.value)}
                  placeholder={master ? `${master.name} (keeps current)` : "e.g. Lead Orchestrator"}
                />
              </Field>
              <Button onClick={setMaster} disabled={busy}>
                {busy ? <Spinner /> : null}
                {master ? "Replace master agent" : "Set as master"}
              </Button>
            </div>
          </div>
        </Card>
        </div>

        <Card>
          <CardHeader
            title="Subagents"
            subtitle="Workers implement; reviewers verify changes and report issues."
            right={
              <Button size="xs" variant="outline" onClick={() => setShowAddForm((v) => !v)}>
                {showAddForm ? "Close" : "+ Add Subagent"}
              </Button>
            }
          />
          <div className="flex flex-col gap-2 p-3">
            {orchestration &&
              (orchestration.subagents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center">
                  <div className="text-[12px] font-medium text-fg-muted">No subagents yet</div>
                  <p className="mt-0.5 text-[11px] text-fg-dim">Add a worker or reviewer to build the team below the master.</p>
                </div>
              ) : (
                orchestration.subagents.map((a) => (
                  <SubagentRow
                    key={a.id}
                    agent={a}
                    card={subCards.find((c) => c.id === a.id) ?? null}
                    onRename={(name) => renameAgent(a.id, name)}
                    onRemove={() => removeAgent(a.id)}
                  />
                ))
              ))}

            {showAddForm && (
              <div className="mt-1 flex flex-col gap-3 rounded-lg border border-border bg-bg-subtle p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Agent">
                    <Select value={subType} onChange={(e) => setSubType(e.target.value)}>
                      {Object.entries(adapters).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                          {v.available ? "" : " (not installed)"}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Role">
                    <Select value={subRole} onChange={(e) => setSubRole(e.target.value)}>
                      <option value="worker">worker</option>
                      <option value="reviewer">reviewer</option>
                    </Select>
                  </Field>
                  <Field label="Name (optional)">
                    <Input value={subName} onChange={(e) => setSubName(e.target.value)} placeholder={`${AGENT_ROLE_LABEL[subRole as AgentRole]}`} />
                  </Field>
                </div>
                <Button onClick={addSubagent} disabled={busy}>
                  {busy ? <Spinner /> : null}
                  Add subagent
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Auto-assignment flow"
          subtitle="Tasks marked “Auto / Master” route through the configured master, which dispatches them to the team."
          right={autoTasks.length > 0 ? <Badge tone="purple">{autoTasks.length} queued</Badge> : undefined}
        />
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
          {autoTasks.length === 0 ? (
            <div className="text-[11px] leading-relaxed text-fg-dim">
              No auto-assigned tasks yet. On the{" "}
              <span className="text-fg-muted">Tasks</span> tab, assign a task to <span className="text-fg-muted">Auto / Master</span>{" "}
              and it will appear here with its dispatch path.
            </div>
          ) : (
            autoTasks.map((t) => (
              <div key={t.id} className="rounded-lg border border-border bg-bg-subtle p-3">
                <MiniChain taskTitle={t.title} master={masterCard} subs={subCards} />
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function SubagentRow({
  agent,
  card,
  onRename,
  onRemove,
}: {
  agent: SetupAgent;
  card: AgentCardInfo | null;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(agent.name);
  const [name, setName] = useState(agent.name);

  useEffect(() => {
    setName(agent.name);
    setDraft(agent.name);
  }, [agent.name]);

  const commit = useCallback(() => {
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    setEditing(false);
  }, [draft, name, onRename]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg px-3 py-2.5 transition-colors hover:border-border-strong">
      <Dot tone={card?.statusTone ?? "dim"} pulse={card?.working} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-6 text-[11px]"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="block max-w-full truncate text-left text-[12px] font-medium text-fg transition-colors hover:text-accent cursor-pointer"
            title="Rename"
          >
            {agent.name}
          </button>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-fg-dim">
          <Badge tone={agent.role === "reviewer" ? "cyan" : agentTone(agent.agent_type)}>{AGENT_ROLE_LABEL[agent.role]}</Badge>
          <span className="font-mono normal-case">{agent.agent_type}</span>
          <span>{card?.connected ? "connected" : "disconnected"}</span>
          {card?.taskTitle && <span className="truncate">· {card.taskTitle}</span>}
        </div>
      </div>
      <button
        onClick={onRemove}
        className="rounded p-1 text-fg-dim transition-colors hover:bg-red/10 hover:text-red cursor-pointer"
        title={`Remove ${agent.name}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
        </svg>
      </button>
    </div>
  );
}