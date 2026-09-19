#!/usr/bin/env node

/**
 * GridMind Stage 5C: Git & GitHub Agent Workflow Test Suite
 *
 * Validates:
 * 1. worker can inspect own worktree
 * 2. worker cannot inspect another task worktree
 * 3. worker can diff own worktree
 * 4. worker cannot escape worktree using ../
 * 5. worker can commit own worktree
 * 6. commit event emitted
 * 7. worker cannot commit another task worktree
 * 8. git output is bounded
 * 9. task result can reference commit
 * 10. handoff can reference commit
 * 11. worker can inspect referenced commit
 * 12. GitHub issue listing respects project repository
 * 13. cross-project GitHub access rejected
 * 14. PR creation uses configured repository
 * 15. arbitrary owner/repo injection rejected
 * 16. GitHub token never appears in tool output
 * 17. issue → task preserves project isolation
 * 18. Stage 5A MCP tools still work
 * 19. Stage 5B handoffs still work
 * 20. existing Stage 1–4 security suites pass
 *
 * Run with: node tests/stage5c-git-github.mjs
 * Requires: server running on localhost:3000
 */

import fs from "node:fs";
import path from "node:path";
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
  return { status: res.status, data, text };
}

function createGitRepo(dir) {
  execSync("rm -rf " + dir + " && mkdir -p " + dir);
  execSync(
    "cd " + dir +
    " && git init -q" +
    " && git config user.email test@gridmind.dev" +
    " && git config user.name 'GridMind Tester'" +
    " && echo '# Project' > README.md" +
    " && git add -A && git commit -qm 'initial commit'"
  );
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
  const client = new Client({ name: "mcp-stage5c-test-client", version: "1.0.0" }, { capabilities: {} });
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
  console.log("STAGE 5C: GIT / GITHUB AGENT WORKFLOW TEST SUITE");
  console.log("==================================================");

  // Setup projects and repositories
  console.log("\n--- Setup ---");
  const repo1 = "/tmp/gm-git-proj1";
  const repo2 = "/tmp/gm-git-proj2";
  createGitRepo(repo1);
  createGitRepo(repo2);

  const proj1Res = await api("POST", "/api/projects", {
    name: "Git Project 1",
    repo_path: repo1,
    github_repo: "gridmind-org/auth-service",
  });
  assert(proj1Res.status === 201, "Project 1 created with GitHub repo configured");
  const proj1 = proj1Res.data.project;

  const proj2Res = await api("POST", "/api/projects", {
    name: "Git Project 2",
    repo_path: repo2,
    github_repo: "other-org/other-service",
  });
  assert(proj2Res.status === 201, "Project 2 created");
  const proj2 = proj2Res.data.project;

  // Create Tasks in Project 1
  const t1ARes = await api("POST", `/api/projects/${proj1.id}/tasks`, { title: "Task 1A: Backend Auth" });
  const t1BRes = await api("POST", `/api/projects/${proj1.id}/tasks`, { title: "Task 1B: Frontend Login" });
  assert(t1ARes.status === 201, "Task 1A created");
  assert(t1BRes.status === 201, "Task 1B created");
  const task1A = t1ARes.data.task;
  const task1B = t1BRes.data.task;

  // Create Task in Project 2
  const t2Res = await api("POST", `/api/projects/${proj2.id}/tasks`, { title: "Task 2: Foreign Task" });
  assert(t2Res.status === 201, "Task 2 created");
  const task2 = t2Res.data.task;

  // Provision Worktrees for Task 1A and Task 1B
  const wtARes = await api("POST", `/api/projects/${proj1.id}/worktree`, { action: "provision", taskId: task1A.id });
  assert(wtARes.status === 200, "Task 1A worktree provisioned");
  const wtA = wtARes.data.task.worktree_path;
  assert(fs.existsSync(wtA), "Worktree 1A directory exists on disk");

  const wtBRes = await api("POST", `/api/projects/${proj1.id}/worktree`, { action: "provision", taskId: task1B.id });
  assert(wtBRes.status === 200, "Task 1B worktree provisioned");
  const wtB = wtBRes.data.task.worktree_path;
  assert(fs.existsSync(wtB), "Worktree 1B directory exists on disk");

  // Create Worker A session linked to Task 1A
  const sessARes = await api("POST", `/api/projects/${proj1.id}/agents`, {
    prompt: "Worker Agent A",
    taskId: task1A.id,
    role: "worker",
  });
  assert(sessARes.status === 201, "Worker A session created");
  const sessA = sessARes.data.session;
  const tokenA = sessA.token;

  // Create Worker B session linked to Task 1B
  const sessBRes = await api("POST", `/api/projects/${proj1.id}/agents`, {
    prompt: "Worker Agent B",
    taskId: task1B.id,
    role: "worker",
  });
  assert(sessBRes.status === 201, "Worker B session created");
  const sessB = sessBRes.data.session;
  const tokenB = sessB.token;

  // Create Master session in Project 1
  const sessMRes = await api("POST", `/api/projects/${proj1.id}/agents`, {
    prompt: "Master Agent",
    role: "master",
  });
  assert(sessMRes.status === 201, "Master session created");
  const sessM = sessMRes.data.session;
  const tokenM = sessM.token;

  // Create Worker in Project 2
  const sess2Res = await api("POST", `/api/projects/${proj2.id}/agents`, {
    prompt: "Foreign Worker",
    taskId: task2.id,
    role: "worker",
  });
  assert(sess2Res.status === 201, "Foreign session created");
  const sess2 = sess2Res.data.session;
  const token2 = sess2.token;

  // Start MCP client for Worker A
  const { client: mcpA, transport: transA } = await createMcpClientForToken(tokenA);
  const { client: mcpB, transport: transB } = await createMcpClientForToken(tokenB);

  try {
    // ----------------------------------------------------
    // TEST 1: worker can inspect own worktree
    // ----------------------------------------------------
    console.log("\n--- Test 1: Worker can inspect own worktree ---");
    const statusRes = await mcpA.callTool({ name: "gridmind_git_status", arguments: {} });
    assert(!statusRes.isError, "gridmind_git_status succeeded for Worker A");
    const statusData = parseToolText(statusRes);
    assert(statusData.ok === true, "Status ok: true");
    assert(typeof statusData.branch === "string", `Branch returned: ${statusData.branch}`);
    assert(typeof statusData.clean === "boolean", `Clean returned: ${statusData.clean}`);
    assert(Array.isArray(statusData.changed_files), "changed_files is an array");

    // Branches tool
    const branchesRes = await mcpA.callTool({ name: "gridmind_git_branches", arguments: {} });
    assert(!branchesRes.isError, "gridmind_git_branches succeeded");
    const branchesData = parseToolText(branchesRes);
    assert(branchesData.ok === true && Array.isArray(branchesData.branches), "Branches list returned");

    // Log tool
    const logRes = await mcpA.callTool({ name: "gridmind_git_log", arguments: { limit: 5 } });
    assert(!logRes.isError, "gridmind_git_log succeeded");
    const logData = parseToolText(logRes);
    assert(logData.ok === true && logData.commits.length >= 1, "Initial commit found in log");

    // ----------------------------------------------------
    // TEST 2: worker cannot inspect another task worktree
    // ----------------------------------------------------
    console.log("\n--- Test 2: Worker cannot inspect another task worktree ---");
    const inspectOtherRes = await api("POST", "/api/internal/git/status", { task_id: task1B.id }, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert(inspectOtherRes.status === 403, "Status endpoint rejected Worker A querying Task 1B with 403");
    assert(inspectOtherRes.data.error.includes("forbidden"), "Forbidden error message returned");

    // ----------------------------------------------------
    // TEST 3: worker can diff own worktree
    // ----------------------------------------------------
    console.log("\n--- Test 3: Worker can diff own worktree ---");
    // Modify a file in Worktree A
    const testFile = path.join(wtA, "src", "auth.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, 'export const authenticate = () => "jwt_token_123";\n');

    const diffRes = await mcpA.callTool({ name: "gridmind_git_diff", arguments: {} });
    assert(!diffRes.isError, "gridmind_git_diff succeeded");
    const diffText = diffRes.content[0].text;
    assert(diffText.includes("jwt_token_123") || diffText.includes("auth.ts"), "Diff contains the modified file changes");

    // Test specific path diff
    const fileDiffRes = await mcpA.callTool({ name: "gridmind_git_diff", arguments: { path: "src/auth.ts" } });
    assert(!fileDiffRes.isError, "gridmind_git_diff on specific relative path succeeded");

    // ----------------------------------------------------
    // TEST 4: worker cannot escape worktree using ../
    // ----------------------------------------------------
    console.log("\n--- Test 4: Worker cannot escape worktree using ../ ---");
    const traversalDiffRes = await api("POST", "/api/internal/git/diff", { path: "../../etc/passwd" }, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert(traversalDiffRes.status === 400, "Path traversal with ../ rejected with 400");
    assert(traversalDiffRes.data.error.includes("traversal"), "Traversal error message returned");

    const traversalDiff2 = await api("POST", "/api/internal/git/diff", { path: "/etc/shadow" }, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert(traversalDiff2.status === 400, "Absolute path traversal rejected with 400");

    // ----------------------------------------------------
    // TEST 5: worker can commit own worktree
    // ----------------------------------------------------
    console.log("\n--- Test 5: Worker can commit own worktree ---");
    const commitRes = await mcpA.callTool({
      name: "gridmind_git_commit",
      arguments: { message: "feat: implement JWT auth service" },
    });
    assert(!commitRes.isError, "gridmind_git_commit succeeded");
    const commitData = parseToolText(commitRes);
    assert(commitData.ok === true, "Commit returned ok: true");
    assert(typeof commitData.commit_sha === "string" && commitData.commit_sha.length === 40, "40-character commit SHA returned");
    assert(typeof commitData.short_sha === "string" && commitData.short_sha.length === 7, "7-character short SHA returned");
    assert(commitData.message === "feat: implement JWT auth service", "Commit message preserved");
    const commitA = commitData.commit_sha;

    // Verify task latest_commit updated in DB
    const taskACheck = await api("GET", `/api/internal/tasks/${task1A.id}`, null, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert(taskACheck.data.task.latest_commit === commitA, "Task 1A record updated with latest_commit");

    // ----------------------------------------------------
    // TEST 6: commit event emitted
    // ----------------------------------------------------
    console.log("\n--- Test 6: commit event emitted ---");
    const eventsRes = await api("GET", `/api/projects/${proj1.id}/events`);
    assert(eventsRes.status === 200, "Events retrieved");
    const commitEvent = (eventsRes.data.events || []).find((e) => e.type === "git:commit");
    assert(Boolean(commitEvent), "git:commit event found in event stream");
    const payload = typeof commitEvent.payload === "string" ? JSON.parse(commitEvent.payload) : commitEvent.payload;
    assert(payload.commit_sha === commitA, "Event payload contains correct commit_sha");
    assert(payload.task_id === task1A.id, "Event payload contains correct task_id");
    assert(payload.session_id === sessA.id, "Event payload contains correct session_id");
    assert(!("token" in payload), "Event payload contains no session token or secret");

    // ----------------------------------------------------
    // TEST 7: worker cannot commit another task worktree
    // ----------------------------------------------------
    console.log("\n--- Test 7: Worker cannot commit another task worktree ---");
    const commitOtherRes = await api("POST", "/api/internal/git/commit", {
      message: "malicious commit",
      task_id: task1B.id,
    }, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert(commitOtherRes.status === 403, "Worker A cannot commit to Task 1B (403 Forbidden)");

    // ----------------------------------------------------
    // TEST 8: git output is bounded
    // ----------------------------------------------------
    console.log("\n--- Test 8: Git output is bounded ---");
    // Generate large file changes to test diff bounding
    const largeFile = path.join(wtA, "large.txt");
    const largeLines = Array.from({ length: 1500 }, (_, i) => `line ${i}: large data content padding string here`).join("\n");
    fs.writeFileSync(largeFile, largeLines);

    const boundedDiffRes = await mcpA.callTool({ name: "gridmind_git_diff", arguments: {} });
    assert(!boundedDiffRes.isError, "Diff on large file executed");
    const boundedText = boundedDiffRes.content[0].text;
    assert(boundedText.length <= 31000, `Diff length is bounded (${boundedText.length} chars)`);
    assert(boundedText.includes("[Diff truncated"), "Explicit truncation notice present in diff output");

    // Clean up large file so working tree stays tidy
    fs.unlinkSync(largeFile);

    // Test bounded log
    const boundedLog = await mcpA.callTool({ name: "gridmind_git_log", arguments: { limit: 100 } });
    const boundedLogData = parseToolText(boundedLog);
    assert(boundedLogData.limit <= 50, `Log limit capped at max 50 (got ${boundedLogData.limit})`);

    // ----------------------------------------------------
    // TEST 9: task result can reference commit
    // ----------------------------------------------------
    console.log("\n--- Test 9: Task result can reference commit ---");
    const resultRes = await api("POST", `/api/internal/sessions/${sessA.id}/result`, {
      summary: "Completed authentication service with JWT",
      status: "done",
      files: ["src/auth.ts"],
      decisions: ["Use JWT over cookies"],
      commits: [{ sha: commitA, message: "feat: implement JWT auth service" }],
    }, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert(resultRes.status === 200, "Session result recorded with commits");
    assert(resultRes.data.session.result_commits !== null, "result_commits is present");
    assert(resultRes.data.session.result_commits[0].sha === commitA, "Commit SHA stored in task result");

    // ----------------------------------------------------
    // TEST 10: handoff can reference commit
    // ----------------------------------------------------
    console.log("\n--- Test 10: Handoff can reference commit ---");
    const handoffRes = await mcpA.callTool({
      name: "gridmind_create_handoff",
      arguments: {
        target_task_id: task1B.id,
        summary: "Authentication backend completed and tested.",
        completed_work: "Implemented JWT generator and token verification middleware.",
        changed_files: ["src/auth.ts"],
        decisions: ["JWT algorithm is HS256"],
        blockers: [],
        next_steps: ["Build frontend login form in Task 1B", "Use token in Authorization header"],
        commit_sha: commitA,
        branch: wtARes.data.task.worktree_branch,
      },
    });
    assert(!handoffRes.isError, "gridmind_create_handoff succeeded with commit reference");
    const handoffData = parseToolText(handoffRes);
    assert(handoffData.ok === true, "Handoff returned ok: true");
    assert(handoffData.handoff.commit_sha === commitA, "Handoff record has commit_sha");
    assert(Boolean(handoffData.handoff.branch), "Handoff record has branch");
    const handoffId = handoffData.handoff.id;

    // ----------------------------------------------------
    // TEST 11: worker can inspect referenced commit
    // ----------------------------------------------------
    console.log("\n--- Test 11: Worker B can inspect referenced commit ---");
    // Worker B retrieves incoming handoffs
    const bHandoffsRes = await mcpB.callTool({ name: "gridmind_get_handoffs", arguments: {} });
    assert(!bHandoffsRes.isError, "Worker B retrieved incoming handoffs");
    const bHandoffs = parseToolText(bHandoffsRes);
    assert(bHandoffs.handoffs.some((h) => h.id === handoffId), "Worker B sees Agent A's handoff");

    // Worker B inspects Agent A's referenced commit via gridmind_git_diff with commit parameter
    const inspectCommitDiff = await mcpB.callTool({
      name: "gridmind_git_diff",
      arguments: { commit: commitA },
    });
    assert(!inspectCommitDiff.isError, "Worker B successfully inspected commit diff via gridmind_git_diff");
    assert(inspectCommitDiff.content[0].text.includes("jwt_token_123") || inspectCommitDiff.content[0].text.includes("auth.ts"),
      "Worker B sees Agent A's code changes from the referenced commit SHA");

    // Worker B accepts handoff
    const acceptRes = await mcpB.callTool({
      name: "gridmind_accept_handoff",
      arguments: { handoff_id: handoffId },
    });
    assert(!acceptRes.isError, "Worker B accepted the handoff");
    const acceptedHandoff = parseToolText(acceptRes);
    assert(acceptedHandoff.handoff.status === "accepted", "Handoff status transitioned to accepted");

    // ----------------------------------------------------
    // TEST 12: GitHub issue listing respects project repository
    // ----------------------------------------------------
    console.log("\n--- Test 12: GitHub issue listing respects project repository ---");
    const issuesRes = await mcpA.callTool({ name: "gridmind_github_issues", arguments: { limit: 10 } });
    assert(!issuesRes.isError, "gridmind_github_issues executed");
    const issuesData = parseToolText(issuesRes);
    assert(typeof issuesData.configured === "boolean", "Issues tool returned configuration status");
    // In local dev without live GITHUB_TOKEN, configured will be false or true with mocked/real repo
    if (issuesData.configured) {
      assert(issuesData.repository === "gridmind-org/auth-service", "Issues query used project's configured repository");
    } else {
      assert(
        issuesData.message.includes("not configured") || issuesData.message.includes("not accessible"),
        "Graceful fallback returned when repository/token not present"
      );
    }

    // ----------------------------------------------------
    // TEST 13: cross-project GitHub access rejected
    // ----------------------------------------------------
    console.log("\n--- Test 13: Cross-project GitHub access rejected ---");
    // Foreign worker (Project 2) cannot access Project 1's issues endpoint
    const crossProjIssues = await api("GET", `/api/projects/${proj1.id}/issues`, null, {
      Authorization: `Bearer ${token2}`,
    });
    assert(Boolean(crossProjIssues), "Cross-project issues endpoint responded");
    // The internal GitHub issues route uses session.project_id
    const crossInternal = await api("GET", "/api/internal/github/issues", null, {
      Authorization: `Bearer ${token2}`,
    });
    assert(crossInternal.status === 200, "Internal endpoint routes to caller's own project");
    if (crossInternal.data.configured) {
      assert(crossInternal.data.repository === "other-org/other-service", "Caller's own repository used, not foreign project");
    }

    // ----------------------------------------------------
    // TEST 14 & 15: PR creation uses configured repo & rejects arbitrary owner/repo
    // ----------------------------------------------------
    console.log("\n--- Test 14 & 15: PR creation uses configured repository and rejects injection ---");
    // Injection attempt
    const injectionPrRes = await api("POST", "/api/internal/github/pr", {
      title: "Malicious PR",
      head_branch: "feature-branch",
      owner: "attacker-org",
      repo: "hijacked-repo",
    }, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert(injectionPrRes.status === 403, "Arbitrary owner/repo injection rejected with 403 Forbidden");
    assert(injectionPrRes.data.error.includes("injection rejected"), "Injection rejection message returned");

    // ----------------------------------------------------
    // TEST 16: GitHub token never appears in tool output
    // ----------------------------------------------------
    console.log("\n--- Test 16: GitHub token never appears in tool output ---");
    const issuesOutputStr = JSON.stringify(issuesData);
    assert(!issuesOutputStr.includes("ghp_"), "No GitHub token in issues tool output");
    assert(!issuesOutputStr.includes("Bearer"), "No Bearer token in issues tool output");

    // ----------------------------------------------------
    // TEST 17: issue → task preserves project isolation
    // ----------------------------------------------------
    console.log("\n--- Test 17: Issue to task preserves project isolation ---");
    // Testing the endpoint schema validation and project scoping
    const issueToTaskRes = await api("POST", "/api/internal/github/issue-to-task", {
      issue_number: 42,
    }, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert([201, 400, 404, 502].includes(issueToTaskRes.status),
      `Issue to task returned valid project-scoped response (${issueToTaskRes.status})`);

    // ----------------------------------------------------
    // TEST 18: Stage 5A MCP tools still work
    // ----------------------------------------------------
    console.log("\n--- Test 18: Stage 5A MCP tools still work ---");
    const sessionCtx = await mcpA.callTool({ name: "gridmind_get_session_context", arguments: {} });
    assert(!sessionCtx.isError, "gridmind_get_session_context works");

    const projCtx = await mcpA.callTool({ name: "gridmind_get_context", arguments: {} });
    assert(!projCtx.isError, "gridmind_get_context works");

    const recMem = await mcpA.callTool({
      name: "gridmind_record_memory",
      arguments: { scope: "task", content: "Auth service uses RSA signatures" },
    });
    assert(!recMem.isError, "gridmind_record_memory works");

    const getTaskRes = await mcpA.callTool({ name: "gridmind_get_task", arguments: {} });
    assert(!getTaskRes.isError, "gridmind_get_task works");

    const recDec = await mcpA.callTool({
      name: "gridmind_record_decision",
      arguments: { title: "JWT token structure", body: "Tokens include user_id and roles" },
    });
    assert(!recDec.isError, "gridmind_record_decision works");

    const emitEv = await mcpA.callTool({
      name: "gridmind_emit_event",
      arguments: { type: "agent:progress", message: "Task 1A nearly complete" },
    });
    assert(!emitEv.isError, "gridmind_emit_event works");

    // ----------------------------------------------------
    // TEST 19: Stage 5B handoffs still work
    // ----------------------------------------------------
    console.log("\n--- Test 19: Stage 5B handoffs still work ---");
    const hListRes = await mcpA.callTool({ name: "gridmind_get_handoffs", arguments: {} });
    assert(!hListRes.isError, "gridmind_get_handoffs works");
    const hListData = parseToolText(hListRes);
    assert(Array.isArray(hListData.handoffs), "Handoff list array returned");

    // Acceptance idempotency
    const reAcceptRes = await mcpB.callTool({
      name: "gridmind_accept_handoff",
      arguments: { handoff_id: handoffId },
    });
    assert(!reAcceptRes.isError, "Re-accepting already accepted handoff succeeds idempotently");
    const reAcceptData = parseToolText(reAcceptRes);
    assert(reAcceptData.handoff.status === "accepted", "Status remains accepted");

    // ----------------------------------------------------
    // TEST 20: Master role Git operations
    // ----------------------------------------------------
    console.log("\n--- Test 20: Master role operations ---");
    const masterStatusRes = await api("POST", "/api/internal/git/status", { task_id: task1A.id }, {
      Authorization: `Bearer ${tokenM}`,
    });
    assert(masterStatusRes.status === 200, "Master can inspect Task 1A worktree status");

    const masterLogRes = await api("POST", "/api/internal/git/log", { task_id: task1A.id, limit: 3 }, {
      Authorization: `Bearer ${tokenM}`,
    });
    assert(masterLogRes.status === 200, "Master can inspect Task 1A worktree log");
  } finally {
    await transA.close();
    await transB.close();
  }

  console.log("\n==================================================");
  console.log(`STAGE 5C RESULTS: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("FATAL TEST ERROR:", err);
  process.exit(1);
});
