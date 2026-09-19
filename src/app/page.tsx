"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Dot, Empty, Field, Input, Badge, Spinner } from "@/components/ui";
import { fmtDate, gitRemoteDisplay, shortenPath } from "@/lib/utils";

type Project = {
  id: string;
  name: string;
  repo_path: string;
  github_repo: string | null;
  created_at: number;
};

type GitMeta = Record<string, { branch?: string; remote?: string | null; dirty?: boolean }>;

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [gitMeta, setGitMeta] = useState<GitMeta>({});
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("~/");
  const [githubRepo, setGithubRepo] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [githubConfigured, setGithubConfigured] = useState(false);

  async function load() {
    const res = await fetch("/api/projects");
    const data = await res.json();
    setProjects(data.projects ?? []);
    setPhase("ready");
    const metas: GitMeta = {};
    for (const p of data.projects ?? []) {
      const g = await fetch(`/api/projects/${p.id}/git`).then((r) => r.json()).catch(() => null);
      if (g?.repoInfo) {
        metas[p.id] = { branch: g.current, remote: g.repoInfo?.remote, dirty: g.repoInfo?.dirty };
      }
    }
    setGitMeta(metas);
  }

  useEffect(() => {
    load();
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setGithubConfigured(d.githubConfigured ?? false))
      .catch(() => undefined);
  }, []);

  async function create() {
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          repo_path: repoPath,
          github_repo: githubRepo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "failed to create project");
        return;
      }
      setName("");
      setRepoPath("~/");
      setGithubRepo("");
      setShowCreate(false);
      await load();
    } catch {
      setError("request failed");
    } finally {
      setCreating(false);
    }
  }

  async function remove(p: Project) {
    if (!confirm(`Delete project "${p.name}"? Git repo is untouched.`)) return;
    await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    await load();
  }

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((d) => setGithubConfigured(d.githubConfigured)).catch(() => undefined);
  }, []);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg border border-accent/40 bg-accent-soft">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c8cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </div>
<div>
            <h1 className="text-lg font-semibold tracking-tight text-fg">GridMind</h1>
            <p className="text-[11px] text-fg-dim">local AI coding-agent control plane</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={githubConfigured ? "green" : "amber"}>
            {githubConfigured ? "GitHub connected" : "GitHub: no GITHUB_TOKEN"}
          </Badge>
          <Button onClick={() => setShowCreate((v) => !v)} variant="default" size="md">
            {showCreate ? "Close" : "＋ New project"}
          </Button>
        </div>
      </header>

        {showCreate && (
          <Card className="mb-8">
            <div className="p-5">
              <h2 className="mb-4 text-[13px] font-semibold text-fg">Connect a Git repository</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="Project name">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="acme-web"
                    autoFocus
                  />
                </Field>
                <Field label="Local repo path">
                  <Input
                    value={repoPath}
                    onChange={(e) => setRepoPath(e.target.value)}
                    placeholder="~/code/acme-web"
                    className="font-mono"
                  />
                </Field>
                <Field label={"GitHub repo (optional)"}>
                  <Input
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="owner/repo"
                    className="font-mono"
                  />
                </Field>
              </div>
              {error && (
                <p className="mt-3 rounded-md bg-red-soft px-3 py-2 text-xs text-red border border-red/30">{error}</p>
              )}
              <div className="mt-4 flex items-center gap-2">
                <Button onClick={create} disabled={creating || !name || !repoPath}>
                  {creating ? <Spinner /> : null}
                  {creating ? "Connecting…" : "Create project"}
                </Button>
                <span className="text-[11px] text-fg-dim">
                  Context, tasks, sessions and events stay isolated per project.
                </span>
              </div>
            </div>
          </Card>
        )}

        {phase === "loading" ? (
          <div className="flex justify-center py-20">
            <Spinner className="size-5" />
          </div>
        ) : projects.length === 0 && !showCreate ? (
          <Card>
            <Empty
              title="No projects yet"
              hint="Point GridMind at a local Git repository to get started. You can drive OpenCode and Codex agents on it, track tasks, inspect diffs, and open PRs."
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {projects.map((p) => {
              const meta = gitMeta[p.id];
              return (
                <Card key={p.id} className="transition-colors duration-150 hover:border-border-strong">
                  <div className="flex items-center gap-4 px-4 py-3.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-subtle border border-border">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b93a7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 21c-1 0-3-1-3-4v-5H7l-2 3-4-3 4-3 2 3h8v6c0 2 1 3 3 3" />
                        <path d="M15 8h7l-2-3 2-3h-7a3 3 0 000 6z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/projects/${p.id}`} className="truncate text-sm font-medium text-fg hover:text-accent transition-colors">
                          {p.name}
                        </Link>
                        {meta?.dirty && <Badge tone="amber">dirty</Badge>}
                        {p.github_repo && <Badge tone="purple">gh: {p.github_repo}</Badge>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-dim">
                        <span className="font-mono truncate">{shortenPath(p.repo_path)}</span>
                        <span className="text-fg-dim">·</span>
                        <span className="text-fg-dim">{fmtDate(p.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <div className="hidden items-center gap-3 md:flex">
                        {meta && (
                          <>
                            <div className="flex items-center gap-1.5">
                              <Dot tone="accent" />
                              <span className="font-mono text-[11px] text-fg-muted">{meta.branch || "—"}</span>
                            </div>
                            <span className="font-mono text-[11px] text-fg-dim">
                              {gitRemoteDisplay(meta.remote ?? null)}
                            </span>
                          </>
                        )}
                      </div>
                      <Link href={`/projects/${p.id}`}>
                        <Button variant="outline">Open</Button>
                      </Link>
                      <Button variant="ghost" onClick={() => remove(p)} className="text-fg-dim hover:text-red">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}