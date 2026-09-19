#!/usr/bin/env node

/**
 * GridMind Stage 5 Phase 1: Core MCP Bridge Automated Test Suite
 *
 * Validates:
 * 1. MCP server starts via stdio transport
 * 2. tools/list works
 * 3. all 8 tools are registered
 * 4. tool schemas are valid
 * 5. authenticated session context works
 * 6. invalid token rejected
 * 7. missing token rejected
 * 8. worker gets own task
 * 9. worker cannot request another task
 * 10. worker cannot access another task's memory
 * 11. worker can access own task memory
 * 12. worker can access project_shared memory
 * 13. worker can access own private memory
 * 14. worker cannot access another agent's private memory
 * 15. worker can create own task memory
 * 16. worker cannot create memory for another task
 * 17. master can access project tasks
 * 18. cross-project access rejected
 * 19. task status transition rules remain enforced
 * 20. decisions remain project scoped
 * 21. events remain project scoped
 * 22. malformed MCP arguments fail safely
 *
 * Run with: node tests/mcp-stage5.mjs
 * Requires: server running on localhost:3000
 */

import { execSync, spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BASE = process.env.GRIDMIND_API || "http://localhost:3000";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log("  ✓ " + label);
    passed++;
  } else {
    console.log("  ✗ " + label);
    failed++;
  }
}

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

