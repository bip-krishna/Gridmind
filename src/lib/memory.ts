/**
 * Stage 4 Phase 2: Project-Scoped Memory Retrieval.
 *
 * Implements deterministic candidate selection, scope/visibility filtering,
 * relevance scoring, token budget packing, and context brief generation.
 */

import {
  listMemories,
  type Memory,
  type MemoryScope,
} from "./db";

export type ScoredMemory = Memory & {
  score: number;
  relevance_reasons: string[];
};

export type RetrieveMemoryOptions = {
  projectId: string;
  sessionId?: string | null;
  taskId?: string | null;
  query?: string | null;
  maxTokens?: number; // Default 1,000 tokens (~4,000 chars)
  scopes?: MemoryScope[];
};

export type RetrievalResult = {
  memories: ScoredMemory[];
  contextBrief: string;
  tokensUsed: number;
  totalCandidates: number;
  omittedCount: number;
};

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "have", "will",
  "what", "when", "where", "which", "about", "into", "some", "them",
  "then", "there", "these", "they", "been", "more", "also", "your",
  "only", "code", "file", "make", "need", "test", "task", "work",
]);

/**
 * Extract meaningful search keywords from a query string.
 */
function extractKeywords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\w\d_./\\-]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return Array.from(new Set(words));
}

/**
 * Score a candidate memory against retrieval criteria.
 */
function scoreCandidate(
  memory: Memory,
  keywords: string[],
  rawQuery: string | null
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. Base score by scope and type
  if (memory.scope === "task") {
    if (memory.type === "constraint") {
      score += 50;
      reasons.push("task constraint (+50)");
    } else if (memory.type === "discovery") {
      score += 45;
      reasons.push("task discovery (+45)");
    } else {
      score += 30;
      reasons.push("task memory (+30)");
    }
  } else if (memory.scope === "project_shared") {
    if (memory.type === "constraint") {
      score += 45;
      reasons.push("project constraint (+45)");
    } else if (memory.type === "fact") {
      score += 40;
      reasons.push("project fact (+40)");
    } else if (memory.type === "discovery") {
      score += 35;
      reasons.push("project discovery (+35)");
    } else {
      score += 25;
      reasons.push("project note (+25)");
    }
  } else if (memory.scope === "agent_private") {
    score += 20;
    reasons.push("private note (+20)");
  }

  // 2. Importance multiplier
  const importanceBoost = (memory.importance || 1) * 15;
  score += importanceBoost;
  reasons.push(`importance ${memory.importance} (+${importanceBoost})`);

  // 3. Keyword / Text Relevance
  const contentLower = memory.content.toLowerCase();

  // Exact phrase match
  if (rawQuery && rawQuery.trim().length >= 4 && contentLower.includes(rawQuery.trim().toLowerCase())) {
    score += 30;
    reasons.push("exact phrase match (+30)");
  }

  // Individual keyword overlap
  let keywordPoints = 0;
  for (const kw of keywords) {
    if (contentLower.includes(kw)) {
      keywordPoints += 15;
      reasons.push(`keyword match "${kw}" (+15)`);
      if (keywordPoints >= 60) break; // cap keyword points at 60
    }
  }
  score += keywordPoints;

  // File path / extension detection
  for (const kw of keywords) {
    if ((kw.includes("/") || kw.includes(".")) && contentLower.includes(kw)) {
      score += 25;
      reasons.push(`file/path match "${kw}" (+25)`);
      break;
    }
  }

  // 4. Recency boost (up to 10 points decaying 1 pt/day)
  const ageDays = Math.floor((Date.now() - memory.created_at) / (1000 * 60 * 60 * 24));
  const recency = Math.max(0, 10 - ageDays);
  if (recency > 0) {
    score += recency;
    reasons.push(`recency (${recency}d) (+${recency})`);
  }

  return { score, reasons };
}

/**
 * Safely escape memory content to prevent prompt delimiter termination (SEC-05).
 */
export function sanitizeMemoryContent(content: string): string {
  return content.replace(/---/g, "-\\-\\-\\");
}

/**
 * Format a single memory for inclusion in context brief.
 */
