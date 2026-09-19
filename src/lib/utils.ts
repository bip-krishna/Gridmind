export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function extractRepoName(repoPath: string): string {
  return repoPath.split("/").filter(Boolean).pop() ?? repoPath;
}

export function gitRemoteDisplay(remote: string | null): string {
  if (!remote) return "no remote";
  return remote.replace(/^git@github\.com:/, "").replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
}

export function shortenPath(p: string): string {
  if (!p) return "";
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

export function taskStatusTone(status: string): "accent" | "green" | "amber" | "dim" {
  switch (status) {
    case "done":
      return "green";
    case "in_progress":
      return "amber";
    case "blocked":
      return "amber";
    default:
      return "dim";
  }
}

export function agentTone(type: string): "accent" | "cyan" | "purple" | "dim" {
  switch (type) {
    case "opencode":
      return "cyan";
    case "codex":
      return "accent";
    default:
      return "dim";
  }
}

export function sessionStatusTone(status: string): "green" | "red" | "amber" | "cyan" | "dim" {
  switch (status) {
    case "running":
      return "cyan";
    case "done":
      return "green";
    case "error":
      return "red";
    case "stopped":
      return "dim";
    default:
      return "amber";
  }
}