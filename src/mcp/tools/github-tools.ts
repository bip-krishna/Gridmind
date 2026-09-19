import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GridMindClient } from "../client";

/**
 * Register STAGE 5C GITHUB MCP tools for GridMind
 */
export function registerGithubTools(server: McpServer, client: GridMindClient) {
  // 6. gridmind_github_issues
  server.tool(
    "gridmind_github_issues",
    "List issues from the project-configured GitHub repository. Repository is governed by project configuration; arbitrary repository injection is rejected.",
    {
      limit: z.number().int().min(1).max(50).optional().describe("Maximum issues to return (default: 30, max: 50)"),
    },
    async ({ limit }) => {
      try {
        const result = await client.githubIssues({ limit });
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
          content: [{ type: "text", text: `GitHub issues lookup failed: ${message}` }],
        };
      }
    }
  );

  // 7. gridmind_github_create_pr
  server.tool(
    "gridmind_github_create_pr",
    "Create a GitHub Pull Request for the task branch against the project-configured repository. Project configuration governs owner/repo; tokens are never exposed.",
    {
      title: z.string().min(1).max(200).describe("Pull request title"),
      body: z.string().max(4000).optional().describe("Pull request description / summary of changes"),
      head_branch: z.string().min(1).describe("The branch containing your commits (e.g. task worktree branch)"),
      base_branch: z.string().optional().describe("Target base branch (default: main)"),
      task_id: z.string().optional().describe("Task ID (only for master role; workers automatically use assigned task)"),
    },
    async ({ title, body, head_branch, base_branch, task_id }) => {
      try {
        const result = await client.githubCreatePr({
          title,
          body,
          headBranch: head_branch,
          baseBranch: base_branch,
          taskId: task_id,
        });
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
          content: [{ type: "text", text: `Failed to create pull request: ${message}` }],
        };
      }
    }
  );

  // 8. gridmind_github_issue_to_task
  server.tool(
    "gridmind_github_issue_to_task",
    "Import a GitHub issue from the project-configured repository and create a new linked GridMind task.",
    {
      issue_number: z.number().int().positive().describe("GitHub issue number to convert into a GridMind task"),
    },
    async ({ issue_number }) => {
      try {
        const result = await client.githubIssueToTask(issue_number);
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
          content: [{ type: "text", text: `Failed to import issue to task: ${message}` }],
        };
      }
    }
  );
}
