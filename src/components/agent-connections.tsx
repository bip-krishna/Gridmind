"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { integrationRequest } from "./github-connect";
import { Button, Field, Input, Select, Spinner } from "./ui";
import { cn } from "@/lib/utils";

type Runtime = { platform: string; node: string; launcher: string; shell: "powershell" | "posix" };
type Project = { id: string; name: string; repo_path: string };
type ClientId = "chatgpt-desktop" | "claude-desktop" | "editors" | "chatgpt-web" | "http";
const clients: { id: ClientId; name: string }[] = [
  { id: "chatgpt-desktop", name: "ChatGPT & Codex desktop" },
  { id: "claude-desktop", name: "Claude Desktop" },
  { id: "editors", name: "Cursor & VS Code" },
  { id: "chatgpt-web", name: "ChatGPT web" },
  { id: "http", name: "Other MCP apps" },
];

function shellCommand(runtime: Runtime, args: string[]) {
  const quote = (value: string) => runtime.shell === "powershell"
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`;
  return (runtime.shell === "powershell" ? "& " : "") + [runtime.node, runtime.launcher, ...args].map(quote).join(" ");
}

function SetupCommand({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setCopied(false); setError(null); }, [command]);
  async function copy() {
    try { await navigator.clipboard.writeText(command); setCopied(true); setError(null); }
    catch { setError("Select and copy the command below. Clipboard access is unavailable."); }
  }
  return <div className="min-w-0 rounded-lg border border-border bg-bg-subtle">
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <Button variant="ghost" size="xs" onClick={copy} aria-label={`Copy ${label}`}>{copied ? "Copied" : "Copy"}</Button>
    </div>
    <pre className="whitespace-pre-wrap break-all px-4 py-4 font-mono text-xs leading-6 text-fg" aria-label={label}><code>{command}</code></pre>
    {error && <p role="status" className="px-4 pb-3 text-xs text-fg-muted">{error}</p>}
  </div>;
}

export function AgentConnections() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [client, setClient] = useState<ClientId>("chatgpt-desktop");
  const [tunnelId, setTunnelId] = useState("");
  const [allowWrites, setAllowWrites] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [metadata, result] = await Promise.all([
        integrationRequest<Runtime>("/api/integrations/agents"),
        integrationRequest<{ projects: Project[] }>("/api/projects"),
      ]);
      setRuntime(metadata); setProjects(result.projects);
      setProjectId((current) => result.projects.some((project) => project.id === current) ? current : result.projects[0]?.id || "");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const project = projects.find((candidate) => candidate.id === projectId);
  const projectArgs = project ? ["--project", project.repo_path] : [];
  const command = (args: string[]) => runtime ? shellCommand(runtime, [...args, ...projectArgs]) : "";
  const validTunnelId = /^tunnel_[a-zA-Z0-9_-]{8,100}$/.test(tunnelId);
  const tunnelArgs = ["tunnel", "--tunnel-id", tunnelId, ...(allowWrites ? ["--write"] : [])];

  function downloadConfig() {
    if (!runtime || !project) return;
    const config = { mcpServers: { gridmind: { type: "stdio", command: runtime.node,
      args: [runtime.launcher, "mcp", ...projectArgs] } } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "gridmind-mcp.json"; link.click();
    URL.revokeObjectURL(url);
  }

  return <section aria-labelledby="agent-memory-heading" className="mb-8 overflow-hidden rounded-xl border border-border bg-bg-elevated">
    <div className="border-b border-border p-6 sm:p-8">
      <h2 id="agent-memory-heading" className="text-xl font-semibold tracking-tight">Connect your AI apps</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">Give desktop and browser agents access to the same saved memory in a project folder.</p>
    </div>
    <div className="p-6 sm:p-8">
      {loading ? <p role="status" className="flex items-center gap-2 text-sm text-fg-muted"><Spinner /> Loading agent setup…</p>
        : error ? <div role="alert" className="rounded-lg border border-red/25 bg-red-soft p-4 text-sm text-red"><p>{error}</p><Button variant="outline" className="mt-3" onClick={() => void load()}>Retry agent setup</Button></div>
          : !project ? <div><p className="text-sm leading-6 text-fg-muted">Add a local project folder to choose where your agents share memory.</p><Link href="/" className="mt-3 inline-block text-sm font-medium underline underline-offset-4">Add a project ↗</Link></div>
            : <>
              <Field label="Project folder"><Select aria-label="Project folder" value={projectId} onChange={(event) => { setProjectId(event.target.value); setAllowWrites(false); }} className="!h-10 w-full !text-sm">
                {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select></Field>
              <p className="mt-2 break-all font-mono text-xs leading-5 text-fg-muted">{project.repo_path}</p>
              <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Choose an AI app">
                {clients.map((item) => <button key={item.id} type="button" onClick={() => { setClient(item.id); setAllowWrites(false); }} aria-pressed={client === item.id}
                  className={cn("rounded-md border px-3 py-2.5 text-left text-sm transition-colors", client === item.id ? "border-border-strong bg-bg-subtle font-semibold text-fg" : "border-border text-fg-muted hover:bg-bg-subtle hover:text-fg")}>{item.name}</button>)}
              </div>
              <div className="mt-6 space-y-4">
                {client === "chatgpt-desktop" && <>
                  <p className="text-sm leading-6 text-fg-muted">Run setup for this folder, then reopen a local computer session in ChatGPT or Codex and accept its MCP trust prompts.</p>
                  <SetupCommand label="Set up desktop project memory" command={command(["init"])} />
                  <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Install through the desktop Plugins Directory</summary>
                    <div className="mt-4 space-y-3"><p className="text-sm leading-6 text-fg-muted">Prepare a project-specific plugin, run the marketplace registration command printed by setup, then restart ChatGPT desktop and install Gridmind from that marketplace.</p>
                      <SetupCommand label="Prepare the desktop plugin" command={command(["gui", "chatgpt-desktop"])} />
                      <p className="text-xs leading-5 text-fg-muted">The generated plugin uses this folder’s memory. Installation and availability depend on your desktop app and workspace settings.</p>
                    </div>
                  </details>
                </>}
                {client === "claude-desktop" && <>
                  <p className="text-sm leading-6 text-fg-muted">Add this project as a local Claude Desktop MCP server. Setup preserves other servers and backs up changed settings. Restart Claude Desktop afterward.</p>
                  <SetupCommand label="Set up Claude Desktop" command={command(["gui", "claude-desktop"])} />
                  <p className="text-xs leading-5 text-fg-muted">Claude Desktop settings apply across chats. Each project gets a distinct server name so you can select the intended project.</p>
                </>}
                {client === "editors" && <>
                  <p className="text-sm leading-6 text-fg-muted">Run setup, open this folder in Cursor or VS Code with Copilot, then review the project’s MCP settings and trust prompts.</p>
                  <SetupCommand label="Set up editor project memory" command={command(["init"])} />
                  <p className="text-xs leading-5 text-fg-muted">Setup writes Cursor’s project configuration and the portable .mcp.json used by the current VS Code Copilot harness.</p>
                </>}
                {client === "chatgpt-web" && <>
                  <p className="text-sm leading-6 text-fg-muted">Create a private MCP tunnel in your OpenAI workspace. Install its supported tunnel-client and provide CONTROL_PLANE_API_KEY through your terminal environment.</p>
                  <a href="https://platform.openai.com/settings/organization/tunnels" target="_blank" rel="noreferrer" className="inline-block text-sm font-medium underline underline-offset-4">Open tunnel settings ↗</a>
                  <Field label="OpenAI tunnel ID"><Input value={tunnelId} onChange={(event) => setTunnelId(event.target.value.trim())} placeholder="tunnel_…" autoComplete="off" spellCheck={false} className="!h-10 !text-sm" /></Field>
                  <label className="flex items-start gap-2 text-sm leading-6 text-fg-muted"><input className="mt-1" type="checkbox" checked={allowWrites} onChange={(event) => setAllowWrites(event.target.checked)} /><span>Allow this connection to save shared project memory.</span></label>
                  {tunnelId && !validTunnelId && <p role="status" className="text-xs text-fg-muted">Enter the full tunnel_ ID from OpenAI tunnel settings.</p>}
                  {validTunnelId && <>
                    <SetupCommand label="Preview the tunnel configuration" command={command([...tunnelArgs, "--dry-run"])} />
                    <SetupCommand label="Start the private tunnel" command={command(tunnelArgs)} />
                  </>}
                  <p className="text-sm leading-6 text-fg-muted">Keep the tunnel running. In ChatGPT Plugins, add a custom MCP server, choose Tunnel, and select this tunnel. Your workspace must allow the connection.</p>
                </>}
                {client === "http" && <>
                  <p className="text-sm leading-6 text-fg-muted">Start a local Streamable HTTP endpoint for an MCP app on this computer. Keep the process running and use its printed URL and token-file location in your app’s connection settings.</p>
                  <label className="flex items-start gap-2 text-sm leading-6 text-fg-muted"><input className="mt-1" type="checkbox" checked={allowWrites} onChange={(event) => setAllowWrites(event.target.checked)} /><span>Allow this connection to save shared project memory.</span></label>
                  <SetupCommand label="Start the local MCP endpoint" command={command(["serve", ...(allowWrites ? ["--write"] : [])])} />
                  <p className="text-xs leading-5 text-fg-muted">Provide the token as an Authorization Bearer header. Cloud apps require a network connection such as the ChatGPT tunnel above.</p>
                  <Button variant="outline" size="md" onClick={downloadConfig}>Download stdio configuration</Button>
                </>}
                <div className="border-t border-border pt-5">
                  <p className="text-sm font-medium">Verify memory in your app</p>
                  <p className="mt-2 text-sm leading-6 text-fg-muted">Ask your app to call gridmind_get_context. After an agent saves shared memory, another connected agent can read it on its next call.</p>
                  <details className="mt-3"><summary className="cursor-pointer text-sm text-fg-muted underline underline-offset-4">Check registered connections</summary><div className="mt-3"><SetupCommand label="List recent MCP connections" command={command(["connections"])} /></div></details>
                </div>
              </div>
              <p className="mt-6 border-t border-border pt-5 text-xs leading-5 text-fg-muted">These connections use the selected folder’s .gridmind memory store. To view that same store in the dashboard, start it with GRIDMIND_DATA_DIR pointing to the folder’s .gridmind directory. Agent names appear after MCP initialization.</p>
              {runtime && <p className="mt-2 text-xs text-fg-dim">Commands are formatted for {runtime.shell === "powershell" ? "PowerShell" : "your POSIX terminal"} on the machine running Gridmind.</p>}
            </>}
    </div>
  </section>;
}
