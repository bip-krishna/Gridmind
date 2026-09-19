#!/usr/bin/env node

/**
 * GridMind Stage 4 Phase 2 Tests: Project-Scoped Memory Retrieval
 *
 * Run with: node tests/stage4-retrieval.mjs
 * Requires: server running on localhost:3000
 */

const BASE = process.env.GRIDMIND_API || "http://localhost:3000";

import { execSync } from "node:child_process";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log("  \u2713 " + label);
    passed++;
  } else {
    console.log("  \u2717 " + label);
    failed++;
  }
}

async function api(method, urlPath, body, headers) {
  headers = Object.assign({ "Content-Type": "application/json" }, headers || {});
  var opts = { method: method, headers: headers };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(BASE + urlPath, opts);
  var text = await res.text();
  var data = null;
  try { data = JSON.parse(text); } catch (e) { /* ignore */ }
  return { status: res.status, data: data };
}

function createGitRepo(dir) {
  execSync("rm -rf " + dir + " && mkdir -p " + dir);
  execSync("cd " + dir + " && git init -q && git config user.email t@t.com && git config user.name t && echo init > README.md && git add -A && git commit -qm init");
}

async function setup() {
  console.log("=== Setup ===");
  var repoA = "/tmp/gmstage4-ret-a";
  var repoB = "/tmp/gmstage4-ret-b";
  createGitRepo(repoA);
  createGitRepo(repoB);

  var projA = await api("POST", "/api/projects", { name: "Retrieval Proj A", repo_path: repoA });
  var projB = await api("POST", "/api/projects", { name: "Retrieval Proj B", repo_path: repoB });
  assert(projA.status === 201, "Project A created");
  assert(projB.status === 201, "Project B created");

  var taskA1 = await api("POST", "/api/projects/" + projA.data.project.id + "/tasks", { title: "Auth Feature" });
  var taskA2 = await api("POST", "/api/projects/" + projA.data.project.id + "/tasks", { title: "Dashboard Feature" });
  var taskB1 = await api("POST", "/api/projects/" + projB.data.project.id + "/tasks", { title: "Billing Feature" });
  assert(taskA1.status === 201, "Task A1 created");
  assert(taskA2.status === 201, "Task A2 created");
  assert(taskB1.status === 201, "Task B1 created");

  var sessA1 = await api("POST", "/api/projects/" + projA.data.project.id + "/agents", {
    prompt: "auth worker",
    taskId: taskA1.data.task.id,
  });
  var sessA2 = await api("POST", "/api/projects/" + projA.data.project.id + "/agents", {
    prompt: "dashboard worker",
    taskId: taskA2.data.task.id,
  });
  var sessA3 = await api("POST", "/api/projects/" + projA.data.project.id + "/agents", {
    prompt: "standalone agent",
  });
  var sessB1 = await api("POST", "/api/projects/" + projB.data.project.id + "/agents", {
    prompt: "billing worker",
    taskId: taskB1.data.task.id,
  });

  assert(sessA1.status === 201, "Session A1 created");
  assert(sessA2.status === 201, "Session A2 created");
  assert(sessA3.status === 201, "Session A3 created");
  assert(sessB1.status === 201, "Session B1 created");

  return {
    projA: projA.data.project,
    projB: projB.data.project,
    taskA1: taskA1.data.task,
    taskA2: taskA2.data.task,
    taskB1: taskB1.data.task,
    tokenA1: sessA1.data.session.token,
    tokenA2: sessA2.data.session.token,
    tokenA3: sessA3.data.session.token,
    tokenB1: sessB1.data.session.token,
    sessA1: sessA1.data.session,
    sessA2: sessA2.data.session,
    sessA3: sessA3.data.session,
    sessB1: sessB1.data.session,
  };
}

// ────────────────────────────────────────────────────────
// 1. Project Isolation
// ────────────────────────────────────────────────────────
async function test1_projectIsolation(ctx) {
  console.log("\n=== 1: Project Isolation in Retrieval ===");
  // Create shared memory in A and B
  await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "fact",
    content: "Project A uses SQLite with WAL mode",
    importance: 2,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "fact",
    content: "Project B uses MongoDB replica set",
    importance: 2,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenB1 });

  // Query from Session A1
  var resA = await api("POST", "/api/internal/memory/retrieve", {}, {
    Authorization: "Bearer " + ctx.tokenA1,
  });
  assert(resA.status === 200, "Retrieval A returned 200");
  assert(resA.data.contextBrief.includes("SQLite with WAL"), "Session A retrieves Project A shared memory");
  assert(!resA.data.contextBrief.includes("MongoDB"), "Session A does NOT receive Project B shared memory");

  // Query from Session B1
  var resB = await api("POST", "/api/internal/memory/retrieve", {}, {
    Authorization: "Bearer " + ctx.tokenB1,
  });
  assert(resB.status === 200, "Retrieval B returned 200");
  assert(resB.data.contextBrief.includes("MongoDB"), "Session B retrieves Project B shared memory");
  assert(!resB.data.contextBrief.includes("SQLite with WAL"), "Session B does NOT receive Project A shared memory");
}

