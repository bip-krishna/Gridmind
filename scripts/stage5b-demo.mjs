#!/usr/bin/env node

/**
 * Stage 5B Manual Demo: Agent A → GridMind → Handoff → Agent B
 *
 * Demonstrates the full coordination flow:
 * 1. Create Task A and Task B in Project
 * 2. Start Agent A on Task A
 * 3. Agent A calls gridmind_create_handoff targeting Task B
 * 4. Verify in GridMind UI API (Task A → Handoff → Task B, status = pending)
 * 5. Start Agent B on Task B
 * 6. Agent B calls gridmind_get_handoffs to discover incoming handoff
 * 7. Agent B calls gridmind_accept_handoff
 * 8. Verify handoff status = accepted in GridMind
 * 9. Agent B continues work informed by the handoff and completes task
 */

import { execSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BASE = process.env.GRIDMIND_API || "http://localhost:3000";

async function api(method, urlPath, body, headers) {
  const reqHeaders = Object.assign({ "Content-Type": "application/json" }, headers || {});
  const opts = { method, headers: reqHeaders };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + urlPath, opts);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, data };
}

function parseToolText(res) {
  if (!res || !res.content || !res.content[0] || !res.content[0].text) return null;
  try {
    return JSON.parse(res.content[0].text);
  } catch {
    return res.content[0].text;
  }
}

