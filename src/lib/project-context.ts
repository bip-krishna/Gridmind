import { buildContextBrief, listDecisions } from "./db";
import { flushMemoryCaptures } from "./memory-capture";
import { estimateTokens, retrieveMemories, sanitizeMemoryContent, type RetrieveMemoryOptions } from "./memory";

/** Shared assembly path for spawned agents and external MCP clients. */
export function retrieveProjectContext(options: RetrieveMemoryOptions) {
  const capture = flushMemoryCaptures(options.projectId);
  const result = retrieveMemories(options);
  const projectBrief = buildContextBrief(options.projectId);
  const contextBrief = [
    projectBrief === "(no project context set)" ? "" : `[PROJECT CONTEXT]\n${sanitizeMemoryContent(projectBrief)}`,
    result.contextBrief,
  ].filter(Boolean).join("\n\n");
  return {
    ...result,
    capture,
    memoryTokensUsed: result.tokensUsed,
    tokensUsed: estimateTokens(contextBrief),
    decisions: listDecisions(options.projectId).filter((d) => d.status !== "superseded"),
    contextBrief,
  };
}
