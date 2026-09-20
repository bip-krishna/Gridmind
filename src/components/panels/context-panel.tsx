"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Confirmation, CopyButton, Empty, Field, Input, Textarea, TabBar, Tab } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

type ContextEntry = { key: string; value: string };
type Decision = { id: string; title: string; body: string; status: string; created_at: number };
type MemoryEntry = {
  id: string;
  scope: "project_shared" | "agent_private" | "task";
  type: "fact" | "discovery" | "constraint" | "note";
  content: string;
  importance: number;
  source: string;
  created_at: number;
};

export function ContextPanel({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [brief, setBrief] = useState("");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [dTitle, setDTitle] = useState("");
  const [dBody, setDBody] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [memFilter, setMemFilter] = useState("all");

  async function load() {
    const [c, d] = await Promise.all([
      fetch(`/api/projects/${projectId}/context`).then((r) => r.json()).catch(() => ({ context: [], brief: "", memories: [] })),
      fetch(`/api/projects/${projectId}/decisions`).then((r) => r.json()).catch(() => ({ decisions: [] })),
    ]);
    setEntries(c.context ?? []);
    setBrief(c.brief ?? "");
    setMemories(c.memories ?? []);
    setDecisions(d.decisions ?? []);
  }

  useEffect(() => {
    load();
  }, [projectId, refreshKey]);

  async function addContext() {
    if (!key.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim(), value }),
      });
      setKey("");
      setValue("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeContext(k: string) {
    await fetch(`/api/projects/${projectId}/context?key=${encodeURIComponent(k)}`, { method: "DELETE" });
    setConfirmDel(null);
    await load();
  }

  async function addDecision() {
    if (!dTitle.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: dTitle.trim(), body: dBody }),
      });
      setDTitle("");
      setDBody("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const filteredDecisions = statusFilter === "all" ? decisions : decisions.filter((d) => d.status === statusFilter);
  const filteredMemories = memFilter === "all" ? memories : memories.filter((m) => m.type === memFilter);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {/* Left Column: Key-Value Context + Decisions */}
      <div className="flex flex-col gap-4">
        {/* Project context */}
        <Card>
          <CardHeader
            title="Project Context"
            subtitle="Scoped key-value knowledge injected into agent prompts"
            right={
              entries.length > 0 ? (
                <CopyButton text={brief} label="copy brief" />
              ) : undefined
            }
          />
          <div className="border-b border-border p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <Field label="Key">
                <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="stack, conventions…" className="font-mono" />
              </Field>
              <Field label="Value">
                <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Next.js 15 + Tailwind" />
              </Field>
              <Button onClick={addContext} disabled={busy || !key.trim()}>
                Add
              </Button>
            </div>
          </div>
          <div className="p-2">
            {entries.length === 0 ? (
              <Empty title="No context set" hint="Context key-values are automatically injected into agent prompts." />
            ) : (
              <div className="flex flex-col">
                {entries.map((e) => (
                  <div key={e.key} className="group flex items-start gap-3 rounded-md border border-transparent px-3 py-2 hover:border-border hover:bg-bg-subtle/50 transition-colors">
                    <span className="w-36 shrink-0 truncate font-mono text-[11px] text-fg font-medium">{e.key}</span>
                    <span className="flex-1 text-[11px] text-fg-muted font-mono">{e.value}</span>
                    {confirmDel === e.key ? (
                      <Confirmation onConfirm={() => removeContext(e.key)} onCancel={() => setConfirmDel(null)} />
                    ) : (
                      <button
                        onClick={() => setConfirmDel(e.key)}
                        className="hidden rounded p-1 text-fg-dim hover:text-red cursor-pointer group-hover:block"
                        aria-label={`Delete context key ${e.key}`}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Decisions */}
        <Card>
          <CardHeader
            title="Decisions"
            subtitle="Recorded engineering decisions that the team follows"
            right={<Badge tone="dim">{decisions.length} recorded</Badge>}
          />
          <div className="border-b border-border p-4">
            <div className="flex flex-col gap-3">
              <Field label="Decision">
                <Input value={dTitle} onChange={(e) => setDTitle(e.target.value)} placeholder="Prefer Server Components for data views" />
              </Field>
              <Field label="Rationale / notes">
                <Textarea rows={2} value={dBody} onChange={(e) => setDBody(e.target.value)} placeholder="Why this decision was made…" />
              </Field>
              <div>
                <Button onClick={addDecision} disabled={busy || !dTitle.trim()}>
                  Record decision
                </Button>
              </div>
            </div>
          </div>
          <TabBar>
            {(["all", "open", "superseded", "accepted"] as const).map((s) => (
              <Tab key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {s}
              </Tab>
            ))}
          </TabBar>
          <div className="p-2">
            {filteredDecisions.length === 0 ? (
              <Empty title="No decisions yet" hint="Record rationale so agents and teammates follow the same direction." />
            ) : (
              <div className="flex flex-col">
                {filteredDecisions.map((d) => (
                  <div key={d.id} className="rounded-md border border-transparent px-3 py-2 hover:border-border hover:bg-bg-subtle/40 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-[12px] font-medium text-fg">{d.title}</span>
                      <Badge tone={d.status === "open" ? "amber" : d.status === "accepted" ? "green" : "dim"}>{d.status}</Badge>
                      <span className="text-[10px] text-fg-dim">{fmtDate(d.created_at)}</span>
                    </div>
                    {d.body && <p className="mt-1 text-[11px] leading-relaxed text-fg-dim">{d.body}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Right Column: Project Memories & Auto-Captured Context */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="Project Memory & Learned Context"
            subtitle="Auto-captured git commits, task completions, and agent knowledge"
            right={<Badge tone="green">{memories.length} memories</Badge>}
          />
          <TabBar>
            {(["all", "fact", "constraint", "discovery", "note"] as const).map((f) => (
              <Tab key={f} active={memFilter === f} onClick={() => setMemFilter(f)}>
                {f === "all" ? "All Memories" : f.charAt(0).toUpperCase() + f.slice(1) + "s"}
              </Tab>
            ))}
          </TabBar>
          <div className="p-2">
            {filteredMemories.length === 0 ? (
              <Empty
                title="No memories recorded yet"
                hint="Agents automatically capture git commits, task completions, and architectural facts here."
              />
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[720px] overflow-y-auto">
                {filteredMemories.map((m) => {
                  const isCommit = m.content.startsWith("Git commit");
                  const isTask = m.content.startsWith("Task completed");
                  return (
                    <div
                      key={m.id}
                      className="flex flex-col gap-1 rounded-md border border-border bg-bg-elevated p-3 transition-colors hover:border-border-strong"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Badge tone={m.type === "constraint" ? "amber" : m.type === "discovery" ? "green" : "dim"}>
                            {m.type}
                          </Badge>
                          <span className="text-[10px] font-mono text-fg-dim uppercase">
                            {m.source}
                          </span>
                          {m.importance > 1 && (
                            <span className="text-[10px] font-mono text-amber">
                              {"★".repeat(m.importance)}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-fg-dim">
                          {fmtDate(m.created_at)}
                        </span>
                      </div>
                      <p className={`text-[12px] leading-relaxed text-fg ${isCommit || isTask ? "font-mono text-[11px]" : ""}`}>
                        {m.content}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