async function createMcpClientForToken(token) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/mcp/cli.mjs"],
    env: {
      ...process.env,
      GRIDMIND_API: BASE,
      GRIDMIND_TOKEN: token,
    },
  });
  const client = new Client({ name: "demo-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

async function runDemo() {
  console.log("==================================================");
  console.log("STAGE 5B: LIVE AGENT HANDOFF DEMO (Agent A → Agent B)");
  console.log("==================================================");

  // 1. Setup Demo Git Repo & Project
  console.log("\n[1] Creating Project & Repository...");
  const demoRepo = "/tmp/gm-stage5b-live-demo";
  execSync(`rm -rf ${demoRepo} && mkdir -p ${demoRepo}`);
  execSync(`cd ${demoRepo} && git init -q && git config user.email demo@gridmind.dev && git config user.name "GridMind Demo" && echo "# Stage 5B Demo App" > README.md && git add -A && git commit -qm "initial commit"`);

  const projRes = await api("POST", "/api/projects", {
    name: "Autonomous Platform",
    repo_path: demoRepo,
  });
  if (projRes.status !== 201) throw new Error(`Failed to create project: ${projRes.status} ${JSON.stringify(projRes.data)}`);
  const project = projRes.data.project;
  console.log(`    ✓ Project created: "${project.name}" (ID: ${project.id})`);

  // 2. Create Task A and Task B
  console.log("\n[2] Creating Tasks A and B...");
  const taskARes = await api("POST", `/api/projects/${project.id}/tasks`, {
    title: "Task A: Implement Authentication Core",
    description: "Build JWT signing, password hashing, and authorization middleware",
    priority: "high",
  });
  const taskA = taskARes.data.task;
  console.log(`    ✓ Task A created: "${taskA.title}" (ID: ${taskA.id})`);

  const taskBRes = await api("POST", `/api/projects/${project.id}/tasks`, {
    title: "Task B: Implement User Profile Dashboard",
    description: "Create user dashboard protected by auth middleware with profile viewer",
    priority: "medium",
  });
  const taskB = taskBRes.data.task;
  console.log(`    ✓ Task B created: "${taskB.title}" (ID: ${taskB.id})`);

  // 3. Start Agent A on Task A
  console.log("\n[3] Starting Agent A on Task A...");
  const agentARes = await api("POST", `/api/projects/${project.id}/agents`, {
    prompt: "Implement authentication core with JWT signing and middleware",
    taskId: taskA.id,
    role: "worker",
    title: "Auth Specialist (Agent A)",
  });
  const sessA = agentARes.data.session;
  console.log(`    ✓ Agent A session started: ID ${sessA.id} (token: ${sessA.token?.slice(0, 10)}...)`);

  // Connect Agent A MCP Client
  const { client: mcpA, transport: transportA } = await createMcpClientForToken(sessA.token);
  console.log("    ✓ Agent A connected to GridMind MCP server");

  // 4. Agent A produces Handoff to Task B via MCP
  console.log("\n[4] Agent A producing structured handoff to Task B via gridmind_create_handoff...");
  const handoffRes = await mcpA.callTool({
    name: "gridmind_create_handoff",
    arguments: {
      target_task_id: taskB.id,
      summary: "JWT Authentication & Auth Middleware completed successfully.",
      completed_work: "Created src/auth.ts with verifyToken() and signToken(). Created authMiddleware for route protection. All unit tests passing.",
      changed_files: ["src/auth.ts", "src/middleware/auth.ts", "tests/auth.test.ts"],
      decisions: [
        "Signed tokens with HS256 HMAC",
        "Token expiration default set to 24h",
        "Exported extractBearerToken helper for downstream routers",
      ],
      blockers: [
        "Needs REDIS_URL configured in .env for token revocation in staging/prod",
      ],
      next_steps: [
        "Protect dashboard routes using authMiddleware",
        "Extract req.user profile data to populate Dashboard greeting",
      ],
    },
  });

  if (handoffRes.isError) {
    throw new Error(`Agent A failed to create handoff: ${handoffRes.content?.[0]?.text}`);
  }
  const createdHandoff = parseToolText(handoffRes).handoff;
  console.log(`    ✓ Handoff created successfully! ID: ${createdHandoff.id}`);
  console.log(`      • Source Task: ${taskA.title} (${createdHandoff.source_task_id})`);
  console.log(`      • Target Task: ${taskB.title} (${createdHandoff.target_task_id})`);
  console.log(`      • Status: ${createdHandoff.status}`);

  // 5. Verify in GridMind UI API
  console.log("\n[5] Verifying Handoff in GridMind UI (Task A → Handoff → Task B)...");
  const uiRes = await api("GET", `/api/projects/${project.id}/handoffs`);
  const uiHandoff = uiRes.data.handoffs?.find((h) => h.id === createdHandoff.id);
  if (!uiHandoff) throw new Error("Handoff not found in UI API");
  console.log(`    ✓ UI view: ${uiHandoff.sourceTaskTitle} → [Handoff: ${uiHandoff.status.toUpperCase()}] → ${uiHandoff.targetTaskTitle}`);
  console.log(`      • Summary: "${uiHandoff.summary}"`);
  console.log(`      • Decisions: ${uiHandoff.decisions.length}`);
  console.log(`      • Blockers: ${uiHandoff.blockers.join(", ")}`);

  // 6. Start Agent B on Task B
  console.log("\n[6] Starting Agent B on Task B...");
  const agentBRes = await api("POST", `/api/projects/${project.id}/agents`, {
    prompt: "Implement user profile dashboard using authentication handoff",
    taskId: taskB.id,
    role: "worker",
    title: "Dashboard Specialist (Agent B)",
  });
  const sessB = agentBRes.data.session;
  console.log(`    ✓ Agent B session started: ID ${sessB.id}`);

  // Connect Agent B MCP Client
  const { client: mcpB, transport: transportB } = await createMcpClientForToken(sessB.token);
  console.log("    ✓ Agent B connected to GridMind MCP server");

  // 7. Agent B retrieves incoming handoff via MCP
  console.log("\n[7] Agent B querying relevant handoffs via gridmind_get_handoffs...");
  const getRes = await mcpB.callTool({
    name: "gridmind_get_handoffs",
    arguments: {},
  });
  if (getRes.isError) throw new Error("Agent B failed to get handoffs");
  const agentBHandoffs = parseToolText(getRes).handoffs;
  const receivedHandoff = agentBHandoffs.find((h) => h.id === createdHandoff.id);
  if (!receivedHandoff) throw new Error("Agent B did not receive handoff");
  console.log(`    ✓ Agent B received incoming handoff (${receivedHandoff.id})`);
  console.log(`      • Summary: ${receivedHandoff.summary}`);
  console.log(`      • Completed work: ${receivedHandoff.completed_work}`);
  console.log(`      • Changed files: ${receivedHandoff.changed_files.join(", ")}`);
  console.log(`      • Next steps: ${receivedHandoff.next_steps.join(", ")}`);

  // 8. Agent B accepts the handoff
  console.log("\n[8] Agent B accepting handoff via gridmind_accept_handoff...");
  const acceptRes = await mcpB.callTool({
    name: "gridmind_accept_handoff",
    arguments: { handoff_id: receivedHandoff.id },
  });
  if (acceptRes.isError) throw new Error("Agent B failed to accept handoff");
  const acceptedHandoff = parseToolText(acceptRes).handoff;
  console.log(`    ✓ Handoff accepted! Status is now: "${acceptedHandoff.status.toUpperCase()}" (consumed_at: ${new Date(acceptedHandoff.consumed_at).toISOString()})`);

  // 9. Agent B continues work informed by handoff
  console.log("\n[9] Agent B continuing task work based on handoff context...");
  await mcpB.callTool({
    name: "gridmind_update_task_status",
    arguments: {
      status: "in_progress",
      description: "Implementing profile dashboard using auth middleware and JWT context",
    },
  });
  console.log("    ✓ Task B status set to 'in_progress'");

  await mcpB.callTool({
    name: "gridmind_record_memory",
    arguments: {
      scope: "task",
      category: "discovery",
      content: "Dashboard profile router successfully hooked into authMiddleware from Task A handoff",
      importance: 2,
    },
  });
  console.log("    ✓ Recorded task discovery memory");

  await mcpB.callTool({
    name: "gridmind_update_task_status",
    arguments: {
      status: "done",
      description: "Dashboard implementation complete with auth protection",
    },
  });
  console.log("    ✓ Task B status updated to 'done'");

  // Teardown
  await transportA.close();
  await transportB.close();

  console.log("\n==================================================");
  console.log("DEMO RESULT: SUCCESS — Agent A → GridMind → Handoff → Agent B coordination complete!");
  console.log("==================================================");
}

runDemo().catch((err) => {
  console.error("DEMO FAILED:", err);
  process.exit(1);
});
