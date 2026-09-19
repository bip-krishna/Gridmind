"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Textarea } from "@/components/ui";

type Issue = {
  number: number;
  title: string;
  state: string;
  url: string;
  labels: string[];
  createdAt: string;
};

type Branch = string;

export function GithubPanel({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [state, setState] = useState<{ issues: Issue[]; configured: boolean; githubRepo: string | null; error?: string }>({
    issues: [],
    configured: false,
    githubRepo: null,
  });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [prTitle, setPrTitle] = useState("");
  const [prHead, setPrHead] = useState("");
  const [prBody, setPrBody] = useState("");
  const [pushBranches, setPushBranches] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [gh, git] = await Promise.all([
      fetch(`/api/projects/${projectId}/issues`).then((r) => r.json()).catch(() => ({ configured: false, issues: [] })),
      fetch(`/api/projects/${projectId}/git`).then((r) => r.json()).catch(() => ({})),
    ]);
    setState(gh);
    setBranches(git.branches ?? []);
    setPrHead((p) => p || git.current || "");
  }

  useEffect(() => {
    load();
  }, [projectId, refreshKey]);

  async function importIssue(number: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_number: number }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error ?? "import failed");
      else setMessage(`Imported #${number} as a task.`);
    } finally {
      setBusy(false);
    }
  }

  async function createPr() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/pr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: prTitle, head: prHead, body: prBody, push: pushBranches }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error ?? "PR creation failed");
      else {
        setMessage(`PR #${d.pr.number} opened → ${d.pr.url}`);
        setPrTitle("");
        setPrBody("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="GitHub integration"
          subtitle={
            state.configured
              ? `linked to ${state.githubRepo ?? "repo"}`
              : "not configured — set GITHUB_TOKEN (and project github_repo) to enable"
          }
          right={
            !state.configured && <Badge tone="amber">needs GITHUB_TOKEN</Badge>
          }
        />
        <div className="p-4">
          <p className="mb-3 text-[11px] leading-relaxed text-fg-dim">
            Import open issues as GridMind tasks, then open a PR for the current branch. Enable{" "}
            <code className="font-mono text-fg-muted">GITHUB_TOKEN</code> in the environment and set the repo as{" "}
            <code className="font-mono text-fg-muted">owner/repo</code>.
          </p>
          <div className="rounded-md border border-border-strong bg-bg-subtle px-3 py-2 font-mono text-[11px] text-fg-muted">
            {state.githubRepo ?? "no owner/repo set on this project"}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Open issues" subtitle={`${state.issues.length} open`} />
          <div className="p-2">
            {state.issues.length === 0 ? (
              <Empty
                title={state.configured ? "No open issues" : "Issues will appear here"}
                hint={state.configured ? "Every open issue on this repo is listed." : "Configure GitHub to fetch issues."}
              />
            ) : (
              <div className="flex flex-col">
                {state.issues.map((i) => (
                  <div key={i.number} className="flex items-start gap-3 rounded-lg border border-transparent px-2.5 py-2 hover:border-border hover:bg-bg-subtle/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge tone="amber">#{i.number}</Badge>
                        <span className="truncate text-[12px] font-medium text-fg">{i.title}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {i.labels.map((l) => (
                          <span key={l} className="rounded bg-bg-subtle px-1.5 py-0.5 text-[9px] text-fg-muted border border-border">
                            {l}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button variant="outline" size="xs" onClick={() => importIssue(i.number)} disabled={busy}>
                      → task
                    </Button>
                    <a href={i.url} target="_blank" rel="noreferrer" className="mt-1 text-fg-dim hover:text-fg">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                      </svg>
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="One-click PR" subtitle="From the selected branch" />
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Head branch">
                <select
                  className="h-8 w-full rounded-md border border-border-strong bg-bg px-2 text-xs text-fg cursor-pointer"
                  value={prHead}
                  onChange={(e) => setPrHead(e.target.value)}
                >
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Base branch">
                <select className="h-8 w-full rounded-md border border-border-strong bg-bg px-2 text-xs text-fg cursor-pointer">
                  <option>main</option>
                  <option>master</option>
                </select>
              </Field>
            </div>
            <div className="mt-4">
              <Field label="PR title">
                <Input value={prTitle} onChange={(e) => setPrTitle(e.target.value)} placeholder={`PR for ${prHead}…`} />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Description">
                <Textarea rows={3} value={prBody} onChange={(e) => setPrBody(e.target.value)} placeholder="Summary of changes, test plan…" />
              </Field>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-fg-muted">
                <input
                  type="checkbox"
                  checked={pushBranches}
                  onChange={(e) => setPushBranches(e.target.checked)}
                  className="accent-[#7c8cf8]"
                />
                Push branch first (git push -u origin {prHead})
              </label>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button onClick={createPr} disabled={busy || !prTitle.trim()}>
                {busy ? "Creating…" : "Create pull request"}
              </Button>
            </div>
            {message && <div className="mt-3 rounded-md border border-green/25 bg-green-soft px-3 py-2 text-[11px] text-green">{message}</div>}
            {error && <div className="mt-3 rounded-md border border-red/30 bg-red-soft px-3 py-2 text-[11px] text-red">{error}</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}