import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GridMindClient } from "../client";

/**
 * Register WRITE MCP tools for GridMind
 */
export function registerWriteTools(server: McpServer, client: GridMindClient) {
  // 4. gridmind_record_memory
  server.tool(
    "gridmind_record_memory",
    "Record a persistent memory into GridMind. Scope can be project_shared (visible to team), agent_private (visible only to this session), or task (attached to task context). Content is limited to 4000 characters.",
    {
      scope: z.enum(["project_shared", "agent_private", "task"]).describe("Visibility scope: project_shared, agent_private, or task"),
      category: z.enum(["fact", "discovery", "constraint", "note"]).optional().describe("Memory classification (default: note)"),
      title: z.string().optional().describe("Optional brief title"),
      content: z.string().min(1).max(4000).describe("Memory content (max 4000 characters)"),
      importance: z.number().int().min(1).max(3).optional().describe("1=normal, 2=important, 3=critical (default: 1)"),
      task_id: z.string().optional().describe("Target task ID (only for master role when scope=task; workers automatically use assigned task)"),
    },
    async ({ scope, category, title, content, importance, task_id }) => {
      try {
        const result = await client.recordMemory({
          scope,
          category,
          title,
          content,
          importance,
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
          content: [{ type: "text", text: `Failed to record memory: ${message}` }],
        };
      }
    }
  );

  // 6. gridmind_update_task_status
  server.tool(
    "gridmind_update_task_status",
    "Update task lifecycle status following valid state transitions (todo -> queued/in_progress; in_progress -> done/failed/blocked). Workers can only update their assigned task.",
    {
      status: z.enum(["queued", "in_progress", "blocked", "done", "failed"]).describe("Target task status"),
      description: z.string().optional().describe("Optional update note or explanation of progress/blocker"),
      task_id: z.string().optional().describe("Task ID (defaults to assigned task for workers; master can specify project task)"),
    },
    async ({ status, description, task_id }) => {
      try {
        const result = await client.updateTaskStatus({
          status,
          description,
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
          content: [{ type: "text", text: `Failed to update task status: ${message}` }],
        };
      }
    }
  );

  // 7. gridmind_record_decision
  server.tool(
    "gridmind_record_decision",
    "Record an architectural or engineering decision made by the agent for the project. Preserved and visible in the GridMind project dashboard.",
    {
      title: z.string().min(1).describe("Short title of the decision"),
      body: z.string().min(1).describe("Detailed explanation, rationale, and consequences of the decision"),
    },
    async ({ title, body }) => {
      try {
        const result = await client.recordDecision({ title, body });
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
          content: [{ type: "text", text: `Failed to record decision: ${message}` }],
        };
      }
    }
  );

  // 8. gridmind_emit_event
  server.tool(
    "gridmind_emit_event",
    "Emit a real-time progress or status event to the GridMind project event stream (visible on the web dashboard).",
    {
      type: z.enum(["agent:status", "agent:progress", "agent:decision", "agent:result"]).describe("Event type"),
      message: z.string().optional().describe("Optional status message"),
      payload: z.record(z.string(), z.unknown()).optional().describe("Optional structured metadata object"),
    },
    async ({ type, message, payload }) => {
      try {
        const result = await client.emitEvent({ type, message, payload });
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
          content: [{ type: "text", text: `Failed to emit event: ${message}` }],
        };
      }
    }
  );
}
