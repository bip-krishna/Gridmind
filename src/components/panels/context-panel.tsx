"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Confirmation, CopyButton, Empty, Field, Input, Textarea } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

type ContextEntry = { key: string; value: string };
type Decision = { id: string; title: string; body: string; status: string; created_at: number };

export function ContextPanel({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [brief, setBrief] = useState("");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [dTitle, setDTitle] = useState("");
  const [dBody, setDBody] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  async function load() {
    const [c, d] = await Promise.all([
      fetch(`/api/projects/${projectId}/context`).then((r) => r.json()).catch(() => ({ context: [], brief: "" })),
      fetch(`/api/projects/${projectId}/decisions`).then((r) => r.json()).catch(() => ({ decisions: [] })),
    ]);
    setEntries(c.context ?? []);
    setBrief(c.brief ?? "");
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

  const filtered = statusFilter === "all" ? decisions : decisions.filter((d) => d.status === statusFilter);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Project context"
          subtitle="Scoped to this project only — never leaks across projects"
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
            <Empty title="No context set" hint="Context is injected into master agent prompts so it stays project-aware." />
          ) : (
            <div className="flex flex-col">
              {entries.map((e) => (
                <div key={e.key} className="group flex items-start gap-3 rounded-lg border border-transparent px-3 py-2 hover:border-border hover:bg-bg-subtle/50 transition-colors">
                  <span className="w-40 shrink-0 truncate font-mono text-[11px] text-accent">{e.key}</span>
                  <span className="flex-1 text-[11px] text-fg-muted">{e.value}</span>
                  {confirmDel === e.key ? (
                    <Confirmation onConfirm={() => removeContext(e.key)} onCancel={() => setConfirmDel(null)} />
                  ) : (
                    <button
                      onClick={() => setConfirmDel(e.key)}
                      className="hidden rounded p-1 text-fg-dim hover:text-red cursor-pointer group-hover:block"
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

      <Card>
        <CardHeader
          title="Decisions"
          subtitle="Recorded decisions that the team should follow"
          right={<Badge tone="purple">{decisions.length} recorded</Badge>}
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
        <div className="flex items-center gap-1 border-b border-border px-3 py-2">
          {(["all", "open", "superseded", "accepted"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                statusFilter === s ? "bg-bg-subtle text-fg border border-border-strong" : "text-fg-muted hover:text-fg"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="p-2">
          {filtered.length === 0 ? (
            <Empty title="No decisions yet" hint="Record rationale so agents and teammates follow the same direction." />
          ) : (
            <div className="flex flex-col">
              {filtered.map((d) => (
                <div key={d.id} className="rounded-lg border border-transparent px-3 py-2 hover:border-border hover:bg-bg-subtle/40 transition-colors">
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
  );
}