import { z } from "zod";

export const retrievalInput = z.object({
  query: z.string().max(4000).optional(),
  max_tokens: z.number().int().min(1).max(10000).optional(),
  scopes: z.array(z.enum(["project_shared", "agent_private", "task"])).optional(),
  types: z.array(z.enum(["fact", "discovery", "constraint", "note"])).optional(),
  task_id: z.string().optional(),
  taskId: z.string().optional(),
});
