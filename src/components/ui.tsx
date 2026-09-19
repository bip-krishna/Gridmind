import React from "react";
import { cn } from "@/lib/utils";

/* ────────── Button ────────── */

export function Button({
  className,
  variant = "default",
  size = "sm",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "danger" | "success";
  size?: "xs" | "sm" | "md";
}) {
  const variants: Record<string, string> = {
    default:
      "bg-fg text-bg hover:opacity-90 font-medium shadow-none border border-transparent active:scale-[0.99]",
    outline:
      "border border-border bg-transparent hover:bg-bg-subtle text-fg hover:border-border-strong font-medium",
    ghost:
      "bg-transparent hover:bg-bg-subtle text-fg-muted hover:text-fg font-medium",
    danger:
      "bg-red-soft text-red border border-red/25 hover:bg-red/15 font-medium",
    success:
      "bg-green-soft text-green border border-green/25 hover:bg-green/10 font-medium",
  };

  const sizes: Record<string, string> = {
    xs: "h-6 px-2 text-[10px] rounded gap-1",
    sm: "h-7.5 px-2.5 text-[11px] rounded-md gap-1.5",
    md: "h-8.5 px-3.5 text-[12px] rounded-md gap-2",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}

/* ────────── Card ────────── */

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-bg-elevated overflow-hidden transition-colors",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
  className,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5",
        className
      )}
    >
      <div className="min-w-0">
        <h3 className="text-[13px] font-medium text-fg tracking-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-fg-dim truncate">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center shrink-0 gap-1.5">{right}</div>}
    </div>
  );
}

/* ────────── Form Controls ────────── */

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[10px] font-semibold text-fg-dim uppercase tracking-wider select-none">
        {label}
      </span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-8 w-full rounded-md border border-border bg-bg-subtle px-2.5 text-[12px] text-fg placeholder:text-fg-dim focus:outline-none focus:border-border-strong focus:bg-bg transition-colors duration-100",
        props.className
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-md border border-border bg-bg-subtle px-2.5 py-2 text-[12px] text-fg placeholder:text-fg-dim focus:outline-none focus:border-border-strong focus:bg-bg transition-colors duration-100 resize-y leading-relaxed",
        props.className
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-8 rounded-md border border-border bg-bg-subtle px-2.5 text-[12px] text-fg focus:outline-none focus:border-border-strong focus:bg-bg transition-colors duration-100 cursor-pointer",
        props.className
      )}
    />
  );
}

/* ────────── Badge ────────── */

export type BadgeTone = "accent" | "green" | "amber" | "red" | "dim" | "follow";

export function Badge({
  tone = "dim",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    accent: "bg-bg-subtle text-fg border-border-strong",
    green: "bg-green-soft text-green border-green/25",
    amber: "bg-amber-soft text-amber border-amber/25",
    red: "bg-red-soft text-red border-red/25",
    dim: "bg-bg-subtle text-fg-muted border-border",
    follow: "bg-bg-subtle text-fg-dim border-border",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono tracking-tight border select-none",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/* ────────── Dot ────────── */

export function Dot({ tone = "dim", pulse = false }: { tone?: string; pulse?: boolean }) {
  const map: Record<string, string> = {
    accent: "bg-fg",
    green: "bg-green",
    amber: "bg-amber",
    red: "bg-red",
    dim: "bg-fg-dim",
  };

  return (
    <span
      className={cn(
        "inline-block size-1.5 rounded-full shrink-0",
        map[tone] ?? map.dim,
        pulse && "live-dot"
      )}
    />
  );
}

/* ────────── Spinner ────────── */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("size-3.5 animate-spin text-fg-muted", className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-85" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/* ────────── Empty / Loading / Error States ────────── */

export function Empty({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="text-[13px] font-medium text-fg">{title}</div>
      {hint && <p className="max-w-sm text-[11px] text-fg-dim leading-relaxed">{hint}</p>}
      {children}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-12 text-center">
      <Spinner />
      <span className="text-[11px] text-fg-dim">{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <div className="text-[12px] font-medium text-red">{message}</div>
      {onRetry && (
        <Button variant="outline" size="xs" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/* ────────── Tabs ────────── */

export function TabBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-0.5 border-b border-border px-3 overflow-x-auto", className)} role="tablist">
      {children}
    </div>
  );
}

export function Tab({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "relative px-2.5 py-2 text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer select-none",
        active
          ? "text-fg after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1.5px] after:bg-fg"
          : "text-fg-muted hover:text-fg"
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn("ml-1.5 tabular-nums", active ? "text-fg-dim" : "text-fg-dim/70")}>{count}</span>
      )}
    </button>
  );
}

/* ────────── Table ────────── */

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-[12px]">{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-border">
      {children}
    </thead>
  );
}

export function Tbody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-border/40">{children}</tbody>;
}

export function Tr({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "transition-colors",
        onClick && "cursor-pointer hover:bg-bg-subtle/60",
        className
      )}
    >
      {children}
    </tr>
  );
}

export function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn("px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-dim select-none", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn("px-3 py-2 text-fg-muted", className)}>
      {children}
    </td>
  );
}

/* ────────── SplitView ────────── */

