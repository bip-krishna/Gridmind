"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardHeader, CopyButton, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

type Commit = {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  dateTs: number;
};

export function TimelinePanel({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [recentPrs, setRecentPrs] = useState<string[]>([]);

  async function load() {
    const res = await fetch(`/api/projects/${projectId}/git`);
    const d = await res.json();
    setCommits(d.commits ?? []);
    setBranches(d.branches ?? []);
    setCurrent(d.current ?? "");
    setRecentPrs(d.recentPrs ?? []);
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

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Commit timeline"
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
                    <span className="absolute left-0 top-1 size-2.5 rounded-full border-2 border-accent bg-bg" />
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

      <Card>
        <CardHeader title="Recently referenced branches" subtitle="From git log --all" />
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