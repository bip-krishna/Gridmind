import fs from "node:fs";
import path from "node:path";
import { runGit } from "./git";

export type GitAnalyzerOptions = {
  since?: string;
  until?: string;
  maxCommits?: number;
  top?: number;
  includeUncommitted?: boolean;
};

export type AuthorVelocity = {
  name: string;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
  firstCommitTs: number;
  lastCommitTs: number;
  pct: number;
};

export type DayVelocity = {
  date: string;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
  authors: string[];
};

export type WeekVelocity = {
  weekStart: string;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
  distinctAuthors: number;
};

export type GitVelocity = {
  commits: number;
  authorCount: number;
  activeDays: number;
  spanDays: number;
  avgCommitsPerDay: number;
  avgCommitsPerActiveDay: number;
  firstCommitTs: number | null;
  lastCommitTs: number | null;
  daysSinceLastCommit: number | null;
  linesAdded: number;
  linesDeleted: number;
  netLines: number;
  busiestDay: { date: string; commits: number } | null;
  perDay: DayVelocity[];
  perWeek: WeekVelocity[];
  authorsDetail: AuthorVelocity[];
};

export type FileChurn = {
  path: string;
  commits: number;
  additions: number;
  deletions: number;
  total: number;
  lastModifiedTs: number;
  authors: string[];
};

export type ChurnSummary = {
  filesTouched: number;
  totalChanges: number;
  churnPerActiveDay: number;
  averageChurnPerFile: number;
  worst: FileChurn[];
  mostChanged: FileChurn[];
  stable: FileChurn[];
};

export type GitAnalysisResult = {
  repoPath: string;
  branch: string;
  generatedAt: number;
  window: { since: string | null; until: string | null };
  velocity: GitVelocity;
  churn: ChurnSummary;
};

type FileStat = { additions: number; deletions: number };

type CommitRecord = {
  sha: string;
  author: string;
  iso: string;
  ts: number;
  files: Map<string, FileStat>;
};

type MutableAuthor = {
  name: string;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
  firstCommitTs: number;
  lastCommitTs: number;
};

type MutableFileChurn = {
  path: string;
  commits: number;
  additions: number;
  deletions: number;
  lastModifiedTs: number;
  authors: Set<string>;
};

const DEFAULT_MAX_COMMITS = 2000;
const DEFAULT_TOP = 10;
const DAY_MS = 86_400_000;

function localDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoWeekStart(iso: string): string {
  const d = new Date(iso);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function scanCommits(repoPath: string, options: GitAnalyzerOptions): Promise<CommitRecord[]> {
  const args = ["log", "--no-abbrev", "--numstat", "--pretty=format:%H%x1f%an%x1f%aI"];
  if (options.since) args.push(`--since=${options.since}`);
  if (options.until) args.push(`--until=${options.until}`);
  const max = options.maxCommits ?? DEFAULT_MAX_COMMITS;
  if (max > 0) args.push(`--max-count=${max}`);
  const out = await runGit(repoPath, args);
  return parseCommitStream(out);
}

function parseCommitStream(raw: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  let current: CommitRecord | null = null;
  for (const line of raw.split("\n")) {
    if (line.length === 0) {
      if (current) {
        commits.push(current);
        current = null;
      }
      continue;
    }
    if (line.includes("\x1f")) {
      if (current) commits.push(current);
      const [sha = "", author = "", iso = ""] = line.split("\x1f");
      current = {
        sha: sha.trim(),
        author: author.trim(),
        iso,
        ts: Date.parse(iso) || 0,
        files: new Map(),
      };
      continue;
    }
    if (!current) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [rawAdd, rawDel] = parts;
    if (rawAdd === "-" || rawDel === "-") continue;
    const additions = parseInt(rawAdd, 10) || 0;
    const deletions = parseInt(rawDel, 10) || 0;
    const filePath = parts.slice(2).join("\t").trim();
    if (!filePath) continue;
    const prev = current.files.get(filePath);
    current.files.set(filePath, {
      additions: (prev?.additions ?? 0) + additions,
      deletions: (prev?.deletions ?? 0) + deletions,
    });
  }
  if (current) commits.push(current);
  return commits;
}

function countActiveDays(records: CommitRecord[]): number {
  const days = new Set<string>();
  for (const rec of records) {
    const day = localDay(rec.iso);
    if (day) days.add(day);
  }
  return days.size;
}

function buildVelocity(records: CommitRecord[]): GitVelocity {
  const perDay = new Map<string, DayVelocity>();
  const perWeek = new Map<string, WeekVelocity>();
  const weekAuthorSets = new Map<string, Set<string>>();
  const byAuthor = new Map<string, MutableAuthor>();
  let linesAdded = 0;
  let linesDeleted = 0;
  let firstTs = Infinity;
  let lastTs = -1;

  for (const rec of records) {
    if (rec.ts > 0) {
      if (rec.ts < firstTs) firstTs = rec.ts;
      if (rec.ts > lastTs) lastTs = rec.ts;
    }
    let adds = 0;
    let dels = 0;
    for (const stat of rec.files.values()) {
      adds += stat.additions;
      dels += stat.deletions;
    }
    linesAdded += adds;
    linesDeleted += dels;

    const day = localDay(rec.iso);
    if (day) {
      const cur = perDay.get(day) ?? { date: day, commits: 0, linesAdded: 0, linesDeleted: 0, authors: [] };
      cur.commits += 1;
      cur.linesAdded += adds;
      cur.linesDeleted += dels;
      if (rec.author && !cur.authors.includes(rec.author)) cur.authors.push(rec.author);
      perDay.set(day, cur);
    }

    const wk = isoWeekStart(rec.iso);
    const curW = perWeek.get(wk) ?? { weekStart: wk, commits: 0, linesAdded: 0, linesDeleted: 0, distinctAuthors: 0 };
    curW.commits += 1;
    curW.linesAdded += adds;
    curW.linesDeleted += dels;
    perWeek.set(wk, curW);

    if (rec.author) {
      let weekAuthors = weekAuthorSets.get(wk);
      if (!weekAuthors) {
        weekAuthors = new Set<string>();
        weekAuthorSets.set(wk, weekAuthors);
      }
      weekAuthors.add(rec.author);
    }

    if (rec.author) {
      const a = byAuthor.get(rec.author) ?? {
        name: rec.author,
        commits: 0,
        linesAdded: 0,
        linesDeleted: 0,
        firstCommitTs: rec.ts || 0,
        lastCommitTs: rec.ts || 0,
      };
      a.commits += 1;
      a.linesAdded += adds;
      a.linesDeleted += dels;
      if (rec.ts > 0) {
        if (a.firstCommitTs === 0 || rec.ts < a.firstCommitTs) a.firstCommitTs = rec.ts;
        if (rec.ts > a.lastCommitTs) a.lastCommitTs = rec.ts;
      }
      byAuthor.set(rec.author, a);
    }
  }

  const totalCommits = records.length;
  const firstCommitTs = isFinite(firstTs) ? firstTs : null;
  const lastCommitTs = lastTs >= 0 ? lastTs : null;
  const spanDays = firstCommitTs !== null && lastCommitTs !== null
    ? Math.max(1, Math.floor((lastCommitTs - firstCommitTs) / DAY_MS) + 1)
    : 0;
  const activeDays = perDay.size;

  const busiest = [...perDay.values()].reduce<{ date: string; commits: number } | null>((best, d) => {
    if (!best || d.commits > best.commits || (d.commits === best.commits && d.date > best.date)) {
      return { date: d.date, commits: d.commits };
    }
    return best;
  }, null);

  const authorsDetail: AuthorVelocity[] = [...byAuthor.values()]
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
    .map((a) => ({
      name: a.name,
      commits: a.commits,
      linesAdded: a.linesAdded,
      linesDeleted: a.linesDeleted,
      firstCommitTs: a.firstCommitTs,
      lastCommitTs: a.lastCommitTs,
      pct: totalCommits > 0 ? round1((a.commits / totalCommits) * 100) : 0,
    }));

  const perDayList = [...perDay.values()].sort((a, b) => b.date.localeCompare(a.date));
  const perWeekList = [...perWeek.values()]
    .map((w) => ({ ...w, distinctAuthors: weekAuthorSets.get(w.weekStart)?.size ?? 0 }))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  return {
    commits: totalCommits,
    authorCount: byAuthor.size,
    activeDays,
    spanDays,
    avgCommitsPerDay: spanDays > 0 ? round1(totalCommits / spanDays) : 0,
    avgCommitsPerActiveDay: activeDays > 0 ? round1(totalCommits / activeDays) : 0,
    firstCommitTs,
    lastCommitTs,
    daysSinceLastCommit: lastCommitTs !== null ? Math.max(0, Math.floor((Date.now() - lastCommitTs) / DAY_MS)) : null,
    linesAdded,
    linesDeleted,
    netLines: linesAdded - linesDeleted,
    busiestDay: busiest,
    perDay: perDayList,
    perWeek: perWeekList,
    authorsDetail,
  };
}

function collectFileChurn(records: CommitRecord[]): Map<string, MutableFileChurn> {
  const files = new Map<string, MutableFileChurn>();
  for (const rec of records) {
    for (const [filePath, stat] of rec.files) {
      const cur = files.get(filePath) ?? {
        path: filePath,
        commits: 0,
        additions: 0,
        deletions: 0,
        lastModifiedTs: 0,
        authors: new Set<string>(),
      };
      cur.commits += 1;
      cur.additions += stat.additions;
      cur.deletions += stat.deletions;
      if (rec.ts > cur.lastModifiedTs) cur.lastModifiedTs = rec.ts;
      if (rec.author) cur.authors.add(rec.author);
      files.set(filePath, cur);
    }
  }
  return files;
}

function summarizeChurn(files: Map<string, MutableFileChurn>, topN: number, activeDays: number): ChurnSummary {
  const list: FileChurn[] = [];
  let totalChanges = 0;
  for (const f of files.values()) {
    const total = f.additions + f.deletions;
    totalChanges += total;
    list.push({
      path: f.path,
      commits: f.commits,
      additions: f.additions,
      deletions: f.deletions,
      total,
      lastModifiedTs: f.lastModifiedTs,
      authors: [...f.authors].sort((a, b) => a.localeCompare(b)),
    });
  }

  const byWorst = (a: FileChurn, b: FileChurn): number =>
    b.total - a.total || b.additions - a.additions || a.path.localeCompare(b.path);
  const byChanges = (a: FileChurn, b: FileChurn): number =>
    b.commits - a.commits || b.total - a.total || a.path.localeCompare(b.path);
  const byStable = (a: FileChurn, b: FileChurn): number =>
    a.total - b.total || a.commits - b.commits || a.path.localeCompare(b.path);

  return {
    filesTouched: list.length,
    totalChanges,
    churnPerActiveDay: activeDays > 0 ? round1(totalChanges / activeDays) : 0,
    averageChurnPerFile: list.length > 0 ? round1(totalChanges / list.length) : 0,
    worst: [...list].sort(byWorst).slice(0, topN),
    mostChanged: [...list].sort(byChanges).slice(0, topN),
    stable: [...list].sort(byStable).slice(0, topN),
  };
}

async function mergeWorkingTree(
  repoPath: string,
  files: Map<string, MutableFileChurn>
): Promise<void> {
  const diff = await runGit(repoPath, ["diff", "HEAD", "--numstat"], { allowFail: true });
  for (const line of diff.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [rawAdd, rawDel] = parts;
    if (rawAdd === "-" || rawDel === "-") continue;
    const filePath = parts.slice(2).join("\t").trim();
    if (!filePath) continue;
    const cur = files.get(filePath) ?? {
      path: filePath,
      commits: 0,
      additions: 0,
      deletions: 0,
      lastModifiedTs: Date.now(),
      authors: new Set<string>(),
    };
    cur.additions += parseInt(rawAdd, 10) || 0;
    cur.deletions += parseInt(rawDel, 10) || 0;
    files.set(filePath, cur);
  }

  const untracked = await runGit(repoPath, ["ls-files", "--others", "--exclude-standard"], { allowFail: true });
  for (const rel of untracked.split("\n")) {
    const p = rel.trim();
    if (!p) continue;
    const abs = path.resolve(repoPath, p);
    let lines = 0;
    try {
      const content = fs.readFileSync(abs, "utf8");
      lines = content.split("\n").length;
      if (content.length === 0) lines = 0;
      else if (content.endsWith("\n")) lines -= 1;
    } catch {
      lines = 0;
    }
    if (lines <= 0) continue;
    const cur = files.get(p) ?? {
      path: p,
      commits: 0,
      additions: 0,
      deletions: 0,
      lastModifiedTs: Date.now(),
      authors: new Set<string>(),
    };
    cur.additions += lines;
    files.set(p, cur);
  }
}

export async function getVelocity(repoPath: string, options: GitAnalyzerOptions = {}): Promise<GitVelocity> {
  const records = await scanCommits(repoPath, options);
  return buildVelocity(records);
}

export async function getChurn(repoPath: string, options: GitAnalyzerOptions = {}): Promise<ChurnSummary> {
  const records = await scanCommits(repoPath, options);
  const files = collectFileChurn(records);
  let activeDays = countActiveDays(records);
  if (options.includeUncommitted) {
    mergeWorkingTree(repoPath, files);
    activeDays = Math.max(activeDays, 1);
  }
  return summarizeChurn(files, options.top ?? DEFAULT_TOP, activeDays);
}

export async function analyzeGitRepo(repoPath: string, options: GitAnalyzerOptions = {}): Promise<GitAnalysisResult> {
  const records = await scanCommits(repoPath, options);
  const velocity = buildVelocity(records);
  const files = collectFileChurn(records);
  let activeDays = velocity.activeDays;
  if (options.includeUncommitted) {
    mergeWorkingTree(repoPath, files);
    activeDays = Math.max(activeDays, 1);
  }
  const churn = summarizeChurn(files, options.top ?? DEFAULT_TOP, activeDays);
  const branch = (await runGit(repoPath, ["branch", "--show-current"], { allowFail: true })).trim();
  return {
    repoPath: path.resolve(repoPath),
    branch,
    generatedAt: Date.now(),
    window: { since: options.since ?? null, until: options.until ?? null },
    velocity,
    churn,
  };
}