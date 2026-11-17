"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { Badge, Button, Dot, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import "@xterm/xterm/css/xterm.css";

type Launcher = { id: string; label: string; available: boolean };
type TerminalSession = {
  id: string; projectId: string; launcher: string; title: string; cwd: string;
  status: "running" | "exited" | "stopped"; startedAt: number; endedAt: number | null;
  cols: number; rows: number; exitCode: number | null; signal: number | null; lastSeq: number;
};
type TerminalList = { sessions: TerminalSession[]; launchers: Launcher[] };
type Connection = "connecting" | "connected" | "reconnecting" | "disconnected" | "exited";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const timeout = AbortSignal.timeout(10000);
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(url, { ...options, signal, cache: "no-store" });
  let data: T & { error?: string };
  try { data = await response.json(); }
  catch { throw new Error("The terminal server returned an unexpected response. Try reconnecting."); }
  if (!response.ok) throw new Error(data.error || `Terminal request failed (${response.status}).`);
  return data;
}

export function TerminalPanel({ projectId, repoPath }: { projectId: string; repoPath: string }) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [launchers, setLaunchers] = useState<Launcher[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const base = `/api/projects/${encodeURIComponent(projectId)}/terminal`;

  const load = useCallback(async () => {
    const requestedGeneration = generation.current;
    try {
      const result = await request<TerminalList>(base);
      if (!mounted.current || requestedGeneration !== generation.current) return;
      setSessions(result.sessions); setLaunchers(result.launchers); setError(null);
      setSelectedId((current) => result.sessions.some((session) => session.id === current) ? current : result.sessions[0]?.id || null);
    } catch (err) {
      if (mounted.current && requestedGeneration === generation.current) setError(err instanceof Error ? err.message : "Could not load project terminals.");
    } finally { if (mounted.current && requestedGeneration === generation.current) setLoading(false); }
  }, [base]);

  useEffect(() => {
    generation.current++; mounted.current = true; setLoading(true); setSessions([]); setSelectedId(null);
    void load();
    return () => { mounted.current = false; generation.current++; };
  }, [load]);

  const updateSession = useCallback((session: TerminalSession) => {
    if (!mounted.current || session.projectId !== currentProject.current) return;
    setSessions((current) => current.some((item) => item.id === session.id)
      ? current.map((item) => item.id === session.id ? session : item) : [session, ...current]);
  }, []);

  async function launch(launcher: Launcher) {
    const requestedGeneration = generation.current;
    setLaunching(launcher.id); setError(null);
    try {
      const result = await request<{ terminal: TerminalSession }>(base, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ launcher: launcher.id, cols: 100, rows: 28 }),
      });
      if (mounted.current && requestedGeneration === generation.current) { updateSession(result.terminal); setSelectedId(result.terminal.id); }
    } catch (err) { if (mounted.current && requestedGeneration === generation.current) setError(err instanceof Error ? err.message : "Could not start this terminal."); }
    finally { if (mounted.current && requestedGeneration === generation.current) setLaunching(null); }
  }

  const selected = sessions.find((session) => session.id === selectedId);
  const hasRunningSessions = sessions.some((session) => session.status === "running");
  useEffect(() => {
    if (!hasRunningSessions) return;
    const controller = new AbortController();
    let renewing = false;
    // Successful metadata reads renew the HttpOnly owner cookie without touching
    // the terminal view or replacing its current input/output state.
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void request<TerminalList>(base, { signal: controller.signal })
        .catch(() => undefined)
        .finally(() => { renewing = false; });
    }, 120000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [base, hasRunningSessions]);

  return <div className="flex min-w-0 flex-col gap-5">
    <section className="rounded-lg border border-border bg-bg-elevated p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><h2 className="text-base font-semibold">Open a terminal in this project</h2>
          <p className="mt-2 break-all font-mono text-xs leading-5 text-fg-muted">{repoPath}</p>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-fg-muted">Run commands or launch an installed agent with your computer’s permissions. Sessions keep running when you switch panels; use Stop to end them.</p>
        </div>
        <Button variant="outline" size="md" onClick={() => void load()} disabled={loading} aria-label="Refresh terminals and installed agents">Refresh</Button>
      </div>
      {loading ? <p role="status" className="mt-5 flex items-center gap-2 text-sm text-fg-muted"><Spinner /> Checking available terminals…</p>
        : <div className="mt-5 flex flex-wrap gap-2" aria-label="Start a project terminal">
          {launchers.map((launcher) => <Button key={launcher.id} size="md" variant={launcher.id === "shell" ? "default" : "outline"}
            className="!h-10 !px-4 !text-sm" disabled={!launcher.available || !!launching} onClick={() => void launch(launcher)}
            title={!launcher.available ? `${launcher.label} was not found on the Gridmind server's PATH.` : undefined}>
            {launching === launcher.id && <Spinner />}{launcher.id === "shell" ? "New shell" : `Open ${launcher.label}`}
            {!launcher.available && <span className="text-xs">· not installed</span>}
          </Button>)}
        </div>}
      {!loading && launchers.some((launcher) => !launcher.available) && <p className="mt-3 text-xs leading-5 text-fg-dim">Agent buttons use CLIs installed on the machine running Gridmind. Install an agent there, restart Gridmind if its PATH changed, then refresh.</p>}
      {error && <p role="alert" className="mt-4 rounded-md border border-red/25 bg-red-soft px-4 py-3 text-sm text-red">{error}</p>}
    </section>

    {sessions.length > 0 ? <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-bg-elevated" aria-label="Project terminals">
      <div className="flex flex-wrap gap-1 border-b border-border bg-bg-subtle p-2" role="tablist" aria-label="Terminal sessions">
        {sessions.map((session, index) => <button type="button" key={session.id} role="tab" id={`terminal-tab-${session.id}`} aria-controls={`terminal-session-${session.id}`} aria-selected={selectedId === session.id} tabIndex={selectedId === session.id ? 0 : -1}
          onKeyDown={(event) => {
            const target = event.key === "ArrowRight" ? sessions[(index + 1) % sessions.length] : event.key === "ArrowLeft" ? sessions[(index + sessions.length - 1) % sessions.length]
              : event.key === "Home" ? sessions[0] : event.key === "End" ? sessions[sessions.length - 1] : null;
            if (target) { event.preventDefault(); setSelectedId(target.id); document.getElementById(`terminal-tab-${target.id}`)?.focus(); }
          }}
          onClick={() => setSelectedId(session.id)} className={cn("flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
            selectedId === session.id ? "border-border-strong bg-bg font-medium text-fg" : "border-transparent text-fg-muted hover:bg-bg hover:text-fg")}>
          <Dot tone={session.status === "running" ? "green" : "dim"} /><span className="truncate">{session.title || session.launcher} {index + 1}</span>
        </button>)}
      </div>
      {selected && <InteractiveTerminal key={`${projectId}:${selected.id}`} session={selected} base={base} onUpdate={updateSession} onRefresh={load} />}
      {sessions.filter((session) => session.id !== selectedId).map((session) => <div key={session.id} hidden role="tabpanel" id={`terminal-session-${session.id}`} aria-labelledby={`terminal-tab-${session.id}`} />)}
    </section> : !loading && <div className="rounded-lg border border-dashed border-border p-9 text-center">
      <h3 className="text-sm font-medium">Your terminal will appear here</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-fg-muted">Choose New shell to run commands, or open an installed agent to work interactively in this folder.</p>
    </div>}
  </div>;
}

