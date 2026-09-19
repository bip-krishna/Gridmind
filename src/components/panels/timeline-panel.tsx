"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardHeader, CopyButton, Empty, TabBar, Tab, Dot } from "@/components/ui";
import { fmtDate, cn } from "@/lib/utils";
import { useSSE } from "@/lib/hooks";

type Commit = {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  dateTs: number;
};

type TimelineEvent = {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  ts: number;
};

const EVENT_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "agent", label: "Agent" },
  { id: "task", label: "Task" },
  { id: "git", label: "Git" },
  { id: "handoff", label: "Handoff" },
  { id: "github", label: "GitHub" },
] as const;

export function TimelinePanel({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [recentPrs, setRecentPrs] = useState<string[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [filterCategory, setFilterCategory] = useState("all");

  const { connected } = useSSE(projectId, (e) => {
    setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [...prev, e].slice(-100)));
  });

  async function load() {
    const [gitRes, eventsRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/git`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/projects/${projectId}/events`).then((r) => r.json()).catch(() => ({ events: [] })),
    ]);
    setCommits(gitRes.commits ?? []);
    setBranches(gitRes.branches ?? []);
    setCurrent(gitRes.current ?? "");
    setRecentPrs(gitRes.recentPrs ?? []);
    setEvents((eventsRes.events ?? []).slice(-100));
  }

  useEffect(() => {
    load();
  }, [projectId, refreshKey]);

  const commitsByDay = new Map<string, Commit[]>();
  for (const c of commits) {
    const key = fmtDate(c.dateTs);
    const list = commitsByDay.get(key) ?? [];
    list.push(c);
    commitsByDay.set(key, list);
  }

  const filteredEvents = filterCategory === "all"
    ? events
    : events.filter((e) => {
      if (filterCategory === "github") return e.type.startsWith("github:") || e.type.startsWith("pr:") || e.type.startsWith("issue:");
      return e.type.startsWith(filterCategory + ":");
    });

  const sortedEvents = [...filteredEvents].sort((a, b) => b.ts - a.ts).slice(0, 60);

  return (
    <div className="flex flex-col gap-4">
      {/* Event stream */}
      <Card>
        <CardHeader
          title="Event Stream"
          subtitle={connected ? "live" : "offline"}
          right={
            <div className="flex items-center gap-1.5">
              <Dot tone={connected ? "green" : "red"} pulse={connected} />
              <span className="text-[10px] font-mono text-fg-dim">{events.length} events</span>
            </div>
          }
        />
        <TabBar>
          {EVENT_CATEGORIES.map((c) => (
            <Tab key={c.id} active={filterCategory === c.id} onClick={() => setFilterCategory(c.id)}>
              {c.label}
            </Tab>
          ))}
        </TabBar>
        <div className="max-h-[400px] overflow-y-auto p-2">
          {sortedEvents.length === 0 ? (
            <Empty title="No events" hint="Events appear here as agents, tasks, and git operations run." />
          ) : (
            <div className="flex flex-col">
              {sortedEvents.map((e, i) => {
                const meta = eventTypeMeta(e.type);
                const detail = eventDetail(e.type, e.payload);
                return (
                  <div key={e.id || i} className="flex gap-2.5 px-2 py-1.5 text-[11px] hover:bg-bg-subtle/40 rounded transition-colors">
                    <div className="flex flex-col items-center pt-0.5">
                      <span className={cn("size-1.5 rounded-full shrink-0", meta.dot)} />
                      {i < sortedEvents.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[9px] text-fg-dim uppercase tracking-wider">{meta.label}</span>
                        {detail && <span className="text-fg font-medium truncate">{detail}</span>}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] text-fg-dim font-mono">
                      {e.ts ? new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Commit timeline */}
      <Card>
        <CardHeader
          title="Commit Timeline"
          subtitle={`${branches.length} branches · on ${current}`}
          right={
            <div className="flex flex-wrap gap-1.5">
              {branches.slice(0, 5).map((b) => (
                <Badge key={b} tone={b === current ? "accent" : "dim"}>
                  {b}
                </Badge>
              ))}
            </div>
          }
        />
        <div className="p-4">
          {commits.length === 0 ? (
            <Empty title="No commits" hint="This repo has no commits yet." />
          ) : (
            <div className="relative">
              <div className="absolute bottom-0 left-[5px] top-0 w-px bg-border" />
              <div className="flex flex-col gap-6">
                {Array.from(commitsByDay.entries()).map(([day, dayCommits]) => (
                  <div key={day} className="relative pl-6">
                    <span className="absolute left-0 top-1 size-2.5 rounded-full border-2 border-fg bg-bg" />
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted">{day}</div>
                    <div className="flex flex-col">
                      {dayCommits.map((c) => (
                        <div key={c.sha} className="flex items-center gap-3 border-l border-border py-2 pl-4">
                          <div className="flex-1">
                            <div className="text-[13px] text-fg">{c.message}</div>
                            <div className="mt-0.5 text-[10px] text-fg-dim">
                              {c.author} · <span className="font-mono">{c.dateTs ? new Date(c.dateTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                            </div>
                          </div>
                          <code className="font-mono text-[10px] text-fg-dim">{c.shortSha}</code>
                          <CopyButton text={c.sha} label="full" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Branch references */}
      <Card>
        <CardHeader title="Recent Branch References" subtitle="From git log --all" />
        <div className="p-2">
          {recentPrs.length === 0 ? (
            <Empty title="No multi-branch history" />
          ) : (
            <div className="flex flex-col">
              {recentPrs.map((p, i) => {
                const [sha, ...rest] = p.split(" ");
                return (
                  <div key={p + i} className="flex items-center gap-3 rounded-md px-2.5 py-1.5 text-[11px] hover:bg-bg-subtle transition-colors">
                    <span className="font-mono text-[10px] text-fg-dim">{sha.slice(0, 7)}</span>
                    <span className="flex-1 truncate text-fg-muted">{rest.join(" ")}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function eventTypeMeta(type: string): { label: string; dot: string } {
  if (type.startsWith("agent:")) return { label: type.replace("agent:", ""), dot: "bg-amber" };
  if (type.startsWith("task:")) return { label: type.replace("task:", ""), dot: "bg-fg" };
  if (type.startsWith("git:")) return { label: type.replace("git:", ""), dot: "bg-green" };
  if (type.startsWith("handoff:")) return { label: type.replace("handoff:", ""), dot: "bg-amber" };
  if (type.startsWith("context:")) return { label: type.replace("context:", ""), dot: "bg-fg-dim" };
  if (type.startsWith("pr:") || type.startsWith("github:") || type.startsWith("issue:")) return { label: type, dot: "bg-green" };
  return { label: type, dot: "bg-fg-dim" };
}

function eventDetail(type: string, payload: Record<string, unknown>): string | null {
  switch (type) {
    case "agent:started": return String(payload.title ?? payload.agentType ?? "");
    case "agent:finished": return String(payload.status ?? "");
    case "agent:error": return String(payload.message ?? "");
    case "task:created": return String(payload.title ?? "");
    case "task:updated": return String(payload.status ?? "");
    case "git:commit": return String(payload.message ?? payload.branch ?? "");
    case "git:branch-created": return String(payload.branch ?? "");
    case "handoff:created": return `${String(payload.source_task_id ?? "")} → ${String(payload.target_task_id ?? "")}`;
    case "handoff:accepted": return `${String(payload.source_task_id ?? "")} → ${String(payload.target_task_id ?? "")}`;
    case "issue:imported": return `#${String(payload.issueNumber ?? "")}`;
    case "pr:created": return `#${String(payload.pr_number ?? payload.number ?? "")}`;
    default: return null;
  }
}
