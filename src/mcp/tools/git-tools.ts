import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GridMindClient } from "../client";

/**
 * Register STAGE 5C GIT MCP tools for GridMind
 */
export function registerGitTools(server: McpServer, client: GridMindClient) {
  // 1. gridmind_git_status
  server.tool(
    "gridmind_git_status",
    "Inspect the Git status (branch, clean/dirty, changed files, untracked files, ahead/behind) of the authenticated task worktree.",
    {
      task_id: z.string().optional().describe("Task ID (only for master role; workers automatically use assigned task worktree)"),
    },
    async ({ task_id }) => {
      try {
        const result = await client.gitStatus({ taskId: task_id });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Git status failed: ${message}` }],
        };
      }
    }
  );

  // 2. gridmind_git_diff
  server.tool(
    "gridmind_git_diff",
    "View bounded diff of the authenticated task worktree. Supports optional relative file path, staged changes, or a specific commit SHA.",
    {
      path: z.string().optional().describe("Optional relative file path inside the worktree (path traversal is forbidden)"),
      staged: z.boolean().optional().describe("If true, show staged changes; if false/omitted, show unstaged working tree changes"),
      commit: z.string().optional().describe("Optional commit SHA to inspect diff for (e.g. referenced from a handoff)"),
      task_id: z.string().optional().describe("Task ID (only for master role; workers automatically use assigned task worktree)"),
    },
    async ({ path, staged, commit, task_id }) => {
      try {
        const result = await client.gitDiff({ path, staged, commit, taskId: task_id });
        return {
          content: [
            {
              type: "text",
              text: result.diff || (staged ? "(no staged changes)" : "(no working tree changes)"),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Git diff failed: ${message}` }],
        };
      }
    }
  );

  // 3. gridmind_git_commit
  server.tool(
    "gridmind_git_commit",
    "Stage and commit all working changes in the authenticated task worktree. Publishes git:commit event and records commit metadata in GridMind.",
    {
      message: z.string().min(1).max(500).describe("Commit message describing the completed changes"),
      task_id: z.string().optional().describe("Task ID (only for master role; workers automatically use assigned task worktree)"),
    },
    async ({ message, task_id }) => {
      try {
        const result = await client.gitCommit({ message, taskId: task_id });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Git commit failed: ${message}` }],
        };
      }
    }
  );

  // 4. gridmind_git_branches
  server.tool(
    "gridmind_git_branches",
    "List repository branches and view current branch for the authenticated task worktree.",
    {
      task_id: z.string().optional().describe("Task ID (only for master role; workers automatically use assigned task worktree)"),
    },
    async ({ task_id }) => {
      try {
        const result = await client.gitBranches({ taskId: task_id });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Git branches failed: ${message}` }],
        };
      }
    }
  );

  // 5. gridmind_git_log
  server.tool(
    "gridmind_git_log",
    "Inspect a bounded list of recent Git commits (SHA, message, author, date) in the authenticated worktree.",
    {
      limit: z.number().int().min(1).optional().describe("Number of commits to retrieve (default: 10, max: 50)"),
      commit: z.string().optional().describe("Optional commit SHA to inspect a single commit"),
      task_id: z.string().optional().describe("Task ID (only for master role; workers automatically use assigned task worktree)"),
    },
    async ({ limit, commit, task_id }) => {
      try {
        const result = await client.gitLog({ limit, commit, taskId: task_id });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Git log failed: ${message}` }],
        };
      }
    }
  );
}
