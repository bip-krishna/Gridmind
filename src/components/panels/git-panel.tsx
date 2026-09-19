"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Confirmation, CopyButton, Empty, Field, Input, Spinner } from "@/components/ui";
import { gitRemoteDisplay, timeAgo } from "@/lib/utils";

type GitData = {
  repoInfo?: { isRepo: boolean; branch: string; remote: string | null; filesChanged: number; dirty: boolean } | null;
  branches?: string[];
  current?: string;
  aheadBehind?: string;
  commits?: { sha: string; shortSha: string; message: string; author: string; dateTs: number }[];
};

type DiffFile = { path: string; additions: number; deletions: number; hunks: string };
type Conflict = { fileName: string };

export function GitPanel({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [data, setData] = useState<GitData>({});
  const [diffPairs, setDiffPairs] = useState<DiffFile[]>([]);
  const [activeDiff, setActiveDiff] = useState<DiffFile | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [conflictTarget, setConflictTarget] = useState("");
  const [conflictScanned, setConflictScanned] = useState<{ current: string; target: string } | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCommit, setConfirmCommit] = useState(false);

  async function load() {
    const res = await fetch(`/api/projects/${projectId}/git`);
    const d = await res.json();
    setData(d);
    setError(null);
    const diffRes = await fetch(`/api/projects/${projectId}/git/ops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "diff" }),
    });
    const diffData = await diffRes.json();
    setDiffPairs(diffData.files ?? []);
  }

  useEffect(() => {
    load();
  }, [projectId, refreshKey]);

  async function op(action: string, body: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/git/ops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "operation failed");
        return null;
      }
      return d;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function scanConflicts() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/conflicts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: conflictTarget || undefined }),
      });
      const d = await res.json();
      setConflicts(d.conflicts ?? []);
      setConflictScanned(d.scanned ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const info = data.repoInfo;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Repository"
            subtitle={info?.isRepo ? `${info.branch} — ${gitRemoteDisplay(info.remote ?? null)}` : "not a git repo"}
            right={info && <Badge tone={info.dirty ? "amber" : "green"}>{info.dirty ? `${info.filesChanged} changed` : "clean"}</Badge>}
          />
          <div className="p-4">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="flex-1">
                <Field label="Create / switch branch">
                  <div className="flex gap-2">
                    <Input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="feature/foo" className="font-mono" />
                    <Button
                      disabled={busy || !newBranch.trim()}
                      onClick={async () => {
                        const d = await op("create-branch", { branch: newBranch.trim() });
                        if (d) {
                          setNewBranch("");
                          await load();
                        }
                      }}
                    >
                      Create & checkout
                    </Button>
                  </div>
                </Field>
              </div>
              <div className="flex-1">
                <Field label="Branches">
                  <div className="flex gap-2">
                    <select
                      className="h-8 flex-1 rounded-md border border-border-strong bg-bg px-2 text-xs text-fg cursor-pointer"
                      value={data.current ?? ""}
                      onChange={async (e) => {
                        if (!e.target.value) return;
                        await op("checkout", { branch: e.target.value });
                        await load();
                      }}
                    >
                      {(data.branches ?? []).map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <Button variant="outline" onClick={load}>
                      Refresh
                    </Button>
                  </div>
                </Field>
              </div>
            </div>

            {info?.dirty && (
              <div className="mb-4 rounded-lg border border-border-strong bg-bg-subtle p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[12px] font-medium text-fg">
                    Uncommitted changes <span className="text-fg-dim">({info.filesChanged} files)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {confirmCommit ? (
                      <Confirmation
                        onConfirm={async () => {
                          const d = await op("commit", { message: commitMsg.trim() || "WIP" });
                          if (d) {
                            setCommitMsg("");
                            setConfirmCommit(false);
                            await load();
                          }
                        }}
                        onCancel={() => setConfirmCommit(false)}
                      />
                    ) : (
                      <Button onClick={() => setConfirmCommit(true)} disabled={busy}>
                        Stage & commit
                      </Button>
                    )}
                  </div>
                </div>
                <Input
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Commit message…"
                  disabled={confirmCommit}
                />
              </div>
            )}

            {error && (
              <div className="mb-3 rounded-md border border-red/30 bg-red-soft px-3 py-2 text-[11px] text-red">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between border-b border-border pb-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg-dim">
                Diff — {diffPairs.length} file{diffPairs.length === 1 ? "" : "s"}
              </div>
              <div className="flex gap-4 text-[10px] text-fg-dim">
                <span>
                  <span className="text-green">+{diffPairs.reduce((a, f) => a + f.additions, 0)}</span>
                </span>
                <span>
                  <span className="text-red">−{diffPairs.reduce((a, f) => a + f.deletions, 0)}</span>
                </span>
              </div>
            </div>

            <div className="mt-2 flex flex-col">
              {diffPairs.length === 0 ? (
                <Empty title="No working-tree diff" hint="Changes appear here as you or the agents edit files." />
              ) : (
                diffPairs.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => setActiveDiff(activeDiff?.path === f.path ? null : f)}
                    className="cursor-pointer rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-bg-subtle transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate font-mono text-fg-muted">{f.path}</span>
                      <span className="text-green">+{f.additions}</span>
                      <span className="text-red">−{f.deletions}</span>
                    </div>
                  </button>
                ))
              )}
            </div>

            {activeDiff && (
              <div className="mt-2 rounded-lg border border-border-strong bg-bg-subtle">
                <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                  <span className="font-mono text-[11px] text-fg">{activeDiff.path}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-green text-[10px]">+{activeDiff.additions}</span>
                    <span className="text-red text-[10px]">−{activeDiff.deletions}</span>
                    <CopyButton text={activeDiff.hunks} label="copy" />
                  </div>
                </div>
                <pre className="max-h-96 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-fg-muted">
                  {activeDiff.hunks}
                </pre>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Merge conflict detection"
            subtitle="Checks current branch vs target using git merge-tree"
            right={<Badge tone={conflicts.length > 0 ? "red" : "green"}>{conflicts.length > 0 ? `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""}` : "clean"}</Badge>}
          />
          <div className="p-4">
            <div className="mb-3 flex gap-2">
              <select
                className="h-8 flex-1 rounded-md border border-border-strong bg-bg px-2 text-xs text-fg cursor-pointer"
                value={conflictTarget}
                onChange={(e) => setConflictTarget(e.target.value)}
              >
                <option value="">auto (other branch)</option>
                {(data.branches ?? []).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <Button onClick={scanConflicts} disabled={busy}>
                {busy ? <Spinner /> : null}
                Scan
              </Button>
            </div>

            {conflictScanned && (
              <div className="mb-3 text-[11px] text-fg-dim">
                <span className="font-mono">{conflictScanned.current}</span>
                <span className="mx-1 text-fg-dim">→</span>
                <span className="font-mono">{conflictScanned.target}</span>
              </div>
            )}

            {conflicts.length > 0 ? (
              <div className="rounded-lg border border-red/30 bg-red-soft p-3">
                <div className="mb-2 text-[11px] font-medium text-red">Files that will conflict</div>
                <ul className="flex flex-col gap-1">
                  {conflicts.map((c) => (
                    <li key={c.fileName} className="flex items-center gap-2 font-mono text-[11px] text-red/90">
                      <span className="size-1.5 rounded-full bg-red" />
                      {c.fileName}
                    </li>
                  ))}
                </ul>
              </div>
            ) : conflictScanned ? (
              <div className="rounded-lg border border-green/25 bg-green-soft px-3 py-2 text-[11px] text-green">
                No conflicts detected between these branches.
              </div>
            ) : (
              <Empty title="Not scanned yet" hint="Run a scan to predict merge conflicts before you merge." />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent commits" subtitle={`${(data.commits ?? []).length} in view`} />
        <div className="p-2">
          <div className="flex flex-col">
            {(data.commits ?? []).map((c, i) => (
              <div
                key={c.sha}
                className="flex items-center gap-3 rounded-md border border-transparent px-2.5 py-1.5 hover:border-border hover:bg-bg-subtle/50 transition-colors"
              >
                <div className="flex flex-col items-center">
                  <span className={i === 0 ? "size-2 rounded-full bg-accent" : "size-2 rounded-full bg-fg-dim"} />
                  {i < (data.commits ?? []).length - 1 && <span className="mt-0.5 w-px flex-1 bg-border" />}
                </div>
                <span className="font-mono text-[10px] text-fg-dim">{c.shortSha}</span>
                <span className="flex-1 truncate text-[12px] text-fg-muted">{c.message}</span>
                <span className="hidden text-[10px] text-fg-dim sm:inline">{c.author}</span>
                <span className="shrink-0 text-[10px] text-fg-dim">{timeAgo(c.dateTs)}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}