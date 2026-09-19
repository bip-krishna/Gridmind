import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GridMindClient, type GridMindClientOptions } from "./client";
import { registerReadTools } from "./tools/read-tools";
import { registerWriteTools } from "./tools/write-tools";

export type ServerOptions = {
  client?: GridMindClient;
  clientOptions?: GridMindClientOptions;
};

/**
 * Creates and configures the GridMind MCP Server with all 8 Phase-1 tools.
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

  return server;
}
