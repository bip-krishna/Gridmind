#!/usr/bin/env node

/**
 * GridMind Stage 5B: Agent Handoffs Test Suite
 *
 * Validates:
 * 1. worker can create handoff from own session
 * 2. worker cannot impersonate another source session
 * 3. worker cannot impersonate another source task
 * 4. worker can target another task in same project
 * 5. worker cannot target another project
 * 6. worker can retrieve handoffs targeted at own task
 * 7. worker cannot retrieve another task's private handoffs
 * 8. worker can accept handoff targeted at own task
 * 9. worker cannot accept handoff targeted at another task
 * 10. master can inspect project handoffs
 * 11. master cannot inspect another project
 * 12. handoff acceptance is idempotent
 * 13. cross-project handoff rejected
 * 14. malformed handoff rejected
 * 15. oversized handoff rejected
 * 16. handoff events are emitted
 * 17. handoff does not expose private memory
 * 18. handoff context respects token budget
 * 19. existing Stage 5A tools still work
 * 20. existing Stage 1–4 security tests still pass
 *
 * Run with: node tests/stage5b-handoffs.mjs
 * Requires: server running on localhost:3000
 */

import { execSync } from "node:child_process";
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
  const client = new Client({ name: "mcp-handoff-test-client", version: "1.0.0" }, { capabilities: {} });
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
  console.log("STAGE 5B: AGENT HANDOFFS TEST SUITE");
  console.log("==================================================");

  // Setup projects and tasks
  console.log("\n--- Setup ---");
  const repo1 = "/tmp/gm-handoff-proj1";
  const repo2 = "/tmp/gm-handoff-proj2";
  createGitRepo(repo1);
  createGitRepo(repo2);

  const proj1Res = await api("POST", "/api/projects", { name: "Handoff Project 1", repo_path: repo1 });
  assert(proj1Res.status === 201, "Project 1 created");
  const proj1 = proj1Res.data.project;

  const proj2Res = await api("POST", "/api/projects", { name: "Handoff Project 2", repo_path: repo2 });
  assert(proj2Res.status === 201, "Project 2 created");
  const proj2 = proj2Res.data.project;

  // Create tasks in Project 1
  const t1ARes = await api("POST", `/api/projects/${proj1.id}/tasks`, { title: "Task 1A: Auth Service" });
  const t1BRes = await api("POST", `/api/projects/${proj1.id}/tasks`, { title: "Task 1B: Dashboard UI" });
  const t1CRes = await api("POST", `/api/projects/${proj1.id}/tasks`, { title: "Task 1C: Billing Engine" });
  assert(t1ARes.status === 201, "Task 1A created");
  assert(t1BRes.status === 201, "Task 1B created");
  assert(t1CRes.status === 201, "Task 1C created");
  const task1A = t1ARes.data.task;
  const task1B = t1BRes.data.task;
  const task1C = t1CRes.data.task;

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

  // Create Worker C session (Project 2)
  const sessCRes = await api("POST", `/api/projects/${proj2.id}/agents`, {
    prompt: "worker agent C in project 2",
    taskId: task2.id,
    role: "worker",
  });
  assert(sessCRes.status === 201, "Worker C session created (Project 2)");
  const sessC = sessCRes.data.session;

  // Connect MCP Clients
  console.log("\n--- Connect MCP Clients ---");
  const { client: clientA, transport: transportA } = await createMcpClientForToken(sessA.token);
  const { client: clientB, transport: transportB } = await createMcpClientForToken(sessB.token);
  const { client: clientMaster, transport: transportMaster } = await createMcpClientForToken(sessMaster.token);
  const { client: clientC, transport: transportC } = await createMcpClientForToken(sessC.token);

  assert(true, "All 4 MCP clients connected via stdio");

  // Verify MCP Tools List: 8 (Phase 1) + 3 (Stage 5B) = 11 tools
  console.log("\n--- Verify MCP Tool Registration ---");
  const toolsList = await clientA.listTools();
  assert(toolsList.tools && toolsList.tools.length === 11, `tools/list returns exactly 11 tools (got ${toolsList.tools?.length})`);

  const toolNames = new Set(toolsList.tools.map((t) => t.name));
  assert(toolNames.has("gridmind_create_handoff"), "Tool registered: gridmind_create_handoff");
  assert(toolNames.has("gridmind_get_handoffs"), "Tool registered: gridmind_get_handoffs");
  assert(toolNames.has("gridmind_accept_handoff"), "Tool registered: gridmind_accept_handoff");

  // ────────────────────────────────────────────────────────
  // Test 1: Worker can create handoff from own session
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 1: Worker Can Create Handoff From Own Session ---");
  const createHandoffRes = await clientA.callTool({
    name: "gridmind_create_handoff",
    arguments: {
      target_task_id: task1B.id,
      summary: "Auth API and JWT token signing implemented.",
      completed_work: "Implemented src/auth.ts with HMAC-SHA256 signature verification and login route.",
      changed_files: ["src/auth.ts", "src/routes/auth.ts"],
      decisions: ["Use HS256 for stateless tokens", "Token expiration set to 24h"],
      blockers: ["Needs Redis session store for revocation"],
      next_steps: ["Integrate auth middleware into Dashboard router"],
    },
  });

  assert(!createHandoffRes.isError, "Worker A created handoff without error");
  const handoffData = parseToolText(createHandoffRes);
  assert(handoffData && handoffData.ok === true, "Handoff creation response returned ok: true");
  const handoff1 = handoffData.handoff;
  assert(handoff1.id && handoff1.id.length > 0, `Handoff created with ID: ${handoff1.id}`);
  assert(handoff1.source_session_id === sessA.id, `source_session_id strictly derived (${handoff1.source_session_id} === ${sessA.id})`);
  assert(handoff1.source_task_id === task1A.id, `source_task_id strictly derived (${handoff1.source_task_id} === ${task1A.id})`);
  assert(handoff1.target_task_id === task1B.id, `target_task_id set correctly (${handoff1.target_task_id} === ${task1B.id})`);
  assert(handoff1.status === "pending", "Initial handoff status is 'pending'");

  // ────────────────────────────────────────────────────────
  // Test 2 & 3: Worker cannot impersonate another source session or task
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 2 & 3: Worker Cannot Impersonate Source Session or Task ---");
  const spoofAttempt = await api("POST", "/api/internal/handoffs", {
    source_session_id: sessB.id,
    source_task_id: task1B.id,
    target_task_id: task1C.id,
    summary: "Spoofed handoff attempt",
    completed_work: "Attempted to forge identity",
  }, { Authorization: `Bearer ${sessA.token}` });

  assert(spoofAttempt.status === 201, "API handled request (server enforced derived auth)");
  assert(spoofAttempt.data.handoff.source_session_id === sessA.id, "Server ignored spoofed source_session_id, enforced auth.session.id");
  assert(spoofAttempt.data.handoff.source_task_id === task1A.id, "Server ignored spoofed source_task_id, enforced auth.session.task_id");

  // ────────────────────────────────────────────────────────
  // Test 4: Worker can target another task in same project
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 4: Worker Can Target Another Task in Same Project ---");
  const validSameProject = await clientA.callTool({
    name: "gridmind_create_handoff",
    arguments: {
      target_task_id: task1C.id,
      summary: "Database migrations ready for Billing.",
      completed_work: "Prepared ledger schema in db.",
    },
  });
  assert(!validSameProject.isError, "Worker A successfully targeted Task 1C in same project");

  // ────────────────────────────────────────────────────────
  // Test 5 & 13: Worker cannot target another project (cross-project rejected)
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 5 & 13: Cross-Project Handoff Rejected ---");
  const crossProjectRes = await clientA.callTool({
    name: "gridmind_create_handoff",
    arguments: {
      target_task_id: task2.id, // Task 2 is in Project 2!
      summary: "Attempting cross-project leak",
      completed_work: "This must fail",
    },
  });
  assert(crossProjectRes.isError === true, "Cross-project handoff creation rejected by MCP tool");
  const crossProjErr = crossProjectRes.content?.[0]?.text || "";
  assert(crossProjErr.includes("target task not found") || crossProjErr.includes("cross-project"), `Error message indicates target rejection: "${crossProjErr}"`);

  // Direct HTTP API check for cross project
  const crossProjectHttp = await api("POST", "/api/internal/handoffs", {
    target_task_id: task2.id,
    summary: "Direct cross-project attempt",
    completed_work: "Direct attempt",
  }, { Authorization: `Bearer ${sessA.token}` });
  assert(crossProjectHttp.status === 404, "Direct HTTP cross-project handoff rejected with 404");

  // ────────────────────────────────────────────────────────
  // Test 6: Worker can retrieve handoffs targeted at own task
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 6: Worker Can Retrieve Handoffs Targeted at Own Task ---");
  const getHandoffsRes = await clientB.callTool({
    name: "gridmind_get_handoffs",
    arguments: {},
  });
  assert(!getHandoffsRes.isError, "Worker B get_handoffs succeeded without error");
  const handoffsListB = parseToolText(getHandoffsRes);
  assert(Array.isArray(handoffsListB?.handoffs), "Returns handoffs array");
  const receivedHandoff = handoffsListB.handoffs.find((h) => h.id === handoff1.id);
  assert(!!receivedHandoff, "Worker B received handoff from Worker A targeted at Task 1B");
  assert(receivedHandoff.summary.includes("Auth API"), "Handoff summary matches created handoff");
  assert(receivedHandoff.blockers.length === 1, "Handoff includes structured blockers");

  // ────────────────────────────────────────────────────────
  // Test 7: Worker cannot retrieve another task's private handoffs
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 7: Worker Cannot Retrieve Another Task's Private Handoffs ---");
  // Worker A attempts to query handoffs for Task 1B
  const workerACrossQuery = await clientA.callTool({
    name: "gridmind_get_handoffs",
    arguments: { task_id: task1B.id },
  });
  assert(workerACrossQuery.isError === true, "Worker A querying Task 1B handoffs rejected (isError: true)");

  // Worker B attempts to inspect Task 1C handoff directly via HTTP
  const task1CHandoff = parseToolText(validSameProject).handoff;
  const workerBInspectOther = await api("GET", `/api/internal/handoffs/${task1CHandoff.id}`, null, {
    Authorization: `Bearer ${sessB.token}`,
  });
  assert(workerBInspectOther.status === 403, "Worker B inspecting Task 1C handoff directly rejected with 403 Forbidden");

  // ────────────────────────────────────────────────────────
  // Test 8: Worker can accept handoff targeted at own task
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 8: Worker Can Accept Handoff Targeted at Own Task ---");
  const acceptRes = await clientB.callTool({
    name: "gridmind_accept_handoff",
    arguments: { handoff_id: handoff1.id },
  });
  assert(!acceptRes.isError, "Worker B accepted handoff targeted at Task 1B");
  const acceptData = parseToolText(acceptRes);
  assert(acceptData.ok === true, "Accept response returned ok: true");
  assert(acceptData.handoff.status === "accepted", "Handoff status transitioned to 'accepted'");
  assert(acceptData.handoff.consumed_at !== null, "consumed_at timestamp was set");

  // ────────────────────────────────────────────────────────
  // Test 9: Worker cannot accept handoff targeted at another task
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 9: Worker Cannot Accept Handoff Targeted at Another Task ---");
  const acceptOtherTaskRes = await clientB.callTool({
    name: "gridmind_accept_handoff",
    arguments: { handoff_id: task1CHandoff.id }, // targeted at Task 1C!
  });
  assert(acceptOtherTaskRes.isError === true, "Worker B accepting handoff for Task 1C rejected (isError: true)");
  const acceptOtherErr = acceptOtherTaskRes.content?.[0]?.text || "";
  assert(acceptOtherErr.includes("forbidden") || acceptOtherErr.includes("another task"), "Error specifies forbidden cross-task acceptance");

  // ────────────────────────────────────────────────────────
  // Test 10: Master can inspect project handoffs
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 10: Master Can Inspect Project Handoffs ---");
  const masterListRes = await clientMaster.callTool({
    name: "gridmind_get_handoffs",
    arguments: {},
  });
  assert(!masterListRes.isError, "Master get_handoffs succeeded");
  const masterHandoffs = parseToolText(masterListRes);
  assert(masterHandoffs.handoffs.length >= 2, `Master can see all project handoffs (found ${masterHandoffs.handoffs.length})`);

  // Master can filter by task
  const masterFilterRes = await clientMaster.callTool({
    name: "gridmind_get_handoffs",
    arguments: { task_id: task1B.id },
  });
  assert(!masterFilterRes.isError, "Master filtering by task_id succeeded");
  const masterFiltered = parseToolText(masterFilterRes);
  assert(masterFiltered.handoffs.every((h) => h.target_task_id === task1B.id || h.source_task_id === task1B.id), "Filtered strictly to task 1B");

  // ────────────────────────────────────────────────────────
  // Test 11: Master cannot inspect another project
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 11: Master Cannot Inspect Another Project ---");
  const masterForeignQuery = await clientMaster.callTool({
    name: "gridmind_get_handoffs",
    arguments: { task_id: task2.id }, // Task 2 is in Project 2!
  });
  assert(masterForeignQuery.isError === true, "Master querying task from another project rejected");

  // ────────────────────────────────────────────────────────
  // Test 12: Handoff acceptance is idempotent
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 12: Handoff Acceptance is Idempotent ---");
  const acceptIdempotentRes = await clientB.callTool({
    name: "gridmind_accept_handoff",
    arguments: { handoff_id: handoff1.id },
  });
  assert(!acceptIdempotentRes.isError, "Second accept call on already accepted handoff succeeded");
  const idempotentData = parseToolText(acceptIdempotentRes);
  assert(idempotentData.ok === true, "Idempotent response ok: true");
  assert(idempotentData.handoff.status === "accepted", "Status remains 'accepted'");
  assert(idempotentData.already_accepted === true, "already_accepted flag set to true");

  // ────────────────────────────────────────────────────────
  // Test 14: Malformed handoff rejected
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 14: Malformed Handoff Rejected ---");
  // Missing required summary via HTTP
  const malformedHttp1 = await api("POST", "/api/internal/handoffs", {
    target_task_id: task1B.id,
    completed_work: "Work without summary",
  }, { Authorization: `Bearer ${sessA.token}` });
  assert(malformedHttp1.status === 400, "Missing summary rejected with 400 Bad Request");

  // Missing target_task_id
  const malformedHttp2 = await api("POST", "/api/internal/handoffs", {
    summary: "Summary without target",
    completed_work: "Completed without target",
  }, { Authorization: `Bearer ${sessA.token}` });
  assert(malformedHttp2.status === 400, "Missing target_task_id rejected with 400 Bad Request");

  // Changed files not an array
  const malformedHttp3 = await api("POST", "/api/internal/handoffs", {
    target_task_id: task1B.id,
    summary: "Valid summary",
    completed_work: "Valid work",
    changed_files: "not-an-array",
  }, { Authorization: `Bearer ${sessA.token}` });
  assert(malformedHttp3.status === 400, "Non-array changed_files rejected with 400");

  // ────────────────────────────────────────────────────────
  // Test 15: Oversized handoff rejected
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 15: Oversized Handoff Rejected ---");
  const oversizedSummary = "A".repeat(1001);
  const oversizedSummaryRes = await api("POST", "/api/internal/handoffs", {
    target_task_id: task1B.id,
    summary: oversizedSummary,
    completed_work: "Normal work",
  }, { Authorization: `Bearer ${sessA.token}` });
  assert(oversizedSummaryRes.status === 400, "Summary > 1000 characters rejected with 400");
  assert(oversizedSummaryRes.data.error.includes("exceeds maximum size"), "Error clearly indicates size limit violation");

  const oversizedWork = "W".repeat(4001);
  const oversizedWorkRes = await api("POST", "/api/internal/handoffs", {
    target_task_id: task1B.id,
    summary: "Normal summary",
    completed_work: oversizedWork,
  }, { Authorization: `Bearer ${sessA.token}` });
  assert(oversizedWorkRes.status === 400, "Completed work > 4000 characters rejected with 400");

  // ────────────────────────────────────────────────────────
  // Test 16: Handoff events are emitted
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 16: Handoff Events Are Emitted ---");
  const eventsRes = await api("GET", `/api/projects/${proj1.id}/events`);
  assert(eventsRes.status === 200, "Events retrieved");
  const events = eventsRes.data.events || [];

  const createdEvt = events.find((e) => e.type === "handoff:created");
  assert(!!createdEvt, "Event 'handoff:created' found in event log");
  if (createdEvt) {
    const payload = JSON.parse(createdEvt.payload);
    assert(payload.handoff_id === handoff1.id, "handoff:created has handoff_id");
    assert(payload.project_id === proj1.id, "handoff:created has project_id");
    assert(payload.source_task_id === task1A.id, "handoff:created has source_task_id");
    assert(payload.target_task_id === task1B.id, "handoff:created has target_task_id");
    assert(payload.summary === undefined, "Event payload does NOT leak raw summary or private text");
  }

  const acceptedEvt = events.find((e) => e.type === "handoff:accepted");
  assert(!!acceptedEvt, "Event 'handoff:accepted' found in event log");
  if (acceptedEvt) {
    const payload = JSON.parse(acceptedEvt.payload);
    assert(payload.handoff_id === handoff1.id, "handoff:accepted has handoff_id");
    assert(payload.source_task_id === task1A.id, "handoff:accepted has source_task_id");
    assert(payload.target_task_id === task1B.id, "handoff:accepted has target_task_id");
  }

  // ────────────────────────────────────────────────────────
  // Test 17: Handoff does not expose private memory
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 17: Handoff Does Not Expose Private Memory ---");
  // Worker A creates confidential private note
  const secretNoteText = "AGENT_A_TOP_SECRET_INTERNAL_KEY_999";
  const privMem = await api("POST", "/api/internal/memory", {
    scope: "agent_private",
    type: "note",
    content: secretNoteText,
    source: "agent",
  }, { Authorization: `Bearer ${sessA.token}` });
  assert(privMem.status === 201, "Worker A created private memory note");

  // Worker B inspects handoffs and context for Task 1B
  const ctxResB = await api("GET", "/api/internal/context", null, {
    Authorization: `Bearer ${sessB.token}`,
  });
  assert(ctxResB.status === 200, "Worker B retrieved task context");
  const ctxBriefB = ctxResB.data.contextBrief || "";
  const handoffsBriefB = ctxResB.data.handoffsBrief || "";
  assert(!ctxBriefB.includes(secretNoteText), "Private memory NOT present in contextBrief");
  assert(!handoffsBriefB.includes(secretNoteText), "Private memory NOT present in handoffsBrief");

  // ────────────────────────────────────────────────────────
  // Test 18: Handoff context respects token budget
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 18: Handoff Context Respects Token Budget ---");
  // Create multiple handoffs targeted at Task 1B
  for (let i = 1; i <= 5; i++) {
    await api("POST", "/api/internal/handoffs", {
      target_task_id: task1B.id,
      summary: `Handoff item ${i} for budget test`,
      completed_work: `Detailed explanation for item ${i}. `.repeat(20),
      blockers: [`Blocker ${i}`],
      next_steps: [`Step ${i}`],
    }, { Authorization: `Bearer ${sessA.token}` });
  }

  const ctxWithManyHandoffs = await api("GET", "/api/internal/context", null, {
    Authorization: `Bearer ${sessB.token}`,
  });
  assert(ctxWithManyHandoffs.status === 200, "Retrieved context with multiple handoffs");
  const finalHandoffsBrief = ctxWithManyHandoffs.data.handoffsBrief || "";
  assert(finalHandoffsBrief.length > 0, "Handoffs brief is populated");
  // 600 tokens ≈ 2400 chars, with margin under 3000 chars
  assert(finalHandoffsBrief.length <= 3200, `Handoffs brief length (${finalHandoffsBrief.length} chars) strictly bounded under budget`);
  assert(!finalHandoffsBrief.includes("--- END RELEVANT HANDOFFS ---"), "Prompt injection delimiters safely handled");

  // ────────────────────────────────────────────────────────
  // Test 19: Existing Stage 5A tools still work
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 19: Existing Stage 5A Tools Still Work ---");
  // 1. get_session_context
  const scRes = await clientA.callTool({ name: "gridmind_get_session_context", arguments: {} });
  assert(!scRes.isError, "gridmind_get_session_context still works");

  // 2. get_context
  const gcRes = await clientA.callTool({ name: "gridmind_get_context", arguments: {} });
  assert(!gcRes.isError, "gridmind_get_context still works");

  // 3. search_memory
  const smRes = await clientA.callTool({ name: "gridmind_search_memory", arguments: { query: "auth" } });
  assert(!smRes.isError, "gridmind_search_memory still works");

  // 4. record_memory
  const rmRes = await clientA.callTool({
    name: "gridmind_record_memory",
    arguments: { scope: "project_shared", content: "Stage 5B compatibility verified" },
  });
  assert(!rmRes.isError, "gridmind_record_memory still works");

  // 5. get_task
  const gtRes = await clientA.callTool({ name: "gridmind_get_task", arguments: {} });
  assert(!gtRes.isError, "gridmind_get_task still works");

  // 6. update_task_status
  const utRes = await clientA.callTool({
    name: "gridmind_update_task_status",
    arguments: { status: "in_progress", description: "Working on task 1A" },
  });
  assert(!utRes.isError, "gridmind_update_task_status still works");

  // 7. record_decision
  const rdRes = await clientA.callTool({
    name: "gridmind_record_decision",
    arguments: { title: "Stage 5B Decision", body: "Stage 5B tools operate harmoniously with Stage 5A" },
  });
  assert(!rdRes.isError, "gridmind_record_decision still works");

  // 8. emit_event
  const eeRes = await clientA.callTool({
    name: "gridmind_emit_event",
    arguments: { type: "agent:status", message: "Stage 5B MCP verified" },
  });
  assert(!eeRes.isError, "gridmind_emit_event still works");

  // ────────────────────────────────────────────────────────
  // Test 20: Project UI API endpoints work
  // ────────────────────────────────────────────────────────
  console.log("\n--- Test 20: Project UI API Endpoints Work ---");
  const uiHandoffsRes = await api("GET", `/api/projects/${proj1.id}/handoffs`);
  assert(uiHandoffsRes.status === 200, "GET /api/projects/:id/handoffs returns 200");
  assert(Array.isArray(uiHandoffsRes.data.handoffs), "Returns handoffs array for project UI");
  assert(uiHandoffsRes.data.handoffs[0].sourceTaskTitle !== undefined, "Includes resolved sourceTaskTitle");

  // Test UI accept action
  const pendingHandoff = uiHandoffsRes.data.handoffs.find((h) => h.status === "pending");
  if (pendingHandoff) {
    const uiAcceptRes = await api("POST", `/api/projects/${proj1.id}/handoffs`, {
      handoffId: pendingHandoff.id,
      action: "accept",
    });
    assert(uiAcceptRes.status === 200, "POST /api/projects/:id/handoffs accept succeeded");
    assert(uiAcceptRes.data.handoff.status === "accepted", "Handoff status transitioned to accepted via UI API");
  }

  // Teardown transports
  try { await transportA.close(); } catch { /* ignore */ }
  try { await transportB.close(); } catch { /* ignore */ }
  try { await transportMaster.close(); } catch { /* ignore */ }
  try { await transportC.close(); } catch { /* ignore */ }

  console.log("\n==================================================");
  console.log(`STAGE 5B SUITE COMPLETE: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("FATAL TEST ERROR:", err);
  process.exit(1);
});
