"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { GithubMark, integrationRequest, type GithubConnection } from "@/components/github-connect";

type Issue = { number: number; title: string; url: string; labels: string[] };
type Repository = { fullName: string; description: string | null; private: boolean; defaultBranch: string; url: string };

export function GithubPanel({ projectId }: { projectId: string; refreshKey: number }) {
  const router = useRouter();
  const [connection, setConnection] = useState<GithubConnection | null>(null);
  const [repository, setRepository] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [repoResultsReady, setRepoResultsReady] = useState(false);
  const [repositoriesTruncated, setRepositoriesTruncated] = useState(false);
  const [manualRepo, setManualRepo] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prHead, setPrHead] = useState("");
  const [prBase, setPrBase] = useState("main");
  const [prBody, setPrBody] = useState("");
  const [pushBranch, setPushBranch] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createdPr, setCreatedPr] = useState<{ number: number; url: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setIssues([]);
    try {
      const [project, git, account] = await Promise.all([
        integrationRequest<{ project: { github_repo: string | null } }>(`/api/projects/${projectId}`),
        integrationRequest<{ branches: string[]; current: string }>(`/api/projects/${projectId}/git`),
        integrationRequest<GithubConnection>("/api/integrations/github"),
      ]);
      setConnection(account); setRepository(project.project.github_repo);
      setBranches(git.branches); setPrHead((head) => head || git.current || git.branches[0] || "");
      if (account.connected && project.project.github_repo) {
        const result = await integrationRequest<{ issues: Issue[] }>(`/api/projects/${projectId}/issues`);
        setIssues(result.issues);
      } else setIssues([]);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function findRepositories(event?: React.FormEvent) {
    event?.preventDefault(); setSearching(true); setError(null);
    try {
      const result = await integrationRequest<{ repositories: Repository[]; truncated: boolean }>(`/api/integrations/github/repositories?q=${encodeURIComponent(repoSearch)}`);
      setRepositories(result.repositories); setRepoResultsReady(true); setRepositoriesTruncated(result.truncated);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSearching(false); }
  }
  async function selectRepository(value: string, defaultBranch?: string) {
    setBusy("repository"); setError(null); setMessage(null);
    try {
      await integrationRequest(`/api/projects/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ github_repo: value.trim() }) });
      if (defaultBranch) setPrBase(defaultBranch);
      setRepository(value); setShowPicker(false); setMessage(`Linked ${value} to this project.`); await load(); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  }
  async function importIssue(number: number) {
    setBusy(`issue-${number}`); setError(null); setMessage(null);
    try {
      await integrationRequest(`/api/projects/${projectId}/issues`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issue_number: number }) });
      setMessage(`Issue #${number} is now a task. Open Tasks to assign it to an agent.`);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  }
  async function createPr(event: React.FormEvent) {
    event.preventDefault(); setBusy("pr"); setError(null); setMessage(null); setCreatedPr(null);
    try {
      const result = await integrationRequest<{ pr: { number: number; url: string } }>(`/api/projects/${projectId}/pr`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: prTitle, head: prHead, base: prBase, body: prBody, push: pushBranch }),
      });
      setCreatedPr(result.pr); setPrTitle(""); setPrBody("");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  }
  const ready = !!connection?.connected && !!repository;
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
    <section className="rounded-xl border border-border bg-bg-elevated p-5 sm:p-7" aria-labelledby="project-github-title">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><GithubMark /><div><h2 id="project-github-title" className="text-xl font-semibold tracking-tight">GitHub for this project</h2><p className="mt-1 text-sm text-fg-muted">Connect a repository, bring in issues, and deliver changes.</p></div></div><Badge tone={ready ? "green" : "dim"}>{loading ? "Checking" : ready ? "Ready" : "Setup needed"}</Badge></div>
      {loading ? <div className="mt-5 flex items-center gap-2 text-sm text-fg-muted"><Spinner /> Loading connection and repository…</div> : <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div><p className="text-xs font-medium text-fg-dim">1. GitHub account</p><p className="mt-2 text-sm font-medium">{connection?.connected ? connection.account?.login || "Server connection" : "Connect your account"}</p><Link href="/integrations" className="mt-2 inline-block text-sm underline underline-offset-4">{connection?.connected ? "Manage connection" : "Connect GitHub"} ↗</Link></div>
        <div><p className="text-xs font-medium text-fg-dim">2. Project repository</p><p className="mt-2 break-all text-sm font-medium">{repository || "Choose a repository"}</p><Button variant="outline" className="mt-3" size="md" disabled={!connection?.connected || !!busy} onClick={() => { setShowPicker((v) => !v); if (!repoResultsReady) void findRepositories(); }}>{repository ? "Change repository" : "Choose repository"}</Button></div>
      </div>}
      {showPicker && <div className="mt-6 border-t border-border pt-5">
        <form onSubmit={findRepositories} className="flex gap-2"><Input aria-label="Search accessible repositories" value={repoSearch} onChange={(e) => setRepoSearch(e.target.value)} placeholder="Filter recently updated repositories" className="!h-10 !text-sm" /><Button size="md" type="submit" disabled={searching}>{searching ? <Spinner /> : "Search"}</Button></form>
        {searching && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-fg-muted"><Spinner /> Loading repositories…</p>}
        {repositoriesTruncated && <p className="mt-3 text-xs leading-5 text-fg-muted">Showing the first 100 recently updated accessible repositories. Enter owner/repository below if yours is not listed.</p>}
        <div className="mt-3 max-h-72 overflow-y-auto" aria-live="polite">{repositories.map((repo) => <button key={repo.fullName} disabled={!!busy} onClick={() => void selectRepository(repo.fullName, repo.defaultBranch)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left hover:bg-bg-subtle disabled:opacity-50"><span className="min-w-0"><span className="block break-all text-sm font-medium">{repo.fullName}</span>{repo.description && <span className="mt-1 block text-xs text-fg-muted">{repo.description}</span>}</span><Badge>{repo.private ? "Private" : "Public"}</Badge></button>)}{repoResultsReady && !repositories.length && <p className="py-5 text-sm text-fg-muted">No matching repositories. Check your token’s repository access or enter the repository below.</p>}</div>
        <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); void selectRepository(manualRepo); }}><Field label="Or enter owner/repository"><Input value={manualRepo} onChange={(e) => setManualRepo(e.target.value)} placeholder="owner/repository" required /></Field><Button type="submit" variant="outline" size="md" disabled={!!busy || !manualRepo.trim()}>Link repository</Button></form>
      </div>}
    </section>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red/25 bg-red-soft p-4 text-sm text-red"><span>{error}</span><Button variant="outline" onClick={() => void load()}>Retry</Button></div>}
    {message && <p role="status" className="rounded-lg border border-green/25 bg-green-soft p-4 text-sm text-green">{message}</p>}
    {createdPr && <p role="status" className="rounded-lg border border-green/25 bg-green-soft p-4 text-sm text-green">Pull request #{createdPr.number} created. <a href={createdPr.url} target="_blank" rel="noreferrer" className="underline">View on GitHub ↗</a></p>}
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <section className="rounded-xl border border-border bg-bg-elevated" aria-labelledby="github-issues-heading">
        <div className="flex items-center justify-between gap-3 border-b border-border p-5"><div><h3 id="github-issues-heading" className="text-base font-semibold">Issues to work on</h3><p className="mt-1 text-sm text-fg-muted">Turn an open issue into a project task.</p></div><Button variant="ghost" disabled={!ready || loading} onClick={() => void load()}>Refresh</Button></div>
        {issues.length ? <ul className="divide-y divide-border px-5">{issues.map((issue) => <li key={issue.number} className="py-4"><a href={issue.url} target="_blank" rel="noreferrer" className="text-sm font-medium leading-6 hover:underline"><span className="mr-2 font-mono text-fg-muted">#{issue.number}</span>{issue.title} ↗</a>{issue.labels.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{issue.labels.map((label) => <Badge key={label}>{label}</Badge>)}</div>}<Button variant="outline" size="md" className="mt-3" disabled={!!busy} onClick={() => void importIssue(issue.number)}>{busy === `issue-${issue.number}` ? "Importing…" : "Create task from issue"}</Button></li>)}</ul> : <div className="p-6"><p className="text-sm font-medium">{loading ? "Loading issues…" : ready ? "No open issues returned" : "Your issues will appear here"}</p><p className="mt-2 text-sm leading-6 text-fg-muted">{ready ? "Showing up to 30 open issues. Pull requests are listed on GitHub separately." : "Connect GitHub and choose a repository above to get started."}</p></div>}
      </section>
      <section className="rounded-xl border border-border bg-bg-elevated p-5 sm:p-6" aria-labelledby="github-pr-heading"><h3 id="github-pr-heading" className="text-base font-semibold">Open a pull request</h3><p className="mt-2 text-sm leading-6 text-fg-muted">Review the branches and describe your changes before publishing.</p>
        <form onSubmit={createPr} className="mt-5 flex flex-col gap-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Your branch"><Select value={prHead} onChange={(e) => setPrHead(e.target.value)} disabled={!ready}>{!branches.length && <option value="">No local branches</option>}{branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</Select></Field><Field label="Merge into"><Input value={prBase} onChange={(e) => setPrBase(e.target.value)} required disabled={!ready} placeholder="main" /></Field></div><Field label="Pull request title"><Input value={prTitle} onChange={(e) => setPrTitle(e.target.value)} required disabled={!ready} placeholder="What does this change do?" /></Field><Field label="Description"><Textarea rows={4} value={prBody} onChange={(e) => setPrBody(e.target.value)} disabled={!ready} placeholder="Summarize the changes and how you checked them." /></Field><label className="flex items-start gap-2 text-sm leading-6 text-fg-muted"><input type="checkbox" className="mt-1" checked={pushBranch} onChange={(e) => setPushBranch(e.target.checked)} disabled={!ready} /><span>Push this branch before creating the pull request. Uses your local Git credentials.</span></label><Button type="submit" size="md" className="self-start !h-10 !px-4 !text-sm" disabled={!ready || !!busy || !prTitle.trim() || !prHead || !prBase.trim()}>{busy === "pr" && <Spinner />}{busy === "pr" ? "Creating pull request…" : "Create pull request"}</Button>{!ready && <p className="text-xs text-fg-muted">Finish the two setup steps above to enable this form.</p>}</form>
      </section>
    </div>
  </div>;
}
