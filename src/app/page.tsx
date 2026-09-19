"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Spinner } from "@/components/ui";
import { extractRepoName } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-provider";
import { animatePageEntrance } from "@/lib/animations";

type Project = {
  id: string;
  name: string;
  repo_path: string;
  github_repo: string | null;
  created_at: number;
};

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) return;
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (containerRef.current) animatePageEntrance(containerRef.current);
  }, []);

  async function create() {
    if (!name.trim() || !repoPath.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          repo_path: repoPath.trim(),
          github_repo: githubRepo.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to create project");
        return;
      }
      setName("");
      setRepoPath("");
      setGithubRepo("");
      setShowCreate(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main ref={containerRef} className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-6 py-16">
        {/* Header */}
        <div className="mb-10 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg">GridMind</h1>
            <p className="mt-1 text-[13px] text-fg-dim">
              Agent coordination & control plane for local Git projects.
            </p>
          </div>
          <ThemeToggle />
        </div>

        {/* Create project */}
        <div className="mb-6">
          <Button onClick={() => setShowCreate((v) => !v)} variant={showCreate ? "ghost" : "default"}>
            {showCreate ? "Cancel" : "New project"}
          </Button>
        </div>

        {showCreate && (
          <Card className="mb-6">
            <CardHeader title="Create Project" subtitle="Link to a local Git repository" />
            <div className="flex flex-col gap-4 p-4">
              <Field label="Project name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" autoFocus />
              </Field>
              <Field label="Repository path (absolute)">
                <Input value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="/Users/me/projects/my-app" className="font-mono" />
              </Field>
              <Field label="GitHub repo (optional)">
                <Input value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} placeholder="owner/repo" className="font-mono" />
              </Field>
              {error && (
                <div className="rounded-md border border-red/30 bg-red-soft px-3 py-2 text-[11px] text-red">
                  {error}
                </div>
              )}
              <Button onClick={create} disabled={busy || !name.trim() || !repoPath.trim()}>
                {busy ? <Spinner /> : null}
                Create project
              </Button>
            </div>
          </Card>
        )}

        {/* Project list */}
        {projects.length === 0 && !showCreate ? (
          <Empty
            title="No projects yet"
            hint="Create a project to link GridMind to your local Git repository and start coordinating agents."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="group block">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated px-4 py-3 transition-all duration-100 hover:border-border-strong hover:bg-bg-subtle/60">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-fg group-hover:text-fg tracking-tight">{p.name}</span>
                      {p.github_repo && <Badge tone="dim">{p.github_repo}</Badge>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-dim">
                      <span className="font-mono truncate">{extractRepoName(p.repo_path)}</span>
                      <span>·</span>
                      <span className="font-mono">{p.repo_path}</span>
                    </div>
                  </div>
                  <span className="shrink-0 text-fg-dim group-hover:text-fg transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
