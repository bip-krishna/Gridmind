"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Badge, Button, Card, Field, Input, Spinner } from "@/components/ui";
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
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    try {
      const response = await fetch("/api/projects", { signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your projects could not be loaded.");
      if (!Array.isArray(data.projects)) throw new Error("The project list could not be read. Try again.");
      setProjects(data.projects);
      setLoadError(null);
    } catch (error) {
      if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : "Your projects could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (containerRef.current) animatePageEntrance(containerRef.current);
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !repoPath.trim() || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), repo_path: repoPath.trim(), github_repo: githubRepo.trim() || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your project could not be added.");
      setName("");
      setRepoPath("");
      setGithubRepo("");
      setShowCreate(false);
      setQuery("");
      await load();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Your project could not be added. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const visibleProjects = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return projects.filter((project) => !search || [project.name, project.repo_path, project.github_repo || ""].some((value) => value.toLocaleLowerCase().includes(search)));
  }, [projects, query]);

  function toggleCreate() {
    setShowCreate((visible) => !visible);
    setFormError(null);
  }

  return (
    <main ref={containerRef} className="min-h-screen bg-bg text-fg">
      <a href="#projects" className="skip-link">Skip to projects</a>
      <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8 sm:py-9">
        <header className="flex items-center justify-between gap-4 border-b border-border pb-6">
          <Link href="/" className="flex items-center gap-3" aria-label="Gridmind home">
            <span className="flex size-9 items-center justify-center rounded-lg border border-border-strong bg-bg-elevated" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="7" height="7" rx="1.2" /><rect x="14" y="3" width="7" height="7" rx="1.2" /><rect x="3" y="14" width="7" height="7" rx="1.2" /><rect x="14" y="14" width="7" height="7" rx="1.2" /></svg>
            </span>
            <span className="text-base font-semibold tracking-tight">Gridmind</span>
          </Link>
          <nav className="flex items-center gap-3 sm:gap-5" aria-label="Workspace navigation">
            <Link href="/integrations" className="text-sm font-medium text-fg-muted transition-colors hover:text-fg">Apps & integrations</Link>
            <ThemeToggle />
          </nav>
        </header>

        <section className="flex flex-col items-start justify-between gap-6 pb-9 pt-11 sm:flex-row sm:items-end sm:pt-14" aria-labelledby="workspace-title">
          <div>
            <p className="mb-3 text-xs font-medium text-fg-dim">Your workspace</p>
            <h1 id="workspace-title" className="max-w-xl text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">Pick up where your agents left off.</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-fg-muted sm:text-base">Keep project knowledge, tasks, and connected tools together. Choose a repository to continue.</p>
          </div>
          <Button onClick={toggleCreate} variant={showCreate ? "outline" : "default"} className="!h-11 !px-4 !text-sm" aria-expanded={showCreate} aria-controls="new-project-form">
            {showCreate ? "Close form" : <><span aria-hidden="true">+</span> Add project</>}
          </Button>
        </section>

        {showCreate && (
          <Card className="mb-9">
            <form id="new-project-form" onSubmit={create} className="p-5 sm:p-7">
              <div className="mb-6">
                <h2 className="text-lg font-semibold tracking-tight">Add a project</h2>
                <p className="mt-1 text-sm leading-6 text-fg-muted">Choose an existing Git repository on this computer. Your files stay where they are.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Project name">
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Customer portal" autoFocus required disabled={busy} className="!h-11 !text-sm" />
                </Field>
                <Field label="Local repository folder">
                  <Input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} placeholder="/Users/you/projects/customer-portal" required disabled={busy} className="!h-11 !text-sm" aria-describedby="repository-folder-help" />
                </Field>
              </div>
              <p id="repository-folder-help" className="mt-3 text-xs leading-5 text-fg-dim">Use the full folder path. The folder must already contain a Git repository.</p>
              <details className="mt-5 rounded-md border border-border px-4 py-3 text-sm text-fg-muted">
                <summary className="cursor-pointer font-medium text-fg">Link a GitHub repository <span className="font-normal text-fg-dim">(optional)</span></summary>
                <div className="mt-4 max-w-md">
                  <Field label="GitHub repository">
                    <Input value={githubRepo} onChange={(event) => setGithubRepo(event.target.value)} placeholder="owner/repository" disabled={busy} className="!h-10 !text-sm" />
                  </Field>
                  <p className="mt-2 text-xs leading-5">You can connect your GitHub account and choose a repository later from Apps & integrations.</p>
                </div>
              </details>
              {formError && <div role="alert" className="mt-5 rounded-md border border-red/25 bg-red-soft px-4 py-3 text-sm text-red">{formError}</div>}
              <div className="mt-6 flex items-center gap-3">
                <Button type="submit" disabled={busy || !name.trim() || !repoPath.trim()} className="!h-10 !px-4 !text-sm">{busy && <Spinner />}{busy ? "Adding project…" : "Add project"}</Button>
                <Button type="button" variant="ghost" onClick={toggleCreate} disabled={busy} className="!h-10 !text-sm">Cancel</Button>
              </div>
            </form>
          </Card>
        )}

        <section id="projects" aria-labelledby="project-list-title">
          <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <h2 id="project-list-title" className="text-base font-semibold tracking-tight">Projects {!loading && <span className="ml-2 text-sm font-normal tabular-nums text-fg-dim">{projects.length}</span>}</h2>
            {projects.length > 0 && <div className="relative w-full sm:w-72"><svg aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-fg-dim" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><Input aria-label="Search projects" placeholder="Search projects…" value={query} onChange={(event) => setQuery(event.target.value)} className="!h-10 !pl-9 !text-sm" /></div>}
          </div>
          {loadError && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red/25 bg-red-soft px-4 py-3 text-sm text-red"><span>{loadError}</span><button className="font-medium underline underline-offset-4" onClick={() => void load()}>Try again</button></div>}
          {loading && projects.length === 0 ? (
            <div aria-label="Loading projects" aria-busy="true" className="divide-y divide-border rounded-lg border border-border bg-bg-elevated">{[1, 2, 3].map((item) => <div key={item} className="space-y-3 p-5"><div className="h-4 w-40 animate-pulse rounded bg-bg-inset" /><div className="h-3 w-2/3 animate-pulse rounded bg-bg-inset" /></div>)}</div>
          ) : projects.length === 0 && !loadError ? (
            <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 sm:px-9">
              <h3 className="text-lg font-semibold tracking-tight">Start with a project you’re working on.</h3>
              <p className="mt-2 max-w-lg text-sm leading-6 text-fg-muted">Add its local folder to see shared memory, coordinate work, and bring GitHub issues into your task list.</p>
              <Button onClick={() => setShowCreate(true)} className="mt-6 !h-10 !px-4 !text-sm">Add your first project</Button>
            </div>
          ) : visibleProjects.length === 0 && !loading ? (
            <div className="rounded-lg border border-border px-6 py-10 text-center"><h3 className="font-medium">No projects match “{query}”</h3><button onClick={() => setQuery("")} className="mt-3 text-sm text-fg-muted underline underline-offset-4">Clear search</button></div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-elevated">
              {visibleProjects.map((project) => <Link key={project.id} href={`/projects/${project.id}`} className="group flex items-center justify-between gap-4 px-5 py-5 transition-colors hover:bg-bg-subtle sm:px-6">
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2.5"><h3 className="truncate text-base font-semibold tracking-tight">{project.name}</h3>{project.github_repo && <Badge tone="dim" className="!text-xs">{project.github_repo}</Badge>}</div><p className="mt-2 truncate text-xs leading-5 text-fg-dim sm:text-sm" title={project.repo_path}>{project.repo_path}</p></div>
                <span className="flex shrink-0 items-center gap-2 text-sm text-fg-muted group-hover:text-fg"><span className="hidden sm:inline">Open project</span><span aria-hidden="true">→</span></span>
              </Link>)}
            </div>
          )}
        </section>

        <aside className="mt-10 flex flex-col justify-between gap-4 border-t border-border pt-6 sm:flex-row sm:items-center" aria-label="Connected tools">
          <div><h2 className="text-sm font-medium">Bring your tools into the workspace</h2><p className="mt-1 text-sm leading-6 text-fg-dim">Connect GitHub to choose repositories and work with issues.</p></div>
          <Link href="/integrations" className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg">Explore apps & integrations <span aria-hidden="true">→</span></Link>
        </aside>
      </div>
    </main>
  );
}