// ────────────────────────────────────────────────────────
// 2. Private Visibility Isolation
// ────────────────────────────────────────────────────────
async function test2_privateVisibility(ctx) {
  console.log("\n=== 2: Private Visibility Isolation ===");
  // Create private memory from Session A1
  await api("POST", "/api/internal/memory", {
    scope: "agent_private",
    type: "note",
    content: "Session A1 private scratchpad on token hashing",
    importance: 1,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  // Session A1 retrieves
  var resA1 = await api("POST", "/api/internal/memory/retrieve", {}, {
    Authorization: "Bearer " + ctx.tokenA1,
  });
  assert(resA1.data.contextBrief.includes("Session A1 private scratchpad"), "Session A1 retrieves own private memory");

  // Session A2 retrieves (same project, different session)
  var resA2 = await api("POST", "/api/internal/memory/retrieve", {}, {
    Authorization: "Bearer " + ctx.tokenA2,
  });
  assert(!resA2.data.contextBrief.includes("Session A1 private scratchpad"), "Session A2 CANNOT see Session A1 private memory");

  // Session A3 retrieves (standalone session)
  var resA3 = await api("POST", "/api/internal/memory/retrieve", {}, {
    Authorization: "Bearer " + ctx.tokenA3,
  });
  assert(!resA3.data.contextBrief.includes("Session A1 private scratchpad"), "Session A3 CANNOT see Session A1 private memory");
}

// ────────────────────────────────────────────────────────
// 3. Task Scoping Isolation
// ────────────────────────────────────────────────────────
async function test3_taskScoping(ctx) {
  console.log("\n=== 3: Task Scoping Isolation ===");
  // Create task memory for Task A1
  await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "constraint",
    content: "Task A1 constraint: auth middleware must run on port 4000",
    importance: 3,
    source: "agent",
    task_id: ctx.taskA1.id,
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  // Create task memory for Task A2
  await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "constraint",
    content: "Task A2 constraint: dashboard must run on port 5000",
    importance: 3,
    source: "agent",
    task_id: ctx.taskA2.id,
  }, { Authorization: "Bearer " + ctx.tokenA2 });

  // Session A1 (assigned to Task A1) retrieves
  var resA1 = await api("POST", "/api/internal/memory/retrieve", {}, {
    Authorization: "Bearer " + ctx.tokenA1,
  });
  assert(resA1.data.contextBrief.includes("port 4000"), "Session A1 sees Task A1 constraint");
  assert(!resA1.data.contextBrief.includes("port 5000"), "Session A1 does NOT see Task A2 constraint");

  // Session A2 (assigned to Task A2) retrieves
  var resA2 = await api("POST", "/api/internal/memory/retrieve", {}, {
    Authorization: "Bearer " + ctx.tokenA2,
  });
  assert(resA2.data.contextBrief.includes("port 5000"), "Session A2 sees Task A2 constraint");
  assert(!resA2.data.contextBrief.includes("port 4000"), "Session A2 does NOT see Task A1 constraint");

  // Session A3 (no task) retrieves
  var resA3 = await api("POST", "/api/internal/memory/retrieve", {}, {
    Authorization: "Bearer " + ctx.tokenA3,
  });
  assert(!resA3.data.contextBrief.includes("port 4000"), "Standalone session does NOT see Task A1 constraint");
  assert(!resA3.data.contextBrief.includes("port 5000"), "Standalone session does NOT see Task A2 constraint");
}

