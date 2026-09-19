#!/usr/bin/env node

/**
 * GridMind MCP CLI entrypoint
 *
 * Connects the GridMind MCP server over stdio transport.
 * Requires:
 *   GRIDMIND_API   - GridMind server base URL (e.g. http://localhost:3000)
 *   GRIDMIND_TOKEN - Authenticated agent session Bearer token
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGridMindMcpServer } from "./server";

async function main() {
  const apiUrl = process.env.GRIDMIND_API?.trim();
  const token = process.env.GRIDMIND_TOKEN?.trim();

  if (!apiUrl) {
    process.stderr.write("Error: GRIDMIND_API environment variable is missing.\n");
    process.stderr.write("Usage: GRIDMIND_API=http://localhost:3000 GRIDMIND_TOKEN=<token> node dist/mcp/cli.mjs\n");
    process.exit(1);
  }

  if (!token) {
    process.stderr.write("Error: GRIDMIND_TOKEN environment variable is missing.\n");
    process.stderr.write("Usage: GRIDMIND_API=http://localhost:3000 GRIDMIND_TOKEN=<token> node dist/mcp/cli.mjs\n");
    process.exit(1);
  }

  const server = createGridMindMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`GridMind MCP Server fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
