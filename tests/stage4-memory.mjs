#!/usr/bin/env node

/**
 * GridMind Stage 4 Tests: Memory Storage Foundation
 *
 * Run with: node tests/stage4-memory.mjs
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

// Setup: create 2 projects with sessions and tasks
async function setup() {
  console.log("=== Setup ===");
  var repoA = "/tmp/gmstage4-test-a";
  var repoB = "/tmp/gmstage4-test-b";
  createGitRepo(repoA);
  createGitRepo(repoB);

  var projA = await api("POST", "/api/projects", { name: "Project A", repo_path: repoA });
  var projB = await api("POST", "/api/projects", { name: "Project B", repo_path: repoB });
  assert(projA.status === 201, "Project A created");
  assert(projB.status === 201, "Project B created");

  // Create tasks in both projects
  var taskA = await api("POST", "/api/projects/" + projA.data.project.id + "/tasks", { title: "Task A1" });
  var taskB = await api("POST", "/api/projects/" + projB.data.project.id + "/tasks", { title: "Task B1" });
  assert(taskA.status === 201, "Task A1 created");
  assert(taskB.status === 201, "Task B1 created");

  // Create sessions (with tasks) to get tokens
  var sessA = await api("POST", "/api/projects/" + projA.data.project.id + "/agents", {
    prompt: "test agent A",
    taskId: taskA.data.task.id,
  });
  var sessB = await api("POST", "/api/projects/" + projB.data.project.id + "/agents", {
    prompt: "test agent B",
    taskId: taskB.data.task.id,
  });
  assert(sessA.status === 201, "Session A created");
  assert(sessB.status === 201, "Session B created");

  // Also create a second session in project A (for private memory isolation test)
  var sessA2 = await api("POST", "/api/projects/" + projA.data.project.id + "/agents", {
    prompt: "test agent A2",
  });
  assert(sessA2.status === 201, "Session A2 created");

  return {
    projA: projA.data.project,
    projB: projB.data.project,
    taskA: taskA.data.task,
    taskB: taskB.data.task,
    tokenA: sessA.data.session.token,
    tokenB: sessB.data.session.token,
    tokenA2: sessA2.data.session.token,
    sessionA: sessA.data.session,
    sessionB: sessB.data.session,
    sessionA2: sessA2.data.session,
  };
}

// ────────────────────────────────────────────────────────
// 1. Create project_shared memory
// ────────────────────────────────────────────────────────
async function test1_createProjectShared(ctx) {
  console.log("\n=== 1: Create project_shared memory ===");
  var res = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "fact",
    content: "Auth middleware lives in src/auth/middleware.ts",
    importance: 2,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA });

  assert(res.status === 201, "Memory created (201)");
  assert(res.data.ok === true, "Response ok=true");
  assert(res.data.memory.scope === "project_shared", "Scope is project_shared");
  assert(res.data.memory.type === "fact", "Type is fact");
  assert(res.data.memory.importance === 2, "Importance is 2");
  assert(res.data.memory.content === "Auth middleware lives in src/auth/middleware.ts", "Content matches");
  assert(res.data.memory.project_id === ctx.projA.id, "Project ID matches");
  assert(res.data.memory.archived_at === null, "Not archived");
}

// ────────────────────────────────────────────────────────
// 2. Read project_shared memory
// ────────────────────────────────────────────────────────
async function test2_readProjectShared(ctx) {
  console.log("\n=== 2: Read project_shared memory ===");
  var res = await api("GET", "/api/internal/memory?scope=project_shared", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(res.status === 200, "List returned (200)");
  assert(res.data.memories.length >= 1, "At least 1 memory returned");
  var found = res.data.memories.find(function(m) { return m.content.indexOf("Auth middleware") !== -1; });
  assert(found !== undefined, "Found the auth middleware memory");
}

// ────────────────────────────────────────────────────────
// 3. Create agent_private memory
// ────────────────────────────────────────────────────────
async function test3_createAgentPrivate(ctx) {
  console.log("\n=== 3: Create agent_private memory ===");
  var res = await api("POST", "/api/internal/memory", {
    scope: "agent_private",
    type: "discovery",
    content: "The test runner uses fetch() for all HTTP calls",
    importance: 1,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA });

  assert(res.status === 201, "Private memory created (201)");
  assert(res.data.memory.scope === "agent_private", "Scope is agent_private");
  assert(res.data.memory.session_id === ctx.sessionA.id, "session_id matches creating session");
}

// ────────────────────────────────────────────────────────
// 4. Owning agent/session can access private memory
// ────────────────────────────────────────────────────────
async function test4_owningAgentCanAccess(ctx) {
  console.log("\n=== 4: Owning agent can access private memory ===");
  var res = await api("GET", "/api/internal/memory?scope=agent_private", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(res.status === 200, "Own session can list (200)");
  var found = res.data.memories.find(function(m) { return m.session_id === ctx.sessionA.id; });
  assert(found !== undefined, "Own private memory is visible");
}

// ────────────────────────────────────────────────────────
// 5. Another agent/session cannot access private memory
// ────────────────────────────────────────────────────────
async function test5_otherAgentCannotAccess(ctx) {
  console.log("\n=== 5: Other agent cannot access private memory ===");
  var res = await api("GET", "/api/internal/memory?scope=agent_private", null, {
    Authorization: "Bearer " + ctx.tokenA2,
  });
  assert(res.status === 200, "Other session gets list (200)");
  var found = res.data.memories.find(function(m) { return m.session_id === ctx.sessionA.id; });
  assert(found === undefined, "Other session's private memory is NOT visible");
}

// ────────────────────────────────────────────────────────
// 6. Create task memory
// ────────────────────────────────────────────────────────
async function test6_createTaskMemory(ctx) {
  console.log("\n=== 6: Create task memory ===");
  var res = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "constraint",
    content: "Must not modify the auth middleware without approval",
    importance: 3,
    source: "user",
    task_id: ctx.taskA.id,
  }, { Authorization: "Bearer " + ctx.tokenA });

  assert(res.status === 201, "Task memory created (201)");
  assert(res.data.memory.scope === "task", "Scope is task");
  assert(res.data.memory.task_id === ctx.taskA.id, "task_id matches");
  assert(res.data.memory.importance === 3, "Importance is 3");
}

// ────────────────────────────────────────────────────────
// 7. Task memory is linked to the correct task
// ────────────────────────────────────────────────────────
async function test7_taskMemoryLinked(ctx) {
  console.log("\n=== 7: Task memory linked to correct task ===");
  var res = await api("GET", "/api/internal/memory?task_id=" + ctx.taskA.id, null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(res.status === 200, "List by task_id returned (200)");
  var found = res.data.memories.find(function(m) { return m.task_id === ctx.taskA.id; });
  assert(found !== undefined, "Memory linked to task A found");
}

// ────────────────────────────────────────────────────────
// 8. Cross-project task attachment fails
// ────────────────────────────────────────────────────────
async function test8_crossProjectTaskFails(ctx) {
  console.log("\n=== 8: Cross-project task attachment fails ===");
  var res = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "note",
    content: "test",
    source: "agent",
    task_id: ctx.taskB.id,
  }, { Authorization: "Bearer " + ctx.tokenA });

  assert(res.status === 404, "Cross-project task rejected (404)");
}

// ────────────────────────────────────────────────────────
// 9. Cross-project session attachment fails
// ────────────────────────────────────────────────────────
async function test9_crossProjectSessionFails(ctx) {
  console.log("\n=== 9: Cross-project session attachment fails ===");
  // Session B cannot create memory in project A
  var res = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "note",
    content: "injected from project B",
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenB });

  // Session B belongs to project B, so the memory goes to project B, not A
  assert(res.status === 201, "Memory created in session B's own project (201)");
  assert(res.data.memory.project_id === ctx.projB.id, "Memory belongs to project B");
}

// ────────────────────────────────────────────────────────
// 10. Cross-project memory access fails
// ────────────────────────────────────────────────────────
async function test10_crossProjectAccessFails(ctx) {
  console.log("\n=== 10: Cross-project memory access fails ===");
  // Session A lists its own project's memories
  var resA = await api("GET", "/api/internal/memory", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  // Should not contain project B's memories
  var hasProjectB = resA.data.memories.some(function(m) { return m.project_id === ctx.projB.id; });
  assert(!hasProjectB, "Project A does not see project B memories");
}

// ────────────────────────────────────────────────────────
// 11. Project A cannot modify Project B memory
// ────────────────────────────────────────────────────────
async function test11_crossProjectModifyFails(ctx) {
  console.log("\n=== 11: Project A cannot modify Project B memory ===");
  // First create a memory in project B
  var createRes = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "note",
    content: "Project B memory",
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenB });
  var memId = createRes.data.memory.id;

  // Try to update it from project A session
  var updateRes = await api("PATCH", "/api/internal/memory/" + memId, {
    content: "hacked",
  }, { Authorization: "Bearer " + ctx.tokenA });

  assert(updateRes.status === 404, "Cross-project update rejected (404)");
}

// ────────────────────────────────────────────────────────
// 12. Archive memory
// ────────────────────────────────────────────────────────
async function test12_archiveMemory(ctx) {
  console.log("\n=== 12: Archive memory ===");
  // Create a memory to archive
  var createRes = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "note",
    content: "Memory to archive",
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA });
  var memId = createRes.data.memory.id;

  // Archive it
  var archiveRes = await api("POST", "/api/internal/memory/" + memId + "/archive", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(archiveRes.status === 200, "Archive succeeded (200)");
  assert(archiveRes.data.memory.archived_at !== null, "archived_at is set");
}

// ────────────────────────────────────────────────────────
// 13. Archived memory excluded from active listings
// ────────────────────────────────────────────────────────
async function test13_archivedExcludedFromActive(ctx) {
  console.log("\n=== 13: Archived memory excluded from active listings ===");
  var res = await api("GET", "/api/internal/memory", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  var found = res.data.memories.find(function(m) { return m.content === "Memory to archive"; });
  assert(found === undefined, "Archived memory not in active list");
}

// ────────────────────────────────────────────────────────
// 14. Archived memory visible when includeArchived=true
// ────────────────────────────────────────────────────────
async function test14_archivedVisibleWithFlag(ctx) {
  console.log("\n=== 14: Archived memory visible with includeArchived ===");
  var res = await api("GET", "/api/internal/memory?archived=true", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  var found = res.data.memories.find(function(m) { return m.content === "Memory to archive"; });
  assert(found !== undefined, "Archived memory visible with archived=true");
}

// ────────────────────────────────────────────────────────
// 15. Invalid scope rejected
// ────────────────────────────────────────────────────────
async function test15_invalidScope(ctx) {
  console.log("\n=== 15: Invalid scope rejected ===");
  var res = await api("POST", "/api/internal/memory", {
    scope: "global",
    type: "note",
    content: "test",
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA });
  assert(res.status === 400, "Invalid scope rejected (400)");
}

// ────────────────────────────────────────────────────────
// 16. Invalid type rejected
// ────────────────────────────────────────────────────────
async function test16_invalidType(ctx) {
  console.log("\n=== 16: Invalid type rejected ===");
  var res = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "invalid_type",
    content: "test",
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA });
  assert(res.status === 400, "Invalid type rejected (400)");
}

// ────────────────────────────────────────────────────────
// 17. Invalid importance rejected
// ────────────────────────────────────────────────────────
async function test17_invalidImportance(ctx) {
  console.log("\n=== 17: Invalid importance rejected ===");
  var res = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "note",
    content: "test",
    importance: 5,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA });
  assert(res.status === 400, "Invalid importance rejected (400)");
}

// ────────────────────────────────────────────────────────
// 18. Empty content rejected
// ────────────────────────────────────────────────────────
async function test18_emptyContent(ctx) {
  console.log("\n=== 18: Empty content rejected ===");
  var res = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "note",
    content: "",
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA });
  assert(res.status === 400, "Empty content rejected (400)");
}

// ────────────────────────────────────────────────────────
// 19. Auth required for memory operations
// ────────────────────────────────────────────────────────
async function test19_authRequired() {
  console.log("\n=== 19: Auth required for memory operations ===");
  var post = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "note",
    content: "test",
    source: "agent",
  });
  assert(post.status === 401, "POST requires auth (401)");

  var get = await api("GET", "/api/internal/memory");
  assert(get.status === 401, "GET requires auth (401)");
}

// ────────────────────────────────────────────────────────
// 20. Task memory without task_id rejected
// ────────────────────────────────────────────────────────
async function test20_taskMemoryRequiresTaskId(ctx) {
  console.log("\n=== 20: Task memory without task_id rejected ===");
  var res = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "note",
    content: "test",
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA });
  assert(res.status === 400, "Task memory without task_id rejected (400)");
}

// ────────────────────────────────────────────────────────
// 21. Task memory with non-existent task rejected
// ────────────────────────────────────────────────────────
async function test21_nonExistentTask(ctx) {
  console.log("\n=== 21: Non-existent task rejected ===");
  var res = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "note",
    content: "test",
    source: "agent",
    task_id: "nonexistent123",
  }, { Authorization: "Bearer " + ctx.tokenA });
  assert(res.status === 404, "Non-existent task rejected (404)");
}

// ────────────────────────────────────────────────────────
// 22. Update memory
// ────────────────────────────────────────────────────────
async function test22_updateMemory(ctx) {
  console.log("\n=== 22: Update memory ===");
  var createRes = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "note",
    content: "Original content",
    importance: 1,
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA });
  var memId = createRes.data.memory.id;

  var updateRes = await api("PATCH", "/api/internal/memory/" + memId, {
    content: "Updated content",
    importance: 3,
  }, { Authorization: "Bearer " + ctx.tokenA });
  assert(updateRes.status === 200, "Update succeeded (200)");
  assert(updateRes.data.memory.content === "Updated content", "Content updated");
  assert(updateRes.data.memory.importance === 3, "Importance updated");
}

// ────────────────────────────────────────────────────────
// 23. Update archived memory fails
// ────────────────────────────────────────────────────────
async function test23_updateArchivedFails(ctx) {
  console.log("\n=== 23: Update archived memory fails ===");
  var createRes = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "note",
    content: "Will be archived",
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA });
  var memId = createRes.data.memory.id;

  await api("POST", "/api/internal/memory/" + memId + "/archive", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });

  var updateRes = await api("PATCH", "/api/internal/memory/" + memId, {
    content: "hacked",
  }, { Authorization: "Bearer " + ctx.tokenA });
  assert(updateRes.status === 404, "Update archived memory rejected (404)");
}

// ────────────────────────────────────────────────────────
// 24. Private memory isolated between sessions in same project
// ────────────────────────────────────────────────────────
async function test24_privateIsolationBetweenSessions(ctx) {
  console.log("\n=== 24: Private memory isolated between sessions ===");
  // Create private memory from session A2
  await api("POST", "/api/internal/memory", {
    scope: "agent_private",
    type: "note",
    content: "A2 private thought",
    source: "agent",
  }, { Authorization: "Bearer " + ctx.tokenA2 });

  // Session A should NOT see A2's private memory
  var resA = await api("GET", "/api/internal/memory?scope=agent_private", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  var foundA = resA.data.memories.find(function(m) { return m.content === "A2 private thought"; });
  assert(foundA === undefined, "Session A cannot see session A2's private memory");

  // Session A2 should see its own private memory
  var resA2 = await api("GET", "/api/internal/memory?scope=agent_private", null, {
    Authorization: "Bearer " + ctx.tokenA2,
  });
  var foundA2 = resA2.data.memories.find(function(m) { return m.content === "A2 private thought"; });
  assert(foundA2 !== undefined, "Session A2 can see its own private memory");
}

// ────────────────────────────────────────────────────────
// Run all tests
// ────────────────────────────────────────────────────────
async function main() {
  console.log("GridMind Stage 4: Memory Storage Foundation Tests");
  console.log("=================================================");

  var ctx = await setup();

  await test1_createProjectShared(ctx);
  await test2_readProjectShared(ctx);
  await test3_createAgentPrivate(ctx);
  await test4_owningAgentCanAccess(ctx);
  await test5_otherAgentCannotAccess(ctx);
  await test6_createTaskMemory(ctx);
  await test7_taskMemoryLinked(ctx);
  await test8_crossProjectTaskFails(ctx);
  await test9_crossProjectSessionFails(ctx);
  await test10_crossProjectAccessFails(ctx);
  await test11_crossProjectModifyFails(ctx);
  await test12_archiveMemory(ctx);
  await test13_archivedExcludedFromActive(ctx);
  await test14_archivedVisibleWithFlag(ctx);
  await test15_invalidScope(ctx);
  await test16_invalidType(ctx);
  await test17_invalidImportance(ctx);
  await test18_emptyContent(ctx);
  await test19_authRequired();
  await test20_taskMemoryRequiresTaskId(ctx);
  await test21_nonExistentTask(ctx);
  await test22_updateMemory(ctx);
  await test23_updateArchivedFails(ctx);
  await test24_privateIsolationBetweenSessions(ctx);

  console.log("\n=================================================");
  console.log("Results: " + passed + " passed, " + failed + " failed");
  console.log("=================================================");

  try { execSync("rm -rf /tmp/gmstage4-test-a /tmp/gmstage4-test-b"); } catch (e) { /* ignore */ }

  if (failed > 0) process.exit(1);
}

main().catch(function(err) {
  console.error("Test error:", err);
  process.exit(1);
});
