"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardHeader, Dot, Empty, Spinner } from "@/components/ui";
import { cn, fmtDate } from "@/lib/utils";

type HandoffItem = {
  id: string;
  project_id: string;
  source_session_id: string;
  source_task_id: string;
  target_task_id: string;
  sourceTaskTitle: string;
  targetTaskTitle: string;
  summary: string;
  completed_work: string;
  changed_files: string[];
  decisions: string[];
  blockers: string[];
  next_steps: string[];
  status: "pending" | "accepted" | "completed" | "cancelled";
  created_at: number;
  consumed_at: number | null;
};

export function HandoffsPanel({
  projectId,
  refreshKey,
}: {
  projectId: string;
  refreshKey: number;
}) {
  const [handoffs, setHandoffs] = useState<HandoffItem[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "accepted">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch(`/api/projects/${projectId}/handoffs`);
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; handoffs: HandoffItem[] };
        setHandoffs(data.handoffs ?? []);
        if (data.handoffs?.length && !selectedId) {
          setSelectedId(data.handoffs[0].id);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [projectId, refreshKey]);

  async function handleAccept(handoffId: string) {
    setBusyId(handoffId);
    try {
      const res = await fetch(`/api/projects/${projectId}/handoffs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoffId, action: "accept" }),
      });
      if (res.ok) {
        await load();
      }
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = handoffs.filter((h) => h.status === "pending").length;
  const acceptedCount = handoffs.filter((h) => h.status === "accepted").length;

  const filtered = handoffs.filter((h) => {
    if (filter === "pending") return h.status === "pending";
    if (filter === "accepted") return h.status === "accepted";
    return true;
  });

  const selected = handoffs.find((h) => h.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="flex flex-col gap-5">
      {/* Metrics & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">Agent Handoffs</h2>
            <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] font-mono text-fg-dim">
              {handoffs.length}
            </span>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <span className="inline-flex items-center gap-1.5 rounded border border-amber/25 bg-amber-soft px-2 py-0.5 text-[10px] font-medium text-amber">
              <Dot tone="amber" pulse={pendingCount > 0} />
              {pendingCount} pending
            </span>
            <span className="inline-flex items-center gap-1.5 rounded border border-green/25 bg-green-soft px-2 py-0.5 text-[10px] font-medium text-green">
              <Dot tone="green" />
              {acceptedCount} accepted
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-elevated p-1 text-[11px]">
          {(["all", "pending", "accepted"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded px-2.5 py-1 font-medium capitalize transition-colors cursor-pointer",
                filter === f
                  ? "bg-bg-subtle text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading && handoffs.length === 0 ? (
        <Card className="flex items-center justify-center p-12">
          <Spinner />
        </Card>
      ) : handoffs.length === 0 ? (
        <Card className="p-8">
          <Empty
            title="No handoffs yet"
            hint="When an agent pauses or finishes a task, it creates a structured handoff to pass completed work, decisions, and blockers to the next task agent via gridmind_create_handoff."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Left Column: Handoffs List */}
          <div className="flex flex-col gap-2.5 lg:col-span-5">
            {filtered.length === 0 ? (
              <Card className="p-6 text-center text-[12px] text-fg-dim">
                No {filter} handoffs found.
              </Card>
            ) : (
              filtered.map((h) => {
                const isSelected = selected?.id === h.id;
                return (
                  <div
                    key={h.id}
                    onClick={() => setSelectedId(h.id)}
                    className={cn(
                      "group flex flex-col gap-2 rounded-xl border p-3.5 transition-all duration-150 cursor-pointer text-left",
                      isSelected
                        ? "border-accent bg-bg-elevated shadow-sm"
                        : "border-border bg-bg-elevated/70 hover:border-border-strong hover:bg-bg-elevated"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate text-[12px] font-semibold text-fg">
                          {h.sourceTaskTitle}
                        </span>
                        <span className="text-fg-dim">→</span>
                        <span className="truncate text-[12px] font-semibold text-fg">
                          {h.targetTaskTitle}
                        </span>
                      </div>

                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          h.status === "pending"
                            ? "border border-amber/30 bg-amber-soft text-amber"
                            : h.status === "accepted"
                              ? "border border-green/30 bg-green-soft text-green"
                              : "border border-border bg-bg-subtle text-fg-muted"
                        )}
                      >
                        {h.status}
                      </span>
                    </div>

                    <p className="line-clamp-2 text-[11px] leading-relaxed text-fg-muted">
                      {h.summary}
                    </p>

                    <div className="flex items-center justify-between pt-1 text-[10px] text-fg-dim">
                      <span>{fmtDate(h.created_at)}</span>
                      {h.blockers.length > 0 && (
                        <span className="text-red font-medium">
                          {h.blockers.length} blocker{h.blockers.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Column: Detailed Handoff Inspector */}
          <div className="lg:col-span-7">
            {selected ? (
              <Card className="flex flex-col">
                <CardHeader
                  title="Handoff Details"
                  right={
                    selected.status === "pending" ? (
                      <Button
                        variant="success"
                        size="xs"
                        disabled={busyId === selected.id}
                        onClick={() => handleAccept(selected.id)}
                      >
                        {busyId === selected.id ? <Spinner /> : null}
                        Accept Handoff
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-green font-medium">
                        <Dot tone="green" /> Accepted
                      </span>
                    )
                  }
                />

                <div className="flex flex-col gap-4 p-4">
                  {/* Task Flow Banner */}
                  <div className="flex flex-col gap-2 rounded-lg border border-border-strong bg-bg-subtle/80 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase tracking-wider text-fg-dim">Source Task</span>
                          <span className="truncate text-[12px] font-semibold text-fg">{selected.sourceTaskTitle}</span>
                        </div>
                        <span className="text-fg-dim px-2">→</span>
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase tracking-wider text-fg-dim">Target Task</span>
                          <span className="truncate text-[12px] font-semibold text-fg">{selected.targetTaskTitle}</span>
                        </div>
                      </div>

                      <div className="text-right text-[10px] font-mono text-fg-dim">
                        ID: {selected.id}
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-dim">
                      Summary
                    </span>
                    <div className="rounded-lg border border-border bg-bg p-3 text-[12px] leading-relaxed text-fg">
                      {selected.summary}
                    </div>
                  </div>

                  {/* Completed Work */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-dim">
                      Completed Work
                    </span>
                    <div className="whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 text-[12px] leading-relaxed text-fg font-mono text-[11px]">
                      {selected.completed_work}
                    </div>
                  </div>

                  {/* Changed Files */}
                  {selected.changed_files && selected.changed_files.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-dim">
                        Changed Files ({selected.changed_files.length})
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {selected.changed_files.map((file, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded border border-border-strong bg-bg px-2 py-0.5 font-mono text-[11px] text-fg-muted"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
                              <path d="M13 2v7h7" />
                            </svg>
                            {file}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Decisions */}
                  {selected.decisions && selected.decisions.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-dim">
                        Decisions Made
                      </span>
                      <ul className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg p-3">
                        {selected.decisions.map((d, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-[12px] text-fg">
                            <span className="text-purple mt-0.5">•</span>
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Blockers */}
                  {selected.blockers && selected.blockers.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-red">
                        Blockers & Dependencies
                      </span>
                      <ul className="flex flex-col gap-1.5 rounded-lg border border-red/25 bg-red-soft/30 p-3">
                        {selected.blockers.map((b, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-[12px] text-red font-medium">
                            <span className="mt-0.5">⚠</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Next Steps */}
                  {selected.next_steps && selected.next_steps.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                        Recommended Next Steps
                      </span>
                      <ul className="flex flex-col gap-1.5 rounded-lg border border-accent/25 bg-accent-soft/20 p-3">
                        {selected.next_steps.map((s, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-[12px] text-fg">
                            <span className="text-accent mt-0.5">→</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Timestamps */}
                  <div className="flex items-center justify-between border-t border-border pt-3 text-[11px] text-fg-dim">
                    <span>Created: {fmtDate(selected.created_at)}</span>
                    {selected.consumed_at && (
                      <span>Accepted: {fmtDate(selected.consumed_at)}</span>
                    )}
                  </div>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
