import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GridMindClient } from "../client";

/**
 * Register STAGE 5B HANDOFF MCP tools for GridMind
 */
export function registerHandoffTools(server: McpServer, client: GridMindClient) {
  // 1. gridmind_create_handoff
  server.tool(
    "gridmind_create_handoff",
    "Create a structured handoff to pass completed work, decisions, blockers, and next steps to another task in the project. Source session, source task, and project are derived strictly from the authenticated session.",
    {
      target_task_id: z.string().min(1).describe("Target task ID to receive this handoff (must belong to the same project)"),
      summary: z.string().min(1).max(1000).describe("Concise summary of work completed / status (max 1000 chars)"),
      completed_work: z.string().min(1).max(4000).describe("Detailed technical explanation of completed work (max 4000 chars)"),
      changed_files: z.array(z.string().max(200)).max(50).optional().describe("List of modified or created file paths"),
      decisions: z.array(z.string().max(500)).max(20).optional().describe("Key architectural or technical decisions made"),
      blockers: z.array(z.string().max(500)).max(20).optional().describe("Known blockers or dependencies for the receiving agent"),
      next_steps: z.array(z.string().max(500)).max(20).optional().describe("Recommended next steps for the receiving task"),
      commit_sha: z.string().max(40).optional().describe("Optional Git commit SHA associated with this handoff"),
      branch: z.string().max(100).optional().describe("Optional branch name associated with this handoff"),
    },
    async ({ target_task_id, summary, completed_work, changed_files, decisions, blockers, next_steps, commit_sha, branch }) => {
      try {
        const result = await client.createHandoff({
          targetTaskId: target_task_id,
          summary,
          completedWork: completed_work,
          changedFiles: changed_files,
          decisions,
          blockers,
          nextSteps: next_steps,
          commitSha: commit_sha,
          branch,
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
          content: [{ type: "text", text: `Failed to create handoff: ${message}` }],
        };
      }
    }
  );

  // 2. gridmind_get_handoffs
  server.tool(
    "gridmind_get_handoffs",
    "Retrieve structured handoffs. Workers automatically receive handoffs relevant to their assigned task. Masters may query across project tasks.",
    {
      task_id: z.string().optional().describe("Optional task ID filter (workers can only specify assigned task; masters can query project tasks)"),
      status: z.enum(["pending", "accepted", "completed", "cancelled"]).optional().describe("Filter by handoff status"),
    },
    async ({ task_id, status }) => {
      try {
        const result = await client.getHandoffs({ taskId: task_id, status });
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
          content: [{ type: "text", text: `Failed to get handoffs: ${message}` }],
        };
      }
    }
  );

  // 3. gridmind_accept_handoff
  server.tool(
    "gridmind_accept_handoff",
    "Accept and consume a handoff targeted at your assigned task. Idempotent: returning existing accepted record if already accepted.",
    {
      handoff_id: z.string().min(1).describe("ID of the handoff to accept"),
    },
    async ({ handoff_id }) => {
      try {
        const result = await client.acceptHandoff(handoff_id);
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
          content: [{ type: "text", text: `Failed to accept handoff: ${message}` }],
        };
      }
    }
  );
}