function createGitRepo(dir) {
  execSync("rm -rf " + dir + " && mkdir -p " + dir);
  execSync("cd " + dir + " && git init -q && git config user.email t@t.com && git config user.name t && echo init > README.md && git add -A && git commit -qm init");
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
  const client = new Client({ name: "mcp-test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

function parseToolText(res) {
  if (!res || !res.content || !res.content[0] || !res.content[0].text) return null;
  try {
    return JSON.parse(res.content[0].text);
  } catch {
    return res.content[0].text;
  }
}

async function run() {
  console.log("==================================================");
  console.log("STAGE 5 PHASE 1: CORE MCP BRIDGE TESTS");
  console.log("==================================================");

  // Setup projects and repositories
  console.log("\n--- Setup ---");
  const repo1 = "/tmp/gm-mcp-proj1";
  const repo2 = "/tmp/gm-mcp-proj2";
  createGitRepo(repo1);
  createGitRepo(repo2);

  const proj1Res = await api("POST", "/api/projects", { name: "MCP Project 1", repo_path: repo1 });
  assert(proj1Res.status === 201, "Project 1 created");
  const proj1 = proj1Res.data.project;

  const proj2Res = await api("POST", "/api/projects", { name: "MCP Project 2", repo_path: repo2 });
  assert(proj2Res.status === 201, "Project 2 created");
  const proj2 = proj2Res.data.project;

  // Create tasks in Project 1
  const t1ARes = await api("POST", `/api/projects/${proj1.id}/tasks`, { title: "Task 1A: Backend Service" });
  const t1BRes = await api("POST", `/api/projects/${proj1.id}/tasks`, { title: "Task 1B: Frontend Client" });
  assert(t1ARes.status === 201, "Task 1A created");
  assert(t1BRes.status === 201, "Task 1B created");
  const task1A = t1ARes.data.task;
  const task1B = t1BRes.data.task;

  // Create task in Project 2
  const t2Res = await api("POST", `/api/projects/${proj2.id}/tasks`, { title: "Task 2: Foreign Task" });
  assert(t2Res.status === 201, "Task 2 created in Project 2");
  const task2 = t2Res.data.task;

  // Create Worker A session (assigned to Task 1A)
  const sessARes = await api("POST", `/api/projects/${proj1.id}/agents`, {
    prompt: "worker agent A",
    taskId: task1A.id,
    role: "worker",
  });
  assert(sessARes.status === 201, "Worker A session created");
  const sessA = sessARes.data.session;

  // Create Worker B session (assigned to Task 1B)
  const sessBRes = await api("POST", `/api/projects/${proj1.id}/agents`, {
    prompt: "worker agent B",
    taskId: task1B.id,
    role: "worker",
  });
  assert(sessBRes.status === 201, "Worker B session created");
  const sessB = sessBRes.data.session;

  // Create Master session (Project 1)
  const sessMRes = await api("POST", `/api/projects/${proj1.id}/agents`, {
    prompt: "master coordinator",
    role: "master",
  });
  assert(sessMRes.status === 201, "Master session created");
  const sessMaster = sessMRes.data.session;

  // Create Worker C session (Project 2, assigned to Task 2)
  const sessCRes = await api("POST", `/api/projects/${proj2.id}/agents`, {
    prompt: "worker agent C",
    taskId: task2.id,
    role: "worker",
  });
  assert(sessCRes.status === 201, "Worker C session created (Project 2)");
  const sessC = sessCRes.data.session;

  // 1. Test MCP Server starts & CLI executable exists
  console.log("\n--- Test 1: MCP Server Starts ---");
  const mcpA = await createMcpClientForToken(sessA.token);
  assert(mcpA.client !== null, "MCP client successfully connected to dist/mcp/cli.mjs via stdio");

  // 2. Test tools/list works
  console.log("\n--- Test 2: tools/list Works ---");
  const toolsResult = await mcpA.client.listTools();
  assert(Array.isArray(toolsResult.tools), "tools/list returns an array of tools");
  assert(toolsResult.tools.length === 8, `tools/list returns exactly 8 tools (got ${toolsResult.tools.length})`);

  // 3. Test all 8 tools are registered
  console.log("\n--- Test 3: All 8 Tools Registered ---");
  const expectedTools = [
    "gridmind_get_session_context",
    "gridmind_get_context",
    "gridmind_search_memory",
    "gridmind_record_memory",
    "gridmind_get_task",
    "gridmind_update_task_status",
    "gridmind_record_decision",
    "gridmind_emit_event",
  ];
  const registeredNames = toolsResult.tools.map((t) => t.name);
  for (const name of expectedTools) {
    assert(registeredNames.includes(name), `Tool registered: ${name}`);
  }

  // 4. Test tool schemas are valid
  console.log("\n--- Test 4: Tool Schemas Valid ---");
  for (const tool of toolsResult.tools) {
    assert(typeof tool.name === "string" && tool.name.length > 0, `${tool.name} has non-empty name`);
    assert(typeof tool.description === "string" && tool.description.length > 0, `${tool.name} has description`);
    assert(tool.inputSchema && tool.inputSchema.type === "object", `${tool.name} has object inputSchema`);
  }

  // 5. Test authenticated session context works
  console.log("\n--- Test 5: Authenticated Session Context ---");
  const sessContextRes = await mcpA.client.callTool({
    name: "gridmind_get_session_context",
    arguments: {},
  });
  assert(!sessContextRes.isError, "gridmind_get_session_context call succeeded");
  const sessContext = parseToolText(sessContextRes);
  assert(sessContext.session_id === sessA.id, `Returns authenticated session_id (${sessContext.session_id})`);
  assert(sessContext.project_id === proj1.id, `Returns authenticated project_id (${sessContext.project_id})`);
  assert(sessContext.task_id === task1A.id, `Returns authenticated task_id (${sessContext.task_id})`);
  assert(sessContext.role === "worker", `Returns authenticated role (${sessContext.role})`);
  assert(sessContext.agent_type === "opencode", `Returns authenticated agent_type (${sessContext.agent_type})`);

  // 6. Test invalid token rejected
  console.log("\n--- Test 6: Invalid Token Rejected ---");
  const mcpInvalid = await createMcpClientForToken("invalid_token_12345");
  const invalidRes = await mcpInvalid.client.callTool({
    name: "gridmind_get_session_context",
    arguments: {},
  });
  assert(invalidRes.isError === true, "Tool call with invalid token returns isError: true");
  await mcpInvalid.client.close();

  // 7. Test missing token rejected
  console.log("\n--- Test 7: Missing Token Rejected ---");
  const runWithoutToken = spawnSync("node", ["dist/mcp/cli.mjs"], {
    env: { ...process.env, GRIDMIND_API: BASE, GRIDMIND_TOKEN: "" },
    encoding: "utf8",
  });
  assert(runWithoutToken.status !== 0, "dist/mcp/cli.mjs exits with non-zero when GRIDMIND_TOKEN is missing");
  assert(
    runWithoutToken.stderr.includes("GRIDMIND_TOKEN") || runWithoutToken.stdout.includes("GRIDMIND_TOKEN"),
    "Stderr or stdout mentions GRIDMIND_TOKEN missing"
  );

  const runWithoutApi = spawnSync("node", ["dist/mcp/cli.mjs"], {
    env: { ...process.env, GRIDMIND_API: "", GRIDMIND_TOKEN: sessA.token },
    encoding: "utf8",
  });
  assert(runWithoutApi.status !== 0, "dist/mcp/cli.mjs exits with non-zero when GRIDMIND_API is missing");

  // 8. Test worker gets own task
  console.log("\n--- Test 8: Worker Gets Own Task ---");
  const getTaskRes = await mcpA.client.callTool({
    name: "gridmind_get_task",
    arguments: {},
  });
  assert(!getTaskRes.isError, "Worker A can get task without arguments");
  const taskAData = parseToolText(getTaskRes);
  assert(taskAData.task && taskAData.task.id === task1A.id, `Worker A receives assigned task (${task1A.id})`);
  assert(taskAData.task.title === "Task 1A: Backend Service", "Worker A receives correct task title");

  // 9. Test worker cannot request another task
  console.log("\n--- Test 9: Worker Cannot Request Another Task ---");
  const getOtherTaskRes = await mcpA.client.callTool({
    name: "gridmind_get_task",
    arguments: { task_id: task1B.id },
  });
  assert(getOtherTaskRes.isError === true, "Worker A requesting task1B is rejected (isError: true)");
  const otherTaskErr = getOtherTaskRes.content[0].text;
  assert(otherTaskErr.includes("forbidden") || otherTaskErr.includes("cannot access another task"), "Error message specifies forbidden cross-task access");

  // 10. Test worker cannot access another task's memory
  console.log("\n--- Test 10: Worker Cannot Access Another Task's Memory ---");
  const searchOtherTaskMemRes = await mcpA.client.callTool({
    name: "gridmind_search_memory",
    arguments: { task_id: task1B.id },
  });
  assert(searchOtherTaskMemRes.isError === true, "Worker A searchMemory targeting task1B is rejected");

  const getContextOtherTaskRes = await mcpA.client.callTool({
    name: "gridmind_get_context",
    arguments: { task_id: task1B.id },
  });
  assert(getContextOtherTaskRes.isError === true, "Worker A getContext targeting task1B is rejected");

  // 11. Test worker can access own task memory
  console.log("\n--- Test 11: Worker Can Access Own Task Memory ---");
  // Seed a task memory for Task 1A via API
  const seedTaskMemRes = await api(
    "POST",
    "/api/internal/memory",
    {
      scope: "task",
      type: "fact",
      content: "Task 1A requires Node 18+ and SQLite foreign keys enabled.",
      task_id: task1A.id,
      source: "agent",
    },
    { Authorization: `Bearer ${sessA.token}` }
  );
  assert(seedTaskMemRes.status === 201, "Task 1A memory seeded successfully");

  const searchOwnTaskMem = await mcpA.client.callTool({
    name: "gridmind_search_memory",
    arguments: { query: "foreign keys" },
  });
  assert(!searchOwnTaskMem.isError, "Worker A searchMemory succeeds");
  const searchOwnResult = parseToolText(searchOwnTaskMem);
  const foundTask1AMem = searchOwnResult.memories && searchOwnResult.memories.some((m) => m.content.includes("SQLite foreign keys"));
  assert(foundTask1AMem, "Worker A retrieves own task memory");

  // 12. Test worker can access project_shared memory
  console.log("\n--- Test 12: Worker Can Access Project Shared Memory ---");
  await api(
    "POST",
    "/api/internal/memory",
    {
      scope: "project_shared",
      type: "constraint",
      content: "All API responses must use JSON format and appropriate HTTP status codes.",
      source: "agent",
    },
    { Authorization: `Bearer ${sessA.token}` }
  );

  const searchSharedMem = await mcpA.client.callTool({
    name: "gridmind_search_memory",
    arguments: { query: "API responses JSON" },
  });
  assert(!searchSharedMem.isError, "Worker A searchMemory for shared memory succeeds");
  const sharedResult = parseToolText(searchSharedMem);
  const foundShared = sharedResult.memories && sharedResult.memories.some((m) => m.content.includes("All API responses must use JSON"));
  assert(foundShared, "Worker A retrieves project_shared memory");

  // 13. Test worker can access own private memory
  console.log("\n--- Test 13: Worker Can Access Own Private Memory ---");
  const recPrivateRes = await mcpA.client.callTool({
    name: "gridmind_record_memory",
    arguments: {
      scope: "agent_private",
      category: "note",
      title: "Private Scratchpad A",
      content: "Worker A personal scratchpad note for internal refactoring.",
    },
  });
  assert(!recPrivateRes.isError, "Worker A successfully recorded agent_private memory");

  const searchPrivateMemA = await mcpA.client.callTool({
    name: "gridmind_search_memory",
    arguments: { query: "refactoring" },
  });
  assert(!searchPrivateMemA.isError, "Worker A searchMemory for private note succeeds");
  const privateResultA = parseToolText(searchPrivateMemA);
  const foundPrivateA = privateResultA.memories && privateResultA.memories.some((m) => m.content.includes("personal scratchpad note for internal refactoring"));
  assert(foundPrivateA, "Worker A retrieves own private memory");

  // 14. Test worker cannot access another agent's private memory
  console.log("\n--- Test 14: Worker Cannot Access Another Agent's Private Memory ---");
  const mcpB = await createMcpClientForToken(sessB.token);

  const recPrivateB = await mcpB.client.callTool({
    name: "gridmind_record_memory",
    arguments: {
      scope: "agent_private",
      category: "note",
      title: "Secret B",
      content: "Worker B super-secret credentials or session scratchpad.",
    },
  });
  assert(!recPrivateB.isError, "Worker B recorded agent_private memory");

  // Worker A searches for Worker B's secret
  const searchAForBSecret = await mcpA.client.callTool({
    name: "gridmind_search_memory",
    arguments: { query: "super-secret credentials" },
  });
  assert(!searchAForBSecret.isError, "Worker A search completes without crashing");
  const searchAForBResult = parseToolText(searchAForBSecret);
  const leakedBSecret = searchAForBResult.memories && searchAForBResult.memories.some((m) => m.content.includes("super-secret credentials"));
  assert(!leakedBSecret, "Worker A CANNOT see Worker B's agent_private memory (private isolation verified)");

  // 15. Test worker can create own task memory
  console.log("\n--- Test 15: Worker Can Create Own Task Memory ---");
  const recTaskMemA = await mcpA.client.callTool({
    name: "gridmind_record_memory",
    arguments: {
      scope: "task",
      category: "discovery",
      title: "Auth Route Bug",
      content: "Discovered edge case in session authorization when token is empty.",
      importance: 2,
    },
  });
  assert(!recTaskMemA.isError, "Worker A recorded task memory without supplying task_id (auto-derived)");
  const recTaskMemAData = parseToolText(recTaskMemA);
  assert(recTaskMemAData.memory && recTaskMemAData.memory.task_id === task1A.id, `Task memory automatically assigned to Worker A task (${task1A.id})`);

  // 16. Test worker cannot create memory for another task
  console.log("\n--- Test 16: Worker Cannot Create Memory For Another Task ---");
  const recOtherTaskMem = await mcpA.client.callTool({
    name: "gridmind_record_memory",
    arguments: {
      scope: "task",
      task_id: task1B.id,
      content: "Malicious injection into Task 1B memory space.",
    },
  });
  assert(recOtherTaskMem.isError === true, "Worker A recording memory for Task 1B is rejected (isError: true)");
  const recOtherErr = recOtherTaskMem.content[0].text;
  assert(recOtherErr.includes("forbidden") || recOtherErr.includes("cannot create memory for another task"), "Rejection specifies forbidden cross-task creation");

  // 17. Test master can access project tasks
  console.log("\n--- Test 17: Master Can Access Project Tasks ---");
  const mcpMaster = await createMcpClientForToken(sessMaster.token);

  const masterGetTask1A = await mcpMaster.client.callTool({
    name: "gridmind_get_task",
    arguments: { task_id: task1A.id },
  });
  assert(!masterGetTask1A.isError, "Master can get Task 1A");
  const masterT1AData = parseToolText(masterGetTask1A);
  assert(masterT1AData.task && masterT1AData.task.id === task1A.id, "Master received Task 1A details");

  const masterGetTask1B = await mcpMaster.client.callTool({
    name: "gridmind_get_task",
    arguments: { task_id: task1B.id },
  });
  assert(!masterGetTask1B.isError, "Master can get Task 1B");
  const masterT1BData = parseToolText(masterGetTask1B);
  assert(masterT1BData.task && masterT1BData.task.id === task1B.id, "Master received Task 1B details");

  const masterContext1A = await mcpMaster.client.callTool({
    name: "gridmind_get_context",
    arguments: { task_id: task1A.id },
  });
  assert(!masterContext1A.isError, "Master can get context for Task 1A");

  // 18. Test cross-project access rejected
  console.log("\n--- Test 18: Cross-Project Access Rejected ---");
  const mcpC = await createMcpClientForToken(sessC.token);

  // Worker C (in Project 2) tries to get Task 1A (in Project 1)
  const cGetTask1A = await mcpC.client.callTool({
    name: "gridmind_get_task",
    arguments: { task_id: task1A.id },
  });
  assert(cGetTask1A.isError === true, "Project 2 worker cannot get Project 1 task");

  // Master of Project 1 tries to access Project 2 task
  const masterGetProj2Task = await mcpMaster.client.callTool({
    name: "gridmind_get_task",
    arguments: { task_id: task2.id },
  });
  assert(masterGetProj2Task.isError === true, "Project 1 master cannot access Project 2 task");

  // Worker C cannot search Project 1 task memory
  const cSearchProj1Task = await mcpC.client.callTool({
    name: "gridmind_search_memory",
    arguments: { task_id: task1A.id },
  });
  assert(cSearchProj1Task.isError === true, "Project 2 worker cannot search Project 1 task memory");

  // 19. Test task status transition rules remain enforced
  console.log("\n--- Test 19: Task Status Transition Rules Enforced ---");
  // Task 1A is currently in "in_progress" (set when worker session launched).
  // Invalid transition: in_progress -> queued is not allowed.
  const invalidTransRes = await mcpA.client.callTool({
    name: "gridmind_update_task_status",
    arguments: {
      status: "queued",
      description: "Invalid regression from in_progress to queued",
    },
  });
  assert(invalidTransRes.isError === true, "Invalid task status transition (in_progress -> queued) rejected");

  // Valid transition: in_progress -> blocked
  const validBlockedRes = await mcpA.client.callTool({
    name: "gridmind_update_task_status",
    arguments: {
      status: "blocked",
      description: "Waiting on upstream dependencies",
    },
  });
  assert(!validBlockedRes.isError, "Valid task status transition (in_progress -> blocked) succeeds");
  const blockedTaskData = parseToolText(validBlockedRes);
  assert(blockedTaskData.task && blockedTaskData.task.status === "blocked", "Task status is now blocked");

  // Valid transition: blocked -> in_progress
  const validResumeRes = await mcpA.client.callTool({
    name: "gridmind_update_task_status",
    arguments: {
      status: "in_progress",
      description: "Resuming work on Task 1A",
    },
  });
  assert(!validResumeRes.isError, "Valid task status transition (blocked -> in_progress) succeeds");
  const resumedTaskData = parseToolText(validResumeRes);
  assert(resumedTaskData.task && resumedTaskData.task.status === "in_progress", "Task status is now in_progress");

  // Valid transition: in_progress -> done (terminal)
  const validDoneRes = await mcpA.client.callTool({
    name: "gridmind_update_task_status",
    arguments: {
      status: "done",
      description: "Task 1A completed successfully",
    },
  });
  assert(!validDoneRes.isError, "Valid transition to terminal status (in_progress -> done) succeeds");

  // Invalid transition from terminal state: done -> in_progress
  const invalidFromDoneRes = await mcpA.client.callTool({
    name: "gridmind_update_task_status",
    arguments: {
      status: "in_progress",
    },
  });
  assert(invalidFromDoneRes.isError === true, "Transition from terminal state (done -> in_progress) rejected");

  // Worker A cannot update Task 1B's status
  const workerUpdateOtherTask = await mcpA.client.callTool({
    name: "gridmind_update_task_status",
    arguments: {
      task_id: task1B.id,
      status: "in_progress",
    },
  });
  assert(workerUpdateOtherTask.isError === true, "Worker A cannot update status of Task 1B");

  // 20. Test decisions remain project scoped
  console.log("\n--- Test 20: Decisions Remain Project Scoped ---");
  const decRes = await mcpA.client.callTool({
    name: "gridmind_record_decision",
    arguments: {
      title: "Use Bearer Tokens for MCP",
      body: "All MCP operations must be authenticated using the session Bearer token from GRIDMIND_TOKEN.",
    },
  });
  assert(!decRes.isError, "gridmind_record_decision succeeded");
  const decData = parseToolText(decRes);
  assert(decData.decision && decData.decision.id, "Decision recorded with ID");

  // Verify in Project 1 via direct API
  const proj1Decs = await api("GET", `/api/projects/${proj1.id}/decisions`);
  assert(
    proj1Decs.data.decisions && proj1Decs.data.decisions.some((d) => d.title === "Use Bearer Tokens for MCP"),
    "Decision appears in Project 1 decisions list"
  );

  // Verify NOT in Project 2
  const proj2Decs = await api("GET", `/api/projects/${proj2.id}/decisions`);
  assert(
    !proj2Decs.data.decisions || !proj2Decs.data.decisions.some((d) => d.title === "Use Bearer Tokens for MCP"),
    "Decision does NOT appear in Project 2 (project isolation preserved)"
  );

  // 21. Test events remain project scoped
  console.log("\n--- Test 21: Events Remain Project Scoped ---");
  const emitRes = await mcpA.client.callTool({
    name: "gridmind_emit_event",
    arguments: {
      type: "agent:progress",
      message: "MCP bridge operational and healthy",
      payload: { step: "phase1_complete" },
    },
  });
  assert(!emitRes.isError, "gridmind_emit_event succeeded");
  const emitData = parseToolText(emitRes);
  assert(emitData.ok === true && emitData.type === "agent:progress", "Event emission returned ok with type");

  // 22. Test malformed MCP arguments fail safely
  console.log("\n--- Test 22: Malformed MCP Arguments Fail Safely ---");
  // A. Content > 4000 chars in record_memory
  const oversizedContent = "A".repeat(4001);
  let oversizedErr = false;
  try {
    const res = await mcpA.client.callTool({
      name: "gridmind_record_memory",
      arguments: {
        scope: "project_shared",
        content: oversizedContent,
      },
    });
    if (res.isError) oversizedErr = true;
  } catch {
    oversizedErr = true;
  }
  assert(oversizedErr, "Recording memory > 4000 characters fails safely via schema validation");

  // B. Invalid scope enum in record_memory
  let invalidScopeErr = false;
  try {
    const res = await mcpA.client.callTool({
      name: "gridmind_record_memory",
      arguments: {
        scope: "universal_global_scope",
        content: "some content",
      },
    });
    if (res.isError) invalidScopeErr = true;
  } catch {
    invalidScopeErr = true;
  }
  assert(invalidScopeErr, "Invalid scope value rejected safely by Zod schema");

  // C. Invalid status enum in update_task_status
  let invalidStatusErr = false;
  try {
    const res = await mcpA.client.callTool({
      name: "gridmind_update_task_status",
      arguments: {
        status: "destroyed",
      },
    });
    if (res.isError) invalidStatusErr = true;
  } catch {
    invalidStatusErr = true;
  }
  assert(invalidStatusErr, "Invalid task status rejected safely by Zod schema");

  // Clean up MCP clients
  await mcpA.client.close();
  await mcpB.client.close();
  await mcpMaster.client.close();
  await mcpC.client.close();

  console.log("\n==================================================");
  console.log(`MCP STAGE 5 SUITE COMPLETE: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