export function SplitView({
  list,
  detail,
  className,
}: {
  list: React.ReactNode;
  detail: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 lg:flex-row lg:items-start", className)}>
      <div className="w-full lg:w-[380px] xl:w-[420px] lg:shrink-0">{list}</div>
      <div className="flex-1 min-w-0">{detail}</div>
    </div>
  );
}

/* ────────── CodeBlock ────────── */

export function CodeBlock({
  code,
  fileName,
  className,
}: {
  code: string;
  fileName?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  function copy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={cn("rounded-lg border border-border overflow-hidden", className)}>
      {fileName && (
        <div className="flex items-center justify-between border-b border-border bg-bg-subtle px-3 py-1.5">
          <span className="font-mono text-[11px] text-fg-muted truncate">{fileName}</span>
          <button
            onClick={copy}
            className="rounded px-1.5 py-0.5 text-[10px] text-fg-dim hover:text-fg hover:bg-bg transition-colors cursor-pointer"
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      )}
      <pre className="overflow-auto p-3 font-mono text-[11px] leading-relaxed text-fg-muted bg-bg-elevated">
        {code}
      </pre>
    </div>
  );
}

/* ────────── DiffViewer ────────── */

export function DiffViewer({
  hunks,
  fileName,
  additions = 0,
  deletions = 0,
  className,
}: {
  hunks: string;
  fileName?: string;
  additions?: number;
  deletions?: number;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  function copy() {
    navigator.clipboard.writeText(hunks);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const lines = hunks.split("\n");

  return (
    <div className={cn("rounded-lg border border-border overflow-hidden", className)}>
      {fileName && (
        <div className="flex items-center justify-between border-b border-border bg-bg-subtle px-3 py-1.5">
          <span className="font-mono text-[11px] text-fg truncate">{fileName}</span>
          <div className="flex items-center gap-2">
            <span className="text-green text-[10px] font-mono">+{additions}</span>
            <span className="text-red text-[10px] font-mono">−{deletions}</span>
            <button
              onClick={copy}
              className="rounded px-1.5 py-0.5 text-[10px] text-fg-dim hover:text-fg hover:bg-bg transition-colors cursor-pointer"
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>
        </div>
      )}
      <div className="overflow-auto max-h-[500px] bg-bg-elevated">
        <pre className="font-mono text-[11px] leading-[1.6]">
          {lines.map((line, i) => {
            let cls = "px-3 ";
            if (line.startsWith("+") && !line.startsWith("+++")) cls += "diff-add ";
            else if (line.startsWith("-") && !line.startsWith("---")) cls += "diff-del ";
            else if (line.startsWith("@@")) cls += "diff-hunk ";
            else cls += "text-fg-muted ";
            return (
              <div key={i} className={cls}>
                {line || " "}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

/* ────────── TerminalViewer ────────── */

export function TerminalViewer({
  output,
  className,
  maxHeight = "420px",
}: {
  output: string;
  className?: string;
  maxHeight?: string;
}) {
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "auto" });
  }, [output]);

  return (
    <div
      className={cn("terminal-view rounded-lg overflow-hidden", className)}
      style={{ maxHeight }}
    >
      <div className="overflow-auto h-full p-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
          {output || "Waiting for output…"}
        </pre>
        <div ref={endRef} />
      </div>
    </div>
  );
}

/* ────────── Kbd / CopyButton / Confirmation ────────── */

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-muted select-none">
      {children}
    </kbd>
  );
}

export function Confirmation({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onConfirm}
        className="rounded bg-red-soft border border-red/25 px-2 py-1 text-[11px] font-medium text-red hover:bg-red/15 cursor-pointer transition-colors"
      >
        Confirm
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded bg-bg-subtle border border-border px-2 py-1 text-[11px] text-fg-muted hover:text-fg cursor-pointer transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);

  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded px-1.5 py-0.5 font-mono text-[10px] text-fg-dim hover:text-fg hover:bg-bg-subtle border border-transparent hover:border-border transition-colors cursor-pointer"
      title="Copy to clipboard"
    >
      {copied ? "copied" : (label ?? "copy")}
    </button>
  );
}

/* ────────── StatusIndicator ────────── */

export function StatusIndicator({
  status,
  label,
  pulse = false,
}: {
  status: "online" | "offline" | "working" | "idle" | "error";
  label?: string;
  pulse?: boolean;
}) {
  const config: Record<string, { dot: string; text: string }> = {
    online: { dot: "bg-green", text: "text-green" },
    offline: { dot: "bg-fg-dim", text: "text-fg-dim" },
    working: { dot: "bg-amber", text: "text-amber" },
    idle: { dot: "bg-fg-dim", text: "text-fg-muted" },
    error: { dot: "bg-red", text: "text-red" },
  };

  const c = config[status] ?? config.idle;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full shrink-0", c.dot, pulse && "live-dot")} />
      {label && <span className={cn("text-[10px] font-mono uppercase tracking-wide", c.text)}>{label}</span>}
    </span>
  );
}

/* ────────── Section ────────── */

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("text-[10px] font-semibold uppercase tracking-wider text-fg-dim select-none", className)}>
      {children}
    </div>
  );
}

/* ────────── KeyValue for detail inspectors ────────── */

export function KeyValue({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <span className="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wider text-fg-dim pt-0.5">
        {label}
      </span>
      <span className={cn("text-[12px] text-fg-muted min-w-0", mono && "font-mono")}>
        {children}
      </span>
    </div>
  );
}
