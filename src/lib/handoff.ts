/**
 * Stage 5B: Agent Handoffs Context & Retrieval
 *
 * Provides structured formatting, delimiter escaping, priority ranking,
 * and token budget packing for agent handoffs.
 */

import { listHandoffs, getTask, type Handoff } from "./db";
import { estimateTokens, sanitizeMemoryContent } from "./memory";

export type ScoredHandoff = Handoff & {
  score: number;
  sourceTaskTitle: string;
};

export type TaskHandoffsResult = {
  handoffs: ScoredHandoff[];
  handoffsBrief: string;
  tokensUsed: number;
  totalCandidates: number;
  omittedCount: number;
};

/**
 * Format a single handoff as a compact, structured markdown block.
 */
export function formatHandoffBlock(handoff: Handoff, sourceTaskTitle?: string): string {
  const title = sourceTaskTitle || handoff.source_task_id;
  const lines: string[] = [];

  lines.push(`[HANDOFF ${handoff.id}]`);
  lines.push(`From task: ${sanitizeMemoryContent(title)} (${handoff.source_task_id})`);
  lines.push(`Status: ${handoff.status}`);
  lines.push("");
  lines.push("Summary:");
  lines.push(sanitizeMemoryContent(handoff.summary));
  lines.push("");
  lines.push("Completed:");
  lines.push(sanitizeMemoryContent(handoff.completed_work));

  if (handoff.commit_sha) {
    lines.push("");
    lines.push(`Commit: ${sanitizeMemoryContent(handoff.commit_sha)}`);
  }
  if (handoff.branch) {
    lines.push(`Branch: ${sanitizeMemoryContent(handoff.branch)}`);
  }

  if (handoff.changed_files && handoff.changed_files.length > 0) {
    lines.push("");
    lines.push("Changed files:");
    lines.push(handoff.changed_files.map((f) => `- ${sanitizeMemoryContent(f)}`).join("\n"));
  }

  if (handoff.decisions && handoff.decisions.length > 0) {
    lines.push("");
    lines.push("Decisions:");
    lines.push(handoff.decisions.map((d) => `- ${sanitizeMemoryContent(d)}`).join("\n"));
  }

  if (handoff.blockers && handoff.blockers.length > 0) {
    lines.push("");
    lines.push("Blockers:");
    lines.push(handoff.blockers.map((b) => `- ${sanitizeMemoryContent(b)}`).join("\n"));
  }

  if (handoff.next_steps && handoff.next_steps.length > 0) {
    lines.push("");
    lines.push("Next steps:");
    lines.push(handoff.next_steps.map((n) => `- ${sanitizeMemoryContent(n)}`).join("\n"));
  }

  return lines.join("\n");
}

/**
 * Score a handoff for token-budgeted context injection.
 * Priority:
 * 1. Pending handoffs (needs attention first)
 * 2. Handoffs containing blockers / next steps
 * 3. Most recent handoffs
 * 4. Accepted handoffs if budget remains
 */
function scoreHandoff(handoff: Handoff): number {
  let score = 0;

  // 1. Pending priority (+100) vs accepted (+50)
  if (handoff.status === "pending") {
    score += 100;
  } else if (handoff.status === "accepted") {
    score += 50;
  }

  // 2. Actionable info: blockers (+30), next steps (+20)
  if (handoff.blockers && handoff.blockers.length > 0) {
    score += 30;
  }
  if (handoff.next_steps && handoff.next_steps.length > 0) {
    score += 20;
  }

  // 3. Recency boost (up to 15 points decaying over time)
  const ageDays = Math.floor((Date.now() - handoff.created_at) / (1000 * 60 * 60 * 24));
  const recency = Math.max(0, 15 - ageDays);
  score += recency;

  return score;
}

/**
 * Retrieve, rank, and pack relevant handoffs targeted at a specific task.
 */
export function retrieveTaskHandoffs(options: {
  projectId: string;
  taskId: string;
  maxTokens?: number; // default 600 tokens (~2400 chars)
}): TaskHandoffsResult {
  const { projectId, taskId, maxTokens = 600 } = options;

  // 1. Retrieve all pending or accepted handoffs targeted at this task
  const allHandoffs = listHandoffs(projectId, { target_task_id: taskId });
  const relevantCandidates = allHandoffs.filter(
    (h) => h.status === "pending" || h.status === "accepted"
  );

  const totalCandidates = relevantCandidates.length;
  if (totalCandidates === 0) {
    return {
      handoffs: [],
      handoffsBrief: "",
      tokensUsed: 0,
      totalCandidates: 0,
      omittedCount: 0,
    };
  }

  // 2. Resolve source task titles for clean display
  const taskTitleMap = new Map<string, string>();
  for (const h of relevantCandidates) {
    if (!taskTitleMap.has(h.source_task_id)) {
      const srcTask = getTask(projectId, h.source_task_id);
      taskTitleMap.set(h.source_task_id, srcTask?.title || h.source_task_id);
    }
  }

  // 3. Score candidates
  const scored: ScoredHandoff[] = relevantCandidates.map((h) => ({
    ...h,
    score: scoreHandoff(h),
    sourceTaskTitle: taskTitleMap.get(h.source_task_id) || h.source_task_id,
  }));

  // Sort descending by score, tie-break by created_at DESC
  scored.sort((a, b) => b.score - a.score || b.created_at - a.created_at);

  // 4. Token budget packing
  const selected: ScoredHandoff[] = [];
  let currentTokens = 0;
  let omittedCount = 0;

  // Reserve ~20 tokens for section header
  const budgetLimit = Math.max(50, maxTokens - 20);

  for (const item of scored) {
    const block = formatHandoffBlock(item, item.sourceTaskTitle);
    const blockTokens = estimateTokens(block + "\n\n");

    if (currentTokens + blockTokens <= budgetLimit) {
      selected.push(item);
      currentTokens += blockTokens;
    } else {
      omittedCount++;
    }
  }

  if (selected.length === 0) {
    return {
      handoffs: [],
      handoffsBrief: "",
      tokensUsed: 0,
      totalCandidates,
      omittedCount,
    };
  }

  // 5. Build formatted brief
  const blocks = selected.map((item) => formatHandoffBlock(item, item.sourceTaskTitle));
  if (omittedCount > 0) {
    blocks.push(`[... ${omittedCount} older handoff(s) omitted for brevity]`);
  }

  const handoffsBrief = "--- RELEVANT HANDOFFS ---\n\n" + blocks.join("\n\n---\n\n");
  const tokensUsed = estimateTokens(handoffsBrief);

  return {
    handoffs: selected,
    handoffsBrief,
    tokensUsed,
    totalCandidates,
    omittedCount,
  };
}
