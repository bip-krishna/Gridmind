#!/usr/bin/env node

/**
 * GridMind Stage 4: Cross-Task Authorization Regression Tests (ARCH-01)
 *
 * Enforces:
 *   session -> session.task_id -> task.id -> task.project_id
 *
 * Verifies that worker sessions cannot perform task-scoped operations against
 * other tasks in the same project, while preserving master coordination semantics.
 *
 * Run with: node tests/stage4-task-auth.mjs
 * Requires: server running on localhost:3000
 */

const BASE = process.env.GRIDMIND_API || "http://localhost:3000";

import { execSync } from "node:child_process";

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
  headers = Object.assign({ "Content-Type": "application/json" }, headers || {});
  var opts = { method: method, headers: headers };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(BASE + urlPath, opts);
  var text = await res.text();
  var data = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, data: data };
}

function createGitRepo(dir) {
  execSync("rm -rf " + dir + " && mkdir -p " + dir);
  execSync("cd " + dir + " && git init -q && git config user.email t@t.com && git config user.name t && echo init > README.md && git add -A && git commit -qm init");
}

async function setup() {
  console.log("=== Setup ===");
  var repo1 = "/tmp/gmtaskauth-proj1";
  var repo2 = "/tmp/gmtaskauth-proj2";
  createGitRepo(repo1);
  createGitRepo(repo2);

  // Project 1
  var proj1Res = await api("POST", "/api/projects", { name: "Task Auth Project 1", repo_path: repo1 });
  assert(proj1Res.status === 201, "Project 1 created");
  var proj1 = proj1Res.data.project;

  // Project 2 (for cross-project checks)
  var proj2Res = await api("POST", "/api/projects", { name: "Task Auth Project 2", repo_path: repo2 });
  assert(proj2Res.status === 201, "Project 2 created");
  var proj2 = proj2Res.data.project;

  // Tasks in Project 1
  var task1ARes = await api("POST", "/api/projects/" + proj1.id + "/tasks", { title: "Task 1A: Backend Auth" });
  var task1BRes = await api("POST", "/api/projects/" + proj1.id + "/tasks", { title: "Task 1B: Frontend UI" });
  assert(task1ARes.status === 201, "Task 1A created");
  assert(task1BRes.status === 201, "Task 1B created");
  var task1A = task1ARes.data.task;
  var task1B = task1BRes.data.task;

  // Task in Project 2
  var task2Res = await api("POST", "/api/projects/" + proj2.id + "/tasks", { title: "Task 2: Foreign Task" });
  assert(task2Res.status === 201, "Task 2 created in Project 2");
  var task2 = task2Res.data.task;

  // Worker A: assigned to Task 1A in Project 1
  var sessARes = await api("POST", "/api/projects/" + proj1.id + "/agents", {
    prompt: "worker agent A",
    taskId: task1A.id,
    role: "worker",
  });
  assert(sessARes.status === 201, "Worker A session created (assigned to Task 1A)");
  var sessA = sessARes.data.session;
  var tokenA = sessA.token;

  // Worker B: assigned to Task 1B in Project 1
  var sessBRes = await api("POST", "/api/projects/" + proj1.id + "/agents", {
    prompt: "worker agent B",
    taskId: task1B.id,
    role: "worker",
  });
  assert(sessBRes.status === 201, "Worker B session created (assigned to Task 1B)");
  var sessB = sessBRes.data.session;
  var tokenB = sessB.token;

  // Master: Project 1 coordinator session
  var sessMasterRes = await api("POST", "/api/projects/" + proj1.id + "/agents", {
    prompt: "master coordinator agent",
    role: "master",
  });
  assert(sessMasterRes.status === 201, "Master session created for Project 1");
  var sessMaster = sessMasterRes.data.session;
  var tokenMaster = sessMaster.token;

  // Worker C: assigned to Task 2 in Project 2
  var sessCRes = await api("POST", "/api/projects/" + proj2.id + "/agents", {
    prompt: "worker agent C in Project 2",
    taskId: task2.id,
    role: "worker",
  });
  assert(sessCRes.status === 201, "Worker C session created for Project 2");
  var sessC = sessCRes.data.session;
  var tokenC = sessC.token;

  return {
    proj1,
    proj2,
    task1A,
    task1B,
    task2,
    sessA,
    sessB,
    sessMaster,
    sessC,
    tokenA,
    tokenB,
    tokenMaster,
    tokenC,
  };
}

