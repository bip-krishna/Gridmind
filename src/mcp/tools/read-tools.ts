import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GridMindClient } from "../client";

/**
 * Register READ MCP tools for GridMind
 */
export function registerReadTools(server: McpServer, client: GridMindClient) {
  // 1. gridmind_get_session_context
  server.tool(
    "gridmind_get_session_context",
    "Discover the authenticated agent's session, project, task assignment, role, and identity. Identity is derived strictly from server authentication.",
    async () => {
      try {
        const result = await client.getSessionContext();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                session_id: result.session_id,
                project_id: result.project_id,
                task_id: result.task_id,
                role: result.role,
                agent_type: result.agent_type,
                title: result.title,
                status: result.status,
                project: result.project,
                task: result.task,
              }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get session context: ${message}` }],
        };
      }
    }
  );

  // 2. gridmind_get_context
  server.tool(
    "gridmind_get_context",
    "Retrieve project and task context brief for the authenticated session. Workers automatically receive context for their assigned task. Masters may optionally specify a task_id within the project.",
    {
      task_id: z.string().optional().describe("Optional task ID. Workers must only specify their assigned task; masters can specify any task in the project."),
    },
    async ({ task_id }) => {
      try {
        const result = await client.getContext(task_id);
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
          content: [{ type: "text", text: `Failed to get context: ${message}` }],
        };
      }
    }
  );

  // 3. gridmind_search_memory
  server.tool(
    "gridmind_search_memory",
    "Search and retrieve project memories, private notes, and task context with relevance scoring and token budget compaction. Workers are strictly isolated to their own task and private notes; masters can target project tasks.",
    {
      query: z.string().optional().describe("Natural language search query or keywords"),
      category: z.string().optional().describe("Optional category or scope filter (fact, discovery, constraint, note, project_shared, agent_private, task)"),
      limit: z.number().int().positive().optional().describe("Maximum token budget for retrieved context (default 1000)"),
      task_id: z.string().optional().describe("Target task ID (master role only)"),
    },
    async ({ query, category, limit, task_id }) => {
      try {
        const result = await client.searchMemory({
          query,
          category,
          limit,
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
          content: [{ type: "text", text: `Failed to search memory: ${message}` }],
        };
      }
    }
  );

  // 5. gridmind_get_task
  server.tool(
    "gridmind_get_task",
    "Inspect task requirements, status, priority, and branch. Workers can only inspect their assigned task; masters can inspect any task in the project.",
    {
      task_id: z.string().optional().describe("Task ID (defaults to assigned task for workers)"),
    },
    async ({ task_id }) => {
      try {
        const result = await client.getTask(task_id);
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
          content: [{ type: "text", text: `Failed to get task: ${message}` }],
        };
      }
    }
  );
}
