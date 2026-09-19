"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardHeader, Dot, Empty, Spinner, Badge, SplitView, SectionLabel, TabBar, Tab } from "@/components/ui";
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

  if (loading && handoffs.length === 0) {
    return (
      <Card className="flex items-center justify-center p-12">
        <Spinner />
      </Card>
    );
  }

  if (handoffs.length === 0) {
    return (
      <Card className="p-8">
        <Empty
          title="No handoffs yet"
          hint="When an agent pauses or finishes a task, it creates a structured handoff to pass completed work, decisions, and blockers to the next task agent."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header with stats */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-fg">Agent Handoffs</h2>
          <span className="rounded bg-bg-subtle px-2 py-0.5 text-[11px] font-mono text-fg-dim">
            {handoffs.length}
          </span>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-amber">
              <Dot tone="amber" pulse={pendingCount > 0} />
              {pendingCount} pending
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-green">
              <Dot tone="green" />
              {acceptedCount} accepted
            </span>
          </div>
        </div>
        <TabBar className="border-0 px-0">
          <Tab active={filter === "all"} onClick={() => setFilter("all")}>All</Tab>
          <Tab active={filter === "pending"} onClick={() => setFilter("pending")} count={pendingCount}>Pending</Tab>
          <Tab active={filter === "accepted"} onClick={() => setFilter("accepted")} count={acceptedCount}>Accepted</Tab>
        </TabBar>
      </div>

      <SplitView
        list={
          <div className="flex flex-col gap-2">
            {filtered.length === 0 ? (
              <Card className="p-6 text-center text-[12px] text-fg-dim">
                No {filter} handoffs found.
              </Card>
            ) : (
              filtered.map((h) => {
                const isSelected = selected?.id === h.id;
                return (
                  <button
                    key={h.id}
                    onClick={() => setSelectedId(h.id)}
                    className={cn(
                      "group flex flex-col gap-2 rounded-lg border p-3 transition-all duration-100 cursor-pointer text-left w-full",
                      isSelected
                        ? "border-border-strong bg-bg-elevated"
                        : "border-border bg-bg-elevated/70 hover:border-border-strong"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate text-[12px] font-semibold text-fg">
                          {h.sourceTaskTitle}
                        </span>
                        <span className="text-fg-dim shrink-0">→</span>
                        <span className="truncate text-[12px] font-semibold text-fg">
                          {h.targetTaskTitle}
                        </span>
                      </div>
                      <Badge
                        tone={h.status === "pending" ? "amber" : h.status === "accepted" ? "green" : "dim"}
                      >
                        {h.status}
                      </Badge>
                    </div>
                    <p className="line-clamp-2 text-[11px] leading-relaxed text-fg-muted">
                      {h.summary}
                    </p>
                    <div className="flex items-center justify-between pt-0.5 text-[10px] text-fg-dim">
                      <span>{fmtDate(h.created_at)}</span>
                      {h.blockers.length > 0 && (
                        <span className="text-red font-medium">
                          {h.blockers.length} blocker{h.blockers.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        }
        detail={
          selected ? (
            <Card>
              <CardHeader
                title="Handoff Details"
                right={
                  selected.status === "pending" ? (
                    <Button
                      variant="success"
                      size="sm"
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
                {/* Task flow */}
                <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-subtle p-3">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[9px] uppercase tracking-wider text-fg-dim">From</span>
                    <span className="truncate text-[12px] font-semibold text-fg">{selected.sourceTaskTitle}</span>
                  </div>
                  <span className="text-fg-dim shrink-0 text-lg">→</span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[9px] uppercase tracking-wider text-fg-dim">To</span>
                    <span className="truncate text-[12px] font-semibold text-fg">{selected.targetTaskTitle}</span>
                  </div>
                  <span className="ml-auto text-[10px] font-mono text-fg-dim shrink-0">
                    {selected.id.slice(0, 8)}
                  </span>
                </div>

                {/* Summary */}
                <div>
                  <SectionLabel className="mb-1.5">Summary</SectionLabel>
                  <div className="rounded-lg border border-border bg-bg p-3 text-[12px] leading-relaxed text-fg">
                    {selected.summary}
                  </div>
                </div>

                {/* Completed Work */}
                <div>
                  <SectionLabel className="mb-1.5">Completed Work</SectionLabel>
                  <pre className="whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-fg-muted">
                    {selected.completed_work}
                  </pre>
                </div>

                {/* Changed Files */}
                {selected.changed_files?.length > 0 && (
                  <div>
                    <SectionLabel className="mb-1.5">Changed Files ({selected.changed_files.length})</SectionLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.changed_files.map((file, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-fg-muted"
                        >
                          {file}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Decisions */}
                {selected.decisions?.length > 0 && (
                  <div>
                    <SectionLabel className="mb-1.5">Decisions Made</SectionLabel>
                    <ul className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg p-3">
                      {selected.decisions.map((d, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-[12px] text-fg">
                          <span className="text-fg-dim mt-0.5">•</span>
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Blockers */}
                {selected.blockers?.length > 0 && (
                  <div>
                    <SectionLabel className="mb-1.5 text-red">Blockers</SectionLabel>
                    <ul className="flex flex-col gap-1.5 rounded-lg border border-red/25 bg-red-soft/30 p-3">
                      {selected.blockers.map((b, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-[12px] text-red font-medium">
                          <span className="mt-0.5">!</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Next Steps */}
                {selected.next_steps?.length > 0 && (
                  <div>
                    <SectionLabel className="mb-1.5">Next Steps</SectionLabel>
                    <ul className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg p-3">
                      {selected.next_steps.map((s, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-[12px] text-fg">
                          <span className="text-fg-dim mt-0.5">→</span>
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
          ) : null
        }
      />
    </div>
  );
}