// ────────────────────────────────────────────────────────
// 1. Worker A can access Task A
// 2. Worker A cannot access Task B
// ────────────────────────────────────────────────────────
async function test_task_access(ctx) {
  console.log("\n=== 1 & 2: Task Inspection Access Control ===");

  // 1. Worker A accesses Task 1A via GET /api/internal/tasks/:id
  var resAOwn = await api("GET", "/api/internal/tasks/" + ctx.task1A.id, null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(resAOwn.status === 200, "1a. Worker A can access Task 1A via GET /api/internal/tasks/:id (200)");
  assert(resAOwn.data?.task?.id === ctx.task1A.id, "1b. Returned task matches Task 1A");

  // Worker A accesses Task 1A status via GET /api/internal/tasks/:id/status
  var resAStatusOwn = await api("GET", "/api/internal/tasks/" + ctx.task1A.id + "/status", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(resAStatusOwn.status === 200, "1c. Worker A can access Task 1A status (200)");

  // 2. Worker A cannot access Task 1B via GET /api/internal/tasks/:id
  var resAOther = await api("GET", "/api/internal/tasks/" + ctx.task1B.id, null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(resAOther.status === 403, "2a. Worker A cannot access Task 1B via GET /api/internal/tasks/:id (403 Forbidden)");

  // Worker A cannot access Task 1B status via GET /api/internal/tasks/:id/status
  var resAStatusOther = await api("GET", "/api/internal/tasks/" + ctx.task1B.id + "/status", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(resAStatusOther.status === 403, "2b. Worker A cannot access Task 1B status (403 Forbidden)");
}

// ────────────────────────────────────────────────────────
// 3. Worker A cannot update Task B
// ────────────────────────────────────────────────────────
async function test_task_update(ctx) {
  console.log("\n=== 3: Task Status Update Authorization ===");

  // Worker A attempts to update Task 1B status to 'in_progress'
  var resUpdateB = await api("POST", "/api/internal/tasks/" + ctx.task1B.id + "/status", {
    status: "in_progress",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(resUpdateB.status === 403, "3a. Worker A cannot update Task 1B status (403 Forbidden)");

  // Verify Worker B CAN update its own task
  var resUpdateBOwn = await api("POST", "/api/internal/tasks/" + ctx.task1B.id + "/status", {
    status: "in_progress",
  }, {
    Authorization: "Bearer " + ctx.tokenB,
  });
  assert(resUpdateBOwn.status === 200, "3b. Worker B can update Task 1B status (200 OK)");

  // Verify Worker A CAN update its own task (queued -> in_progress)
  var resUpdateAOwn = await api("POST", "/api/internal/tasks/" + ctx.task1A.id + "/status", {
    status: "in_progress",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(resUpdateAOwn.status === 200, "3c. Worker A can update Task 1A status (200 OK)");
}

// ────────────────────────────────────────────────────────
// 4 & 5: Memory Creation & Archiving Cross-Task Protection
// ────────────────────────────────────────────────────────
async function test_memory_create_and_archive(ctx) {
  console.log("\n=== 4 & 5: Task Memory Create, Modify & Archive Authorization ===");

  // 5. Worker A cannot create memory for Task 1B
  var createBByA = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "discovery",
    content: "Worker A trying to inject Task 1B memory",
    task_id: ctx.task1B.id,
    importance: 2,
    source: "agent",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(createBByA.status === 403, "5a. Worker A cannot create memory for Task 1B (403 Forbidden)");

  // Worker B creates legitimate task memory for Task 1B
  var createBByB = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "discovery",
    content: "Task 1B UI design token system established",
    task_id: ctx.task1B.id,
    importance: 3,
    source: "agent",
  }, {
    Authorization: "Bearer " + ctx.tokenB,
  });
  assert(createBByB.status === 201, "5b. Worker B can create memory for Task 1B (201 Created)");
  var memBId = createBByB.data?.memory?.id;

  // Worker A attempts to modify Task 1B memory via PATCH
  var patchBByA = await api("PATCH", "/api/internal/memory/" + memBId, {
    content: "Tampered content by Worker A",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(patchBByA.status === 403, "5c. Worker A cannot modify Task 1B memory (403 Forbidden)");

  // 4. Worker A cannot archive Task 1B memory
  var archiveBByA = await api("POST", "/api/internal/memory/" + memBId + "/archive", {}, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(archiveBByA.status === 403, "4a. Worker A cannot archive Task 1B memory (403 Forbidden)");

  // Verify memory remains active
  var listB = await api("GET", "/api/internal/memory?task_id=" + ctx.task1B.id, null, {
    Authorization: "Bearer " + ctx.tokenB,
  });
  var found = (listB.data?.memories || []).find((m) => m.id === memBId);
  assert(found && found.archived_at === null, "4b. Task 1B memory remains active and unarchived");

  return { memBId };
}

// ────────────────────────────────────────────────────────
// 6 & 7: Retrieval Cross-Task Protection
// ────────────────────────────────────────────────────────
async function test_retrieval_auth(ctx) {
  console.log("\n=== 6 & 7: Retrieval Cross-Task Protection ===");

  // 6a. Direct listing: Worker A cannot pass task_id=Task1B to GET /api/internal/memory
  var getListByA = await api("GET", "/api/internal/memory?task_id=" + ctx.task1B.id, null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(getListByA.status === 403, "6a. Worker A direct query ?task_id=Task1B returns 403 Forbidden");

  // 6b. Unscoped listing: Task 1B memory does NOT appear in Worker A unscoped GET
  var getUnscopedA = await api("GET", "/api/internal/memory", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(getUnscopedA.status === 200, "6b. Worker A unscoped GET /api/internal/memory returns 200");
  var leaked = (getUnscopedA.data?.memories || []).some((m) => m.task_id === ctx.task1B.id);
  assert(!leaked, "6c. Task 1B memories are NOT present in Worker A unscoped memory list");

  // 7a. Worker A attempts POST /api/internal/memory/retrieve with task_id=Task1B
  var postRetrieveA1 = await api("POST", "/api/internal/memory/retrieve", {
    query: "design token",
    task_id: ctx.task1B.id,
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(postRetrieveA1.status === 403, "7a. Worker A POST retrieve with task_id=Task1B returns 403 Forbidden");

  // 7b. Worker A attempts POST /api/internal/memory/retrieve with taskId=Task1B
  var postRetrieveA2 = await api("POST", "/api/internal/memory/retrieve", {
    query: "design token",
    taskId: ctx.task1B.id,
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(postRetrieveA2.status === 403, "7b. Worker A POST retrieve with taskId=Task1B returns 403 Forbidden");

  // 7c. Worker A attempts GET /api/internal/memory/retrieve?task_id=Task1B
  var getRetrieveA = await api("GET", "/api/internal/memory/retrieve?query=token&task_id=" + ctx.task1B.id, null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(getRetrieveA.status === 403, "7c. Worker A GET retrieve with ?task_id=Task1B returns 403 Forbidden");

  // 7d. Worker A attempts GET /api/projects/:id/memory/context?task_id=Task1B
  var getProjContextA = await api("GET", "/api/projects/" + ctx.proj1.id + "/memory/context?task_id=" + ctx.task1B.id, null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(getProjContextA.status === 403, "7d. Worker A GET project memory context with ?task_id=Task1B returns 403 Forbidden");

  // 6d. Worker A normal retrieval searching for keywords from Task 1B memory does NOT receive Task 1B content
  var normalRetrieveA = await api("POST", "/api/internal/memory/retrieve", {
    query: "design token UI system",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(normalRetrieveA.status === 200, "6d. Worker A normal retrieval succeeds (200 OK)");
  var matchedB = (normalRetrieveA.data?.memories || []).some((m) => m.task_id === ctx.task1B.id);
  assert(!matchedB, "6e. Task 1B memory NOT returned to Worker A even when query matches keywords");
  assert(!normalRetrieveA.data?.contextBrief?.includes("design token"), "6f. contextBrief does NOT contain Task 1B content");
}

// ────────────────────────────────────────────────────────
// 8. Cross-Project Task Access Denied
// ────────────────────────────────────────────────────────
async function test_cross_project(ctx) {
  console.log("\n=== 8: Cross-Project Isolation ===");

  // Worker A (Project 1) attempts GET /api/internal/tasks/:id on Task 2 (Project 2)
  var resForeignTask = await api("GET", "/api/internal/tasks/" + ctx.task2.id, null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(resForeignTask.status === 404 || resForeignTask.status === 403, "8a. Worker A accessing Project 2 task is rejected (404/403)");

  // Worker A attempts POST /api/internal/tasks/:id/status on Task 2
  var resForeignStatus = await api("POST", "/api/internal/tasks/" + ctx.task2.id + "/status", {
    status: "in_progress",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(resForeignStatus.status === 404 || resForeignStatus.status === 403, "8b. Worker A updating Project 2 task status is rejected (404/403)");

  // Worker A attempts to create task-scoped memory for Task 2
  var resForeignMemory = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "note",
    content: "Foreign task note attempt",
    task_id: ctx.task2.id,
    source: "agent",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(resForeignMemory.status === 404 || resForeignMemory.status === 403, "8c. Worker A creating memory for Project 2 task is rejected (404/403)");

  // Worker C (Project 2) attempts to access Task 1A (Project 1)
  var resWorkerCOn1A = await api("GET", "/api/internal/tasks/" + ctx.task1A.id, null, {
    Authorization: "Bearer " + ctx.tokenC,
  });
  assert(resWorkerCOn1A.status === 404 || resWorkerCOn1A.status === 403, "8d. Worker C accessing Project 1 task is rejected (404/403)");
}

// ────────────────────────────────────────────────────────
// 9. Worker A Can Still Access Its Own Task Memory
// ────────────────────────────────────────────────────────
async function test_worker_own_task_memory(ctx) {
  console.log("\n=== 9: Worker Access to Own Task Memory ===");

  // Create task memory for Task 1A by Worker A
  var createA = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "constraint",
    content: "Auth tokens must use HS256 with 32-byte secret",
    task_id: ctx.task1A.id,
    importance: 3,
    source: "agent",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(createA.status === 201, "9a. Worker A can create task memory for Task 1A (201 Created)");
  var memAId = createA.data?.memory?.id;

  // Worker A queries its own task memory directly
  var getOwn = await api("GET", "/api/internal/memory?task_id=" + ctx.task1A.id, null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(getOwn.status === 200, "9b. Worker A can query ?task_id=Task1A (200 OK)");
  var foundOwn = (getOwn.data?.memories || []).some((m) => m.id === memAId);
  assert(foundOwn, "9c. Worker A finds its own task memory");

  // Worker A retrieves memory and gets [CURRENT TASK CONTEXT]
  var retrieveOwn = await api("POST", "/api/internal/memory/retrieve", {
    query: "auth token secret",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(retrieveOwn.status === 200, "9d. Worker A retrieve returns 200 OK");
  assert(retrieveOwn.data?.contextBrief?.includes("[CURRENT TASK CONTEXT]"), "9e. Context brief contains [CURRENT TASK CONTEXT]");
  assert(retrieveOwn.data?.contextBrief?.includes("HS256"), "9f. Context brief contains Task 1A memory content");

  // Worker A updates its own task memory
  var patchOwn = await api("PATCH", "/api/internal/memory/" + memAId, {
    content: "Auth tokens must use HS256 with 64-byte secret",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(patchOwn.status === 200, "9g. Worker A can update own task memory (200 OK)");

  // Worker A archives its own task memory
  var archiveOwn = await api("POST", "/api/internal/memory/" + memAId + "/archive", {}, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(archiveOwn.status === 200, "9h. Worker A can archive own task memory (200 OK)");
}

// ────────────────────────────────────────────────────────
// 10. Master Behavior Remains Valid
// ────────────────────────────────────────────────────────
async function test_master_behavior(ctx) {
  console.log("\n=== 10: Master Project-Wide Coordination Semantics ===");

  // Master can inspect Task 1A
  var masterGet1A = await api("GET", "/api/internal/tasks/" + ctx.task1A.id, null, {
    Authorization: "Bearer " + ctx.tokenMaster,
  });
  assert(masterGet1A.status === 200, "10a. Master can inspect Task 1A (200 OK)");

  // Master can inspect Task 1B
  var masterGet1B = await api("GET", "/api/internal/tasks/" + ctx.task1B.id, null, {
    Authorization: "Bearer " + ctx.tokenMaster,
  });
  assert(masterGet1B.status === 200, "10b. Master can inspect Task 1B (200 OK)");

  // Master can create task memory for Task 1A
  var masterCreate1A = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "note",
    content: "Master directive for Task 1A architecture",
    task_id: ctx.task1A.id,
    importance: 2,
    source: "agent",
  }, {
    Authorization: "Bearer " + ctx.tokenMaster,
  });
  assert(masterCreate1A.status === 201, "10c. Master can create task memory for Task 1A (201 Created)");
  var masterMemId = masterCreate1A.data?.memory?.id;

  // Master can create task memory for Task 1B
  var masterCreate1B = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "note",
    content: "Master directive for Task 1B design review",
    task_id: ctx.task1B.id,
    importance: 2,
    source: "agent",
  }, {
    Authorization: "Bearer " + ctx.tokenMaster,
  });
  assert(masterCreate1B.status === 201, "10d. Master can create task memory for Task 1B (201 Created)");

  // Master can query Task 1B memories directly
  var masterList1B = await api("GET", "/api/internal/memory?task_id=" + ctx.task1B.id, null, {
    Authorization: "Bearer " + ctx.tokenMaster,
  });
  assert(masterList1B.status === 200, "10e. Master can query ?task_id=Task1B (200 OK)");

  // Master can retrieve targeting Task 1B
  var masterRetrieve1B = await api("POST", "/api/internal/memory/retrieve", {
    query: "design review",
    task_id: ctx.task1B.id,
  }, {
    Authorization: "Bearer " + ctx.tokenMaster,
  });
  assert(masterRetrieve1B.status === 200, "10f. Master can retrieve targeting Task 1B (200 OK)");
  var foundInMaster = (masterRetrieve1B.data?.memories || []).some((m) => m.task_id === ctx.task1B.id);
  assert(foundInMaster, "10g. Master receives Task 1B memories in retrieval");

  // Master can modify task memory
  var masterPatch = await api("PATCH", "/api/internal/memory/" + masterMemId, {
    content: "Master revised directive for Task 1A architecture",
  }, {
    Authorization: "Bearer " + ctx.tokenMaster,
  });
  assert(masterPatch.status === 200, "10h. Master can modify task memory in project (200 OK)");

  // Master can archive task memory
  var masterArchive = await api("POST", "/api/internal/memory/" + masterMemId + "/archive", {}, {
    Authorization: "Bearer " + ctx.tokenMaster,
  });
  assert(masterArchive.status === 200, "10i. Master can archive task memory in project (200 OK)");

  // Master CANNOT operate on foreign project (Project 2)
  var masterForeign = await api("GET", "/api/internal/tasks/" + ctx.task2.id, null, {
    Authorization: "Bearer " + ctx.tokenMaster,
  });
  assert(masterForeign.status === 404 || masterForeign.status === 403, "10j. Master cross-project access to Project 2 is denied");
}

// ────────────────────────────────────────────────────────
// 11 & 12: Input Validation for Task-Scoped Memory
// ────────────────────────────────────────────────────────
async function test_task_memory_validation(ctx) {
  console.log("\n=== 11 & 12: Task-Scoped Memory Validation ===");

  // 11. task-scoped memory without task_id is rejected
  var noTaskId = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "fact",
    content: "Task memory missing taskId",
    source: "agent",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(noTaskId.status === 400, "11a. Task memory without task_id rejected with 400");
  assert(noTaskId.data?.error?.includes("task_id is required"), "11b. Error indicates task_id is required");

  // 12. task-scoped memory with another project's task_id is rejected
  var otherProjTaskId = await api("POST", "/api/internal/memory", {
    scope: "task",
    type: "fact",
    content: "Task memory for Project 2 task",
    task_id: ctx.task2.id,
    source: "agent",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(otherProjTaskId.status === 404 || otherProjTaskId.status === 403, "12. Task memory with other project's task_id rejected (404/403)");
}

// ────────────────────────────────────────────────────────
// 13 & 14: project_shared & agent_private Intact
// ────────────────────────────────────────────────────────
async function test_shared_and_private_integrity(ctx) {
  console.log("\n=== 13 & 14: project_shared and agent_private Integrity ===");

  // 13. project_shared memory works
  var createShared = await api("POST", "/api/internal/memory", {
    scope: "project_shared",
    type: "fact",
    content: "PostgreSQL 16 is used for primary storage",
    importance: 2,
    source: "agent",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(createShared.status === 201, "13a. Worker A creates project_shared memory (201 Created)");

  // Worker B can view and retrieve project_shared memory
  var getSharedB = await api("GET", "/api/internal/memory?scope=project_shared", null, {
    Authorization: "Bearer " + ctx.tokenB,
  });
  assert(getSharedB.status === 200, "13b. Worker B can list project_shared memory (200 OK)");
  var foundShared = (getSharedB.data?.memories || []).some((m) => m.content.includes("PostgreSQL 16"));
  assert(foundShared, "13c. Worker B finds project_shared memory created by Worker A");

  var retrieveSharedB = await api("POST", "/api/internal/memory/retrieve", {
    query: "PostgreSQL primary storage",
  }, {
    Authorization: "Bearer " + ctx.tokenB,
  });
  assert(retrieveSharedB.data?.contextBrief?.includes("PostgreSQL 16"), "13d. Worker B retrieves project_shared memory in context brief");

  // 14. agent_private memory works
  var createPrivateA = await api("POST", "/api/internal/memory", {
    scope: "agent_private",
    type: "discovery",
    content: "Worker A confidential scratchpad notes",
    importance: 2,
    source: "agent",
  }, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  assert(createPrivateA.status === 201, "14a. Worker A creates agent_private memory (201 Created)");
  var privAId = createPrivateA.data?.memory?.id;

  // Worker A can read it
  var listPrivA = await api("GET", "/api/internal/memory?scope=agent_private", null, {
    Authorization: "Bearer " + ctx.tokenA,
  });
  var foundPrivA = (listPrivA.data?.memories || []).some((m) => m.id === privAId);
  assert(foundPrivA, "14b. Worker A can view its own agent_private memory");

  // Worker B cannot read it
  var listPrivB = await api("GET", "/api/internal/memory?scope=agent_private", null, {
    Authorization: "Bearer " + ctx.tokenB,
  });
  var leakedPrivToB = (listPrivB.data?.memories || []).some((m) => m.id === privAId);
  assert(!leakedPrivToB, "14c. Worker B CANNOT view Worker A's agent_private memory");

  // Worker B cannot modify it
  var patchPrivB = await api("PATCH", "/api/internal/memory/" + privAId, {
    content: "Tampered private note",
  }, {
    Authorization: "Bearer " + ctx.tokenB,
  });
  assert(patchPrivB.status === 403, "14d. Worker B cannot modify Worker A's agent_private memory (403 Forbidden)");

  // Worker B cannot archive it
  var archivePrivB = await api("POST", "/api/internal/memory/" + privAId + "/archive", {}, {
    Authorization: "Bearer " + ctx.tokenB,
  });
  assert(archivePrivB.status === 403, "14e. Worker B cannot archive Worker A's agent_private memory (403 Forbidden)");
}

// ────────────────────────────────────────────────────────
// Main Test Runner
// ────────────────────────────────────────────────────────
async function main() {
  console.log("GridMind Stage 4: Cross-Task Authorization Tests (ARCH-01)");
  console.log("============================================================");

  try {
    var ctx = await setup();
    await test_task_access(ctx);
    await test_task_update(ctx);
    await test_memory_create_and_archive(ctx);
    await test_retrieval_auth(ctx);
    await test_cross_project(ctx);
    await test_worker_own_task_memory(ctx);
    await test_master_behavior(ctx);
    await test_task_memory_validation(ctx);
    await test_shared_and_private_integrity(ctx);

    // Cleanup repos
    execSync("rm -rf /tmp/gmtaskauth-proj1 /tmp/gmtaskauth-proj2");

    console.log("\n============================================================");
    console.log("Results: " + passed + " passed, " + failed + " failed");
    console.log("============================================================");

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  }
}

main();