// ────────────────────────────────────────────────────────
// 4. Ranking by Importance
// ────────────────────────────────────────────────────────
async function test4_rankingByImportance(ctx) {
  console.log("\n=== 4: Ranking by Importance ===");
  await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "note",
    content: "Low priority guideline",
    importance: 1,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "note",
    content: "High priority security rule",
    importance: 3,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  var res = await api("POST", "/api/internal/memory/retrieve", {}, {
    Authorization: "Bearer " + ctx.tokenA1,
  });
  assert(res.status === 200, "Retrieve succeeded");
  var highMem = res.data.memories.find(function(m) { return m.content.includes("High priority"); });
  var lowMem = res.data.memories.find(function(m) { return m.content.includes("Low priority"); });
  assert(highMem !== undefined && lowMem !== undefined, "Both memories retrieved");
  assert(highMem.score > lowMem.score, "High importance score (" + highMem.score + ") > Low importance score (" + lowMem.score + ")");
}

// ────────────────────────────────────────────────────────
// 5. Ranking by Keyword / Query Overlap
// ────────────────────────────────────────────────────────
async function test5_rankingByKeyword(ctx) {
  console.log("\n=== 5: Ranking by Keyword Relevance ===");
  await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "fact",
    content: "Redis caching service configured on port 6379",
    importance: 1,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "fact",
    content: "Standard UI buttons use CSS gradient lavender",
    importance: 3,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  // Query specifically targeting redis caching
  var res = await api("POST", "/api/internal/memory/retrieve", {
    query: "configure Redis caching connection",
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  var redisMem = res.data.memories.find(function(m) { return m.content.includes("Redis caching"); });
  var uiMem = res.data.memories.find(function(m) { return m.content.includes("lavender"); });
  assert(redisMem !== undefined && uiMem !== undefined, "Both memories returned");
  assert(redisMem.score > uiMem.score, "Keyword match boosted Redis (" + redisMem.score + ") above UI (" + uiMem.score + ")");
}

// ────────────────────────────────────────────────────────
// 6. File Path Relevance Matching
// ────────────────────────────────────────────────────────
async function test6_filePathRelevance(ctx) {
  console.log("\n=== 6: File Path Relevance Matching ===");
  await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "fact",
    content: "JWT verification helper located in src/lib/jwt-verify.ts",
    importance: 1,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  var res = await api("POST", "/api/internal/memory/retrieve", {
    query: "inspecting src/lib/jwt-verify.ts for expiration logic",
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  var jwtMem = res.data.memories.find(function(m) { return m.content.includes("jwt-verify.ts"); });
  assert(jwtMem !== undefined, "JWT memory found");
  var hasPathReason = jwtMem.relevance_reasons.some(function(r) { return r.includes("file/path match"); });
  assert(hasPathReason, "Relevance reasons include file/path match");
}

// ────────────────────────────────────────────────────────
// 7. Token Budget Ceiling & Omission Counting
// ────────────────────────────────────────────────────────
async function test7_tokenBudgetCeiling(ctx) {
  console.log("\n=== 7: Token Budget Ceiling & Omission Counting ===");
  // Insert 20 long memories to easily overflow a small token budget
  for (var i = 1; i <= 20; i++) {
    await api("POST", "/api/internal/memory", {
      scope: "project_shared",
      type: "note",
      content: "Bulk memory item " + i + " with detailed explanation of system requirements and architectural patterns",
      importance: 1,
      source: "agent",
    }, { Authorization: "Bearer " + ctx.tokenA1 });
  }

  // Retrieve with small token budget: 100 tokens (~400 chars)
  var res = await api("POST", "/api/internal/memory/retrieve", {
    max_tokens: 100,
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  assert(res.status === 200, "Retrieve with budget succeeded");
  assert(res.data.tokensUsed <= 100, "tokensUsed (" + res.data.tokensUsed + ") <= maxTokens (100)");
  assert(res.data.omittedCount > 0, "omittedCount > 0 (" + res.data.omittedCount + ")");
  assert(res.data.contextBrief.includes("omitted for brevity"), "Brief contains omission notice");
}

// ────────────────────────────────────────────────────────
// 8. Archived Memories Excluded
// ────────────────────────────────────────────────────────
async function test8_archivedExcluded(ctx) {
  console.log("\n=== 8: Archived Memories Excluded from Retrieval ===");
  var createRes = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "note",
    content: "Deprecated configuration option that was archived",
    importance: 3,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA1 });

  var memId = createRes.data.memory.id;
  await api("POST", "/api/internal/memory/" + memId + "/archive", {}, {
    Authorization: "Bearer " + ctx.tokenA1,
  });

  var res = await api("POST", "/api/internal/memory/retrieve", {}, {
    Authorization: "Bearer " + ctx.tokenA1,
  });
  assert(!res.data.contextBrief.includes("Deprecated configuration option"), "Archived memory NOT in retrieved context");
  var found = res.data.memories.find(function(m) { return m.id === memId; });
  assert(found === undefined, "Archived memory NOT in candidates list");
}

// ────────────────────────────────────────────────────────
// 9. Internal Retrieval API via HTTP GET & POST
// ────────────────────────────────────────────────────────
async function test9_apiMethods(ctx) {
  console.log("\n=== 9: API HTTP GET and POST Verification ===");
  var getRes = await api("GET", "/api/internal/memory/retrieve?query=SQLite&max_tokens=500", null, {
    Authorization: "Bearer " + ctx.tokenA1,
  });
  assert(getRes.status === 200, "GET /api/internal/memory/retrieve works (200)");
  assert(getRes.data.ok === true, "GET response ok=true");
  assert(Array.isArray(getRes.data.memories), "GET memories is an array");

  var postRes = await api("POST", "/api/internal/memory/retrieve", {
    query: "SQLite",
    max_tokens: 500,
  }, { Authorization: "Bearer " + ctx.tokenA1 });
  assert(postRes.status === 200, "POST /api/internal/memory/retrieve works (200)");
  assert(postRes.data.ok === true, "POST response ok=true");
}

// ────────────────────────────────────────────────────────
// 10. Auth Rejection on Retrieval API
// ────────────────────────────────────────────────────────
async function test10_authRequired() {
  console.log("\n=== 10: Auth Required for Retrieval API ===");
  var resNoAuth = await api("POST", "/api/internal/memory/retrieve", {});
  assert(resNoAuth.status === 401, "No auth rejected (401)");

  var resBadAuth = await api("POST", "/api/internal/memory/retrieve", {}, {
    Authorization: "Bearer invalid_token_12345",
  });
  assert(resBadAuth.status === 401, "Invalid token rejected (401)");
}

// ────────────────────────────────────────────────────────
// 11. Project Memory Context Inspection Endpoint
// ────────────────────────────────────────────────────────
async function test11_contextEndpoint(ctx) {
  console.log("\n=== 11: Project Context Inspection Endpoint ===");
  var res = await api("GET", "/api/projects/" + ctx.projA.id + "/memory/context?task_id=" + ctx.taskA1.id);
  assert(res.status === 200, "Context endpoint works without auth (200)");
  assert(res.data.ok === true, "Context endpoint ok=true");
  assert(res.data.contextBrief.includes("Project A uses SQLite"), "Context contains shared memory");
}

// ────────────────────────────────────────────────────────
// 12. Empty Project Graceful Handling
// ────────────────────────────────────────────────────────
async function test12_emptyProject() {
  console.log("\n=== 12: Empty Project Graceful Handling ===");
  var emptyRepo = "/tmp/gmstage4-ret-empty";
  createGitRepo(emptyRepo);
  var emptyProj = await api("POST", "/api/projects", { name: "Empty Proj", repo_path: emptyRepo });

  var res = await api("GET", "/api/projects/" + emptyProj.data.project.id + "/memory/context");
  assert(res.status === 200, "Empty project context returns 200");
  assert(res.data.memories.length === 0, "0 memories returned");
  assert(res.data.contextBrief === "", "Empty brief string");
  assert(res.data.tokensUsed === 0, "0 tokens used");
}

// ────────────────────────────────────────────────────────
// Run all tests
// ────────────────────────────────────────────────────────
async function main() {
  console.log("GridMind Stage 4 Phase 2: Memory Retrieval Tests");
  console.log("================================================");

  var ctx = await setup();

  await test1_projectIsolation(ctx);
  await test2_privateVisibility(ctx);
  await test3_taskScoping(ctx);
  await test4_rankingByImportance(ctx);
  await test5_rankingByKeyword(ctx);
  await test6_filePathRelevance(ctx);
  await test7_tokenBudgetCeiling(ctx);
  await test8_archivedExcluded(ctx);
  await test9_apiMethods(ctx);
  await test10_authRequired();
  await test11_contextEndpoint(ctx);
  await test12_emptyProject();

  console.log("\n================================================");
  console.log("Results: " + passed + " passed, " + failed + " failed");
  console.log("================================================");

  try {
    execSync("rm -rf /tmp/gmstage4-ret-a /tmp/gmstage4-ret-b /tmp/gmstage4-ret-empty");
  } catch (e) { /* ignore */ }

  if (failed > 0) process.exit(1);
}

main().catch(function(err) {
  console.error("Test error:", err);
  process.exit(1);
});
