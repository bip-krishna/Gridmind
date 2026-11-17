"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, Spinner } from "./ui";

export type GithubConnection = {
  connected: boolean;
  source: "saved" | "environment" | null;
  account: { login: string; avatarUrl: string; profileUrl: string } | null;
  deviceFlowAvailable: boolean;
  error?: string;
};
type DeviceFlow = { flowId: string; userCode: string; verificationUri: string; expiresAt: number; interval: number };

export async function integrationRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

export function GithubMark({ className = "size-7" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.94.1-.73.4-1.22.72-1.5-2.5-.29-5.13-1.25-5.13-5.54 0-1.22.44-2.22 1.15-3-.11-.28-.5-1.42.11-2.96 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.61 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.22 2.68.11 2.96.72.78 1.15 1.78 1.15 3.01 0 4.3-2.64 5.25-5.15 5.53.4.35.76 1.04.76 2.09v3.18c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z" /></svg>;
}

export function GithubConnect() {
  const [connection, setConnection] = useState<GithubConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const status = await integrationRequest<GithubConnection>("/api/integrations/github"); setConnection(status); setError(status.error || null); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!flow) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await integrationRequest<GithubConnection & { status: string; interval?: number }>("/api/integrations/github/device/poll", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flowId: flow!.flowId }),
        });
        if (cancelled) return;
        if (result.status === "connected") {
          setFlow(null); setMessage("GitHub is connected. Choose a repository in your project."); void load();
        } else timer = setTimeout(poll, Math.max(1, result.interval || flow!.interval) * 1000);
      } catch (err) {
        if (!cancelled) { setFlow(null); setError(err instanceof Error ? err.message : String(err)); }
      }
    }
    timer = setTimeout(poll, Math.max(1, flow.interval) * 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [flow, load]);

  async function connectToken(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setMessage(null);
    try {
      setConnection(await integrationRequest<GithubConnection>("/api/integrations/github", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      }));
      setToken(""); setShowToken(false); setMessage("GitHub is connected. Choose a repository in your project.");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function startDevice() {
    setBusy(true); setError(null); setMessage(null);
    try { setFlow(await integrationRequest<DeviceFlow>("/api/integrations/github/device", { method: "POST" })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError(null);
    try {
      setConnection(await integrationRequest<GithubConnection>("/api/integrations/github", { method: "DELETE" }));
      setConfirmDisconnect(false); setMessage("The saved connection was removed from this Gridmind installation.");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function cancelFlow() {
    setFlow(null);
    try { await integrationRequest("/api/integrations/github/device", { method: "DELETE" }); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  return <section aria-labelledby="github-connection-heading" className="overflow-hidden rounded-xl border border-border bg-bg-elevated">
    <div className="flex flex-wrap items-start justify-between gap-5 border-b border-border p-6 sm:p-8">
      <div className="flex items-center gap-4"><div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-border bg-bg"><GithubMark /></div>
        <div><h2 id="github-connection-heading" className="text-xl font-semibold tracking-tight">GitHub</h2><p className="mt-1 text-sm text-fg-muted">Bring repository work into your project.</p></div>
      </div>
      <Badge tone={connection?.connected ? "green" : "dim"}>{loading ? "Checking connection" : connection?.connected ? "Connected" : "Not connected"}</Badge>
    </div>
    <div className="p-6 sm:p-8">
      <p className="max-w-2xl text-sm leading-6 text-fg-muted">Connect once to browse accessible repositories, turn issues into tasks, and create pull requests when your work is ready.</p>
      {loading ? <div className="mt-6 flex items-center gap-2 text-sm text-fg-muted"><Spinner /> Checking GitHub…</div> : connection?.connected ? <div className="mt-6 rounded-lg bg-bg-subtle p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-sm font-medium">{connection.account ? `Connected as ${connection.account.login}` : "Connected through server configuration"}</p>
            <p className="mt-1 text-sm leading-6 text-fg-muted">{connection.source === "environment" ? "This connection is managed by the server’s GITHUB_TOKEN setting." : "Your credential is encrypted on this machine. It is never sent back to the browser."}</p></div>
          {connection.source === "saved" && <Button variant="outline" size="md" onClick={() => setConfirmDisconnect(true)} disabled={busy}>Disconnect</Button>}
        </div>
        {confirmDisconnect && <div className="mt-4 border-t border-border pt-4"><p className="mb-3 text-sm">Disconnect GitHub from this installation? Your projects and tasks stay saved. This does not revoke the token on GitHub.</p><div className="flex gap-2"><Button variant="danger" size="md" disabled={busy} onClick={disconnect}>Disconnect GitHub</Button><Button variant="ghost" size="md" onClick={() => setConfirmDisconnect(false)}>Keep connected</Button></div></div>}
      </div> : <>
        {!flow && <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button size="md" className="!h-10 !px-4 !text-sm" disabled={busy || !connection} onClick={connection?.deviceFlowAvailable ? startDevice : () => setShowToken(true)}>{busy && <Spinner />}Connect GitHub</Button>
          {connection?.deviceFlowAvailable && <Button variant="ghost" size="md" onClick={() => setShowToken((value) => !value)}>Use an access token instead</Button>}
        </div>}
        {flow && <div className="mt-6 rounded-lg border border-border bg-bg-subtle p-5">
          <p className="font-medium">Finish connecting on GitHub</p><p className="mt-2 text-sm leading-6 text-fg-muted">Enter this code on GitHub, review the requested access, and approve the connection. This page will update automatically.</p>
          <div className="my-4 flex flex-wrap items-center gap-3"><code className="rounded-md border border-border bg-bg px-4 py-3 font-mono text-2xl tracking-widest">{flow.userCode}</code><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(flow.userCode); setCopied(true); } catch { setError("Copy the code above manually; clipboard access is unavailable."); } }}>{copied ? "Copied" : "Copy code"}</Button></div>
          <div className="flex flex-wrap items-center gap-4"><a className="text-sm font-medium underline underline-offset-4" href={flow.verificationUri} target="_blank" rel="noreferrer">Open GitHub to approve ↗</a><Button variant="ghost" onClick={cancelFlow}>Cancel connection</Button></div>
          <p className="mt-3 text-xs text-fg-muted">Code expires at {new Date(flow.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p>
        </div>}
        {showToken && !flow && <form onSubmit={connectToken} className="mt-6 max-w-xl rounded-lg border border-border bg-bg-subtle p-5">
          <h3 className="text-base font-medium">Connect with an access token</h3>
          <p className="my-3 text-sm leading-6 text-fg-muted">Create a fine-grained token for the repositories you want to use. Allow repository metadata and Issues read access; add Pull requests write access if you want to open pull requests.</p>
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="mb-4 inline-block text-sm font-medium underline underline-offset-4">Create a token on GitHub ↗</a>
          <Field label="GitHub access token"><Input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste your access token" required className="!h-10 !text-sm" /></Field>
          <div className="mt-4 flex gap-2"><Button type="submit" size="md" disabled={busy || !token.trim()}>{busy && <Spinner />}Save connection</Button><Button type="button" variant="ghost" size="md" onClick={() => { setShowToken(false); setToken(""); }}>Cancel</Button></div>
          {!connection?.deviceFlowAvailable && <p className="mt-4 text-xs leading-5 text-fg-muted">Browser sign-in becomes available when this installation has a registered GitHub OAuth app configured.</p>}
        </form>}
      </>}
      {!connection?.connected && connection?.source === "saved" && <div className="mt-4"><Button variant="outline" size="md" disabled={busy} onClick={disconnect}>Remove saved connection</Button></div>}
      {message && <p role="status" className="mt-5 text-sm text-green">{message}</p>}
      {error && <div role="alert" className="mt-5 rounded-lg border border-red/25 bg-red-soft p-4 text-sm text-red">{error}{!connection && <Button className="ml-3" variant="outline" onClick={() => void load()}>Retry</Button>}</div>}
    </div>
  </section>;
}