function InteractiveTerminal({ session, base, onUpdate, onRefresh }: {
  session: TerminalSession; base: string; onUpdate: (session: TerminalSession) => void; onRefresh: () => Promise<void>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const sendInput = useRef<(data: string) => void>(() => undefined);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [stopping, setStopping] = useState(false);
  const currentSession = useRef(session);
  currentSession.current = session;
  const running = session.status === "running";
  const endpoint = `${base}/${encodeURIComponent(session.id)}`;

  useEffect(() => {
    if (!running && terminal.current) terminal.current.options.disableStdin = true;
  }, [running]);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | undefined;
    let observer: ResizeObserver | undefined;
    let inputTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let input = "";
    let sending = false;
    let canWrite = false;
    let cursor = 0;
    let pendingOutput = 0;
    const encoder = new TextEncoder();
    let activeTerminal: Terminal | undefined;
    const controller = new AbortController();
    setConnection("connecting"); setError(null); setHasSelection(false); setNotice(null);

    async function flushInput() {
      if (disposed || sending || !canWrite || currentSession.current.status !== "running" || !input) return;
      sending = true;
      try {
        while (!disposed && canWrite && currentSession.current.status === "running" && input) {
          let size = Math.min(input.length, 4096);
          // Keep a Unicode surrogate pair together when splitting a large paste.
          if (size < input.length && /[\uD800-\uDBFF]/.test(input[size - 1])) size--;
          const data = input.slice(0, size); input = input.slice(size);
          await request(endpoint + "/input", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }), signal: controller.signal });
        }
      } catch (err) {
        input = "";
        if (!disposed) {
          canWrite = false; source?.close();
          if (activeTerminal) activeTerminal.options.disableStdin = true;
          setConnection("disconnected");
          setError(err instanceof Error ? err.message : "Input could not be delivered. Reconnect before continuing.");
        }
      } finally { sending = false; }
    }
    function enqueue(data: string) {
      if (!canWrite || disposed || currentSession.current.status !== "running") return;
      if (input.length + data.length > 128 * 1024) { setError("This paste is too large. Send a smaller amount of text."); return; }
      input += data;
      if (!inputTimer) inputTimer = setTimeout(() => { inputTimer = undefined; void flushInput(); }, 8);
    }
    sendInput.current = enqueue;

    async function setup() {
      try {
        const [{ Terminal: Xterm }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
        if (disposed || !container.current) return;
        const view = new Xterm({ cursorBlink: true, fontSize: 13, lineHeight: 1.2,
          fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', scrollback: 5000,
          disableStdin: true, screenReaderMode: true,
          theme: { background: "#171719", foreground: "#e8e8ec", cursor: "#f4f4f5", selectionBackground: "#52525b" },
        });
        const fit = new FitAddon(); view.loadAddon(fit); view.open(container.current);
        view.textarea?.setAttribute("aria-label", `${session.title || session.launcher} terminal input`);
        activeTerminal = view; terminal.current = view;
        view.onData(enqueue);
        view.onSelectionChange(() => { if (!disposed) setHasSelection(view.hasSelection()); });
        let lastSize = "";
        const resize = () => {
          if (disposed || !container.current || !container.current.clientWidth || !container.current.clientHeight) return;
          try { fit.fit(); } catch { return; }
          const key = `${view.cols}:${view.rows}`;
          if (key === lastSize || view.cols < 2 || view.rows < 1) return;
          lastSize = key;
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            if (!disposed && currentSession.current.status === "running") void request(endpoint + "/resize", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cols: Math.max(20, Math.min(300, view.cols)), rows: Math.max(5, Math.min(120, view.rows)) }), signal: controller.signal,
            }).catch((err) => { if (!disposed) setError(err instanceof Error ? err.message : "Could not resize the terminal."); });
          }, 100);
        };
        observer = new ResizeObserver(resize); observer.observe(container.current); resize();
        source = new EventSource(endpoint + "/stream?after=0");
        source.onopen = () => {
          if (disposed) return;
          clearTimeout(reconnectTimer); reconnectTimer = undefined;
          setConnection("connected"); setError(null);
        };
        source.addEventListener("ready", (event) => {
          if (disposed) return;
          try {
            const data = JSON.parse((event as MessageEvent).data) as { terminal: TerminalSession; reset: boolean; truncated: boolean };
            if (data.reset) { view.reset(); cursor = 0; }
            if (data.truncated) setNotice("Earlier output exceeded the retained history. Showing the most recent output.");
            onUpdate(data.terminal); canWrite = data.terminal.status === "running";
            view.options.disableStdin = !canWrite;
            if (!canWrite) setConnection("exited");
            resize();
          } catch { setError("Could not read the terminal connection state."); }
        });
        source.addEventListener("output", (event) => {
          if (disposed) return;
          const message = event as MessageEvent;
          const sequence = Number(message.lastEventId);
          if (Number.isFinite(sequence) && sequence <= cursor) return;
          try {
            const data = JSON.parse(message.data) as { data: string };
            if (typeof data.data !== "string") return;
            const bytes = encoder.encode(data.data).byteLength;
            if (pendingOutput + bytes > 1024 * 1024) {
              source?.close(); canWrite = false; input = ""; view.options.disableStdin = true;
              setConnection("disconnected");
              setError("Output is arriving faster than this view can render. Stop the terminal or reconnect to its recent output.");
              return;
            }
            pendingOutput += bytes;
            view.write(data.data, () => { pendingOutput -= bytes; });
            if (Number.isFinite(sequence)) cursor = sequence;
          } catch { setError("A terminal output frame could not be read."); }
        });
        source.addEventListener("exit", (event) => {
          if (disposed) return;
          try { onUpdate((JSON.parse((event as MessageEvent).data) as { terminal: TerminalSession }).terminal); }
          catch { /* The connection still ends even if its final status is unavailable. */ }
          canWrite = false; input = ""; view.options.disableStdin = true;
          setConnection("exited"); source?.close(); clearTimeout(reconnectTimer);
        });
        source.onerror = () => {
          if (disposed) return;
          canWrite = false; input = ""; view.options.disableStdin = true;
          setConnection("reconnecting");
          reconnectTimer ??= setTimeout(() => {
            if (disposed) return;
            source?.close(); setConnection("disconnected");
            setError("The terminal connection is unavailable. Reconnect to check its current state.");
          }, 30000);
        };
      } catch (err) {
        if (!disposed) { setConnection("disconnected"); setError(err instanceof Error ? err.message : "Could not load the interactive terminal."); }
      }
    }
    void setup();
    return () => {
      disposed = true; canWrite = false; input = ""; sendInput.current = () => undefined;
      clearTimeout(inputTimer); clearTimeout(resizeTimer); clearTimeout(reconnectTimer);
      controller.abort(); source?.close(); observer?.disconnect(); activeTerminal?.dispose();
      if (terminal.current === activeTerminal) terminal.current = null;
    };
    // Updating a summary must not remount xterm or replay already-rendered output.
    // The parent keys this view by project and terminal identity.
  }, [endpoint, onUpdate, reconnectAttempt, session.id, session.launcher, session.title]);

  async function stop() {
    setStopping(true); setError(null);
    try { const result = await request<{ terminal: TerminalSession }>(endpoint, { method: "DELETE" }); onUpdate(result.terminal); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not stop this terminal."); }
    finally { setStopping(false); }
  }
  async function copySelection() {
    try { const text = terminal.current?.getSelection(); if (text) await navigator.clipboard.writeText(text); }
    catch { setError("Clipboard access is unavailable. Select terminal text and use your system’s Copy shortcut."); }
  }
  async function paste() {
    try { const text = await navigator.clipboard.readText(); terminal.current?.paste(text); terminal.current?.focus(); }
    catch { setError("Clipboard access is unavailable. Focus the terminal and use your system’s Paste shortcut."); }
  }
  const interactive = running && connection === "connected";
  const status = connection === "exited" || !running ? session.status === "stopped" ? "Stopped" : `Exited${session.exitCode !== null ? ` · ${session.exitCode}` : ""}`
    : connection === "connected" ? "Connected" : connection === "connecting" ? "Connecting" : connection === "reconnecting" ? "Reconnecting" : "Disconnected";

  return <div role="tabpanel" id={`terminal-session-${session.id}`} aria-labelledby={`terminal-tab-${session.id}`}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex min-w-0 items-center gap-3"><h3 className="truncate text-sm font-medium">{session.title || session.launcher}</h3><Badge tone={interactive ? "green" : connection === "reconnecting" ? "amber" : "dim"}>{status}</Badge></div>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="ghost" size="xs" onClick={() => terminal.current?.focus()} disabled={!interactive}>Focus</Button>
        <Button variant="ghost" size="xs" onClick={copySelection} disabled={!hasSelection}>Copy selection</Button>
        <Button variant="ghost" size="xs" onClick={paste} disabled={!interactive}>Paste</Button>
        <Button variant="ghost" size="xs" onClick={() => terminal.current?.clear()}>Clear scrollback</Button>
        {running && <Button variant="danger" size="xs" onClick={stop} disabled={stopping}>{stopping ? "Stopping…" : "Stop terminal"}</Button>}
      </div>
    </div>
    {notice && <p role="status" className="border-b border-border px-4 py-3 text-xs leading-5 text-fg-muted">{notice}</p>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-red/25 bg-red-soft px-4 py-3 text-sm text-red"><span>{error}</span>
      <Button variant="outline" size="xs" onClick={() => { setReconnectAttempt((value) => value + 1); void onRefresh(); }}>Reconnect</Button>
    </div>}
    <div className="relative bg-[#171719] p-2 sm:p-3">
      <div ref={container} className="min-w-0 w-full" style={{ height: "clamp(320px, 58vh, 680px)" }} aria-label="Interactive project terminal" />
      {connection === "connecting" && <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-zinc-300"><Spinner /> Opening terminal view…</div>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
      <div className="flex flex-wrap gap-1.5" aria-label="Terminal keys">
        {[["Ctrl C", "\u0003"], ["Esc", "\u001b"], ["Tab", "\t"], ["Enter", "\r"]].map(([label, value]) => <Button key={label} variant="outline" size="xs" disabled={!interactive} onClick={() => { sendInput.current(value); terminal.current?.focus(); }}>{label}</Button>)}
      </div>
      <p className="min-w-0 break-all text-xs text-fg-dim">{session.cwd}</p>
    </div>
  </div>;
}
