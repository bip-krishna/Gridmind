import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "default",
  size = "sm",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "danger" | "success";
  size?: "sm" | "xs" | "md";
}) {
  const variants: Record<string, string> = {
    default: "bg-accent hover:bg-[#8d9bfa] text-[#0c0e14] font-semibold",
    outline:
      "border border-border-strong bg-transparent hover:bg-bg-subtle text-fg hover:text-fg",
    ghost: "bg-transparent hover:bg-bg-subtle text-fg-muted hover:text-fg",
    danger: "bg-red-soft text-red border border-red/30 hover:bg-red/15",
    success: "bg-green-soft text-green border border-green/25 hover:bg-green/10",
  };
  const sizes: Record<string, string> = {
    xs: "h-6 px-2 text-[11px] rounded-md gap-1",
    sm: "h-7.5 px-3 text-xs rounded-md gap-1.5",
    md: "h-9 px-4 text-sm rounded-lg gap-2",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors duration-150 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer select-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}

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
        "rounded-xl border border-border bg-bg-elevated overflow-hidden",
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
        "flex items-center justify-between gap-3 border-b border-border px-4 py-3",
        className
      )}
    >
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {subtitle && <p className="text-[11px] text-fg-dim truncate">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center shrink-0 gap-1.5">{right}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-fg-muted uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-8 w-full rounded-md border border-border-strong bg-bg px-2.5 text-xs text-fg placeholder:text-fg-dim focus:outline-none focus:border-accent transition-colors duration-150",
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
        "w-full rounded-md border border-border-strong bg-bg px-2.5 py-2 text-xs text-fg placeholder:text-fg-dim focus:outline-none focus:border-accent transition-colors duration-150 resize-y leading-relaxed",
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
        "h-8 rounded-md border border-border-strong bg-bg px-2 text-xs text-fg focus:outline-none focus:border-accent transition-colors duration-150 cursor-pointer",
        props.className
      )}
    />
  );
}

export type BadgeTone = "accent" | "green" | "amber" | "red" | "cyan" | "purple" | "dim" | "follow";

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
    accent: "bg-accent-soft text-accent border-accent/30",
    green: "bg-green-soft text-green border-green/25",
    amber: "bg-amber-soft text-amber border-amber/25",
    red: "bg-red-soft text-red border-red/30",
    cyan: "bg-cyan-soft text-cyan border-cyan/25",
    purple: "bg-purple-soft text-purple border-purple/25",
    dim: "bg-bg-subtle text-fg-muted border-border-strong",
    follow: "bg-bg-subtle text-fg-dim border-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide border",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "dim", pulse = false }: { tone?: string; pulse?: boolean }) {
  const map: Record<string, string> = {
    accent: "bg-accent",
    green: "bg-green",
    amber: "bg-amber",
    red: "bg-red",
    cyan: "bg-cyan",
    purple: "bg-purple",
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

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("size-3.5 animate-spin text-fg-dim", className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

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
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="text-[13px] font-medium text-fg-muted">{title}</div>
      {hint && <p className="max-w-sm text-[11px] text-fg-dim leading-relaxed">{hint}</p>}
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border-strong bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
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
        onClick={onConfirm}
        className="rounded bg-red/15 px-2 py-1 text-[11px] font-medium text-red hover:bg-red/25 cursor-pointer"
      >
        Confirm
      </button>
      <button
        onClick={onCancel}
        className="rounded bg-bg-subtle px-2 py-1 text-[11px] text-fg-muted hover:text-fg cursor-pointer"
      >
        Cancel
      </button>
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text)}
      className="rounded px-1.5 py-1 text-[10px] font-medium text-fg-dim hover:text-fg hover:bg-bg-subtle transition-colors cursor-pointer"
      title="Copy"
    >
      {label ?? "copy"}
    </button>
  );
}