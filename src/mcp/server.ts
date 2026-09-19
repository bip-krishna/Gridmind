import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GridMindClient, type GridMindClientOptions } from "./client";
import { registerReadTools } from "./tools/read-tools";
import { registerWriteTools } from "./tools/write-tools";
import { registerHandoffTools } from "./tools/handoff-tools";
import { registerGitTools } from "./tools/git-tools";
import { registerGithubTools } from "./tools/github-tools";

export type ServerOptions = {
  client?: GridMindClient;
  clientOptions?: GridMindClientOptions;
};

/**
 * Creates and configures the GridMind MCP Server with all 19 tools:
 * - Read tools (4)
 * - Write tools (4)
 * - Handoff tools (3)
 * - Git tools (5)
 * - GitHub tools (3)
 */
export function createGridMindMcpServer(options?: ServerOptions): McpServer {
  const server = new McpServer({
    name: "gridmind",
    version: "0.1.0",
  });

  const client = options?.client ?? new GridMindClient(options?.clientOptions);

  // Register READ tools (1. get_session_context, 2. get_context, 3. search_memory, 5. get_task)
  registerReadTools(server, client);

  // Register WRITE tools (4. record_memory, 6. update_task_status, 7. record_decision, 8. emit_event)
  registerWriteTools(server, client);

  // Register HANDOFF tools (Stage 5B: create_handoff, get_handoffs, accept_handoff)
  registerHandoffTools(server, client);

  // Register GIT tools (Stage 5C: git_status, git_diff, git_commit, git_branches, git_log)
  registerGitTools(server, client);

  // Register GITHUB tools (Stage 5C: github_issues, github_create_pr, github_issue_to_task)
  registerGithubTools(server, client);

  return server;
}