function formatMemoryLine(memory: Memory): string {
  const impBadge = memory.importance > 1 ? ` [★${memory.importance}]` : "";
  const safeContent = sanitizeMemoryContent(memory.content);
  return `- [${memory.type}]${impBadge} ${safeContent}`;
}

/**
 * Estimate token count from string length (1 token ≈ 4 chars).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Retrieve, rank, filter, and budget-compact project-scoped memories.
 */
export function retrieveMemories(options: RetrieveMemoryOptions): RetrievalResult {
  const { projectId, sessionId, taskId, query, maxTokens = 1000, scopes } = options;

  // 1. Fetch unarchived memories for project
  // We fetch all active memories for the project and apply visibility in memory for complete control
  const allActive = listMemories(projectId, { includeArchived: false });

  // 2. Apply Visibility Rules
  const candidates: Memory[] = [];
  for (const m of allActive) {
    // If specific scopes were requested, enforce them
    if (scopes && !scopes.includes(m.scope)) {
      continue;
    }

    if (m.scope === "project_shared") {
      // Shared: visible to all sessions in this project
      candidates.push(m);
    } else if (m.scope === "task") {
      // Task: visible only if assigned to the same task
      if (taskId && m.task_id === taskId) {
        candidates.push(m);
      }
    } else if (m.scope === "agent_private") {
      // Private: visible ONLY to the creating session
      if (sessionId && m.session_id === sessionId) {
        candidates.push(m);
      }
    }
  }

  const totalCandidates = candidates.length;
  if (totalCandidates === 0) {
    return {
      memories: [],
      contextBrief: "",
      tokensUsed: 0,
      totalCandidates: 0,
      omittedCount: 0,
    };
  }

  // 3. Relevance Scoring
  const keywords = query ? extractKeywords(query) : [];
  const scored: ScoredMemory[] = candidates.map((m) => {
    const { score, reasons } = scoreCandidate(m, keywords, query ?? null);
    return {
      ...m,
      score,
      relevance_reasons: reasons,
    };
  });

  // Sort descending by score, tie-break by created_at DESC
  scored.sort((a, b) => b.score - a.score || b.created_at - a.created_at);

  // 4. Token Budget Packing
  // Group scored candidates into scope buckets while respecting total token limit
  const selected: ScoredMemory[] = [];
  let currentTokens = 0;
  let omittedCount = 0;

  // Header/formatting tokens reserve (~30 tokens)
  const budgetLimit = Math.max(50, maxTokens - 30);

  for (const mem of scored) {
    const line = formatMemoryLine(mem);
    const lineTokens = estimateTokens(line + "\n");

    if (currentTokens + lineTokens <= budgetLimit) {
      selected.push(mem);
      currentTokens += lineTokens;
    } else {
      omittedCount++;
    }
  }

  // 5. Build Formatted Context Brief
  if (selected.length === 0) {
    return {
      memories: [],
      contextBrief: "",
      tokensUsed: 0,
      totalCandidates,
      omittedCount,
    };
  }

  const sharedItems = selected.filter((m) => m.scope === "project_shared");
  const taskItems = selected.filter((m) => m.scope === "task");
  const privateItems = selected.filter((m) => m.scope === "agent_private");

  const sections: string[] = [];

  if (sharedItems.length > 0) {
    sections.push(
      "[PROJECT SHARED KNOWLEDGE]\n" +
        sharedItems.map(formatMemoryLine).join("\n")
    );
  }

  if (taskItems.length > 0) {
    sections.push(
      "[CURRENT TASK CONTEXT]\n" +
        taskItems.map(formatMemoryLine).join("\n")
    );
  }

  if (privateItems.length > 0) {
    sections.push(
      "[YOUR PRIVATE NOTES]\n" +
        privateItems.map(formatMemoryLine).join("\n")
    );
  }

  if (omittedCount > 0) {
    sections.push(`[... ${omittedCount} lower-priority memories omitted for brevity]`);
  }

  const contextBrief = sections.join("\n\n");
  const tokensUsed = estimateTokens(contextBrief);

  return {
    memories: selected,
    contextBrief,
    tokensUsed,
    totalCandidates,
    omittedCount,
  };
}
