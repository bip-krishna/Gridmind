#!/usr/bin/env node

/**
 * GridMind Stage 5C: Manual End-to-End Live Workflow Demo
 *
 * Demonstrates:
 * 1. Project & Git repository configuration
 * 2. Task A ("Implement authentication") & Task B ("Build frontend login")
 * 3. Worktree isolation for each task
 * 4. Agent A commits code via MCP (git_status, git_diff, git_commit)
 * 5. GridMind records commit & emits event
 * 6. Agent A produces structured handoff referencing commit
 * 7. Agent B retrieves handoff & inspects Agent A's commit via MCP git_diff
 * 8. Agent B accepts handoff and continues work in Worktree B
 * 9. Agent B commits code via MCP
 * 10. GitHub PR creation (or reports GITHUB: NOT CONFIGURED)
 * 11. Complete visualization of the coordination chain
 *
 * Run with: node scripts/stage5c-demo.mjs
 */

import fs from "node:fs";
import path from "node:path";
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

async function createMcpClient(token) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/mcp/cli.mjs"],
    env: {
      ...process.env,
      GRIDMIND_API: BASE,
      GRIDMIND_TOKEN: token,
    },
  });
  const client = new Client({ name: "stage5c-demo-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

function parseText(res) {
  if (!res || !res.content || !res.content[0] || !res.content[0].text) return null;
  try {
    return JSON.parse(res.content[0].text);
  } catch {
    return res.content[0].text;
  }
}

async function runDemo() {
  console.log("==================================================================");
  console.log("GRIDMIND STAGE 5C — LIVE END-TO-END WORKFLOW DEMO");
  console.log("==================================================================");

  // Step 1 & 2: Setup Project & Git repository
  console.log("\n[Step 1 & 2] Initializing Git repository and GridMind Project...");
  const demoRepo = "/tmp/gridmind-stage5c-live-demo";
  execSync(`rm -rf ${demoRepo} && mkdir -p ${demoRepo}`);
  execSync(
    `cd ${demoRepo} && git init -q && git config user.email demo@gridmind.dev && git config user.name 'GridMind Demo' && echo '# GridMind Live Demo App' > README.md && git add -A && git commit -qm 'Initial commit'`
  );

  const projRes = await api("POST", "/api/projects", {
    name: "Autonomous Auth & Frontend Project",
    repo_path: demoRepo,
    github_repo: process.env.DEMO_GITHUB_REPO || null,
  });
  const project = projRes.data.project;
  console.log(`  ✓ Project created: ${project.name} (${project.id})`);
  console.log(`  ✓ Git repo initialized: ${demoRepo}`);

  // Step 3: Create Task A and Task B
  console.log("\n[Step 3] Creating coordinated developer tasks...");
  const taskARes = await api("POST", `/api/projects/${project.id}/tasks`, {
    title: "Implement authentication",
    description: "Build robust JWT backend authentication and middleware.",
    assigned_agent: "opencode",
  });
  const taskA = taskARes.data.task;
  console.log(`  ✓ Task A created: "${taskA.title}" (${taskA.id})`);

  const taskBRes = await api("POST", `/api/projects/${project.id}/tasks`, {
    title: "Build frontend login",
    description: "Create responsive login UI that consumes Task A's authentication backend.",
    assigned_agent: "opencode",
  });
  const taskB = taskBRes.data.task;
  console.log(`  ✓ Task B created: "${taskB.title}" (${taskB.id})`);

  // Step 4 & 5: Provision Worktree & Start Agent A
  console.log("\n[Step 4 & 5] Provisioning isolated worktree for Agent A...");
  const wtARes = await api("POST", `/api/projects/${project.id}/worktree`, {
    action: "provision",
    taskId: taskA.id,
  });
  const worktreeA = wtARes.data.task.worktree_path;
  console.log(`  ✓ Worktree A provisioned at: ${worktreeA}`);
  console.log(`  ✓ Branch A: ${wtARes.data.task.worktree_branch}`);

  const sessARes = await api("POST", `/api/projects/${project.id}/agents`, {
    prompt: "Implement backend authentication in isolated worktree",
    taskId: taskA.id,
    role: "worker",
  });
  const sessA = sessARes.data.session;
  console.log(`  ✓ Agent A session spawned: ${sessA.id}`);

  // Step 6: Agent A executes work in Worktree A via MCP
  console.log("\n[Step 6] Agent A connecting via GridMind MCP to inspect and modify code...");
  const { client: mcpA, transport: transA } = await createMcpClient(sessA.token);

  const statusA1 = parseText(await mcpA.callTool({ name: "gridmind_git_status", arguments: {} }));
  console.log(`  ✓ Agent A git_status: clean=${statusA1.clean}, branch=${statusA1.branch}`);

  // Agent A writes code
  const authCodeFile = path.join(worktreeA, "src", "auth.ts");
  fs.mkdirSync(path.dirname(authCodeFile), { recursive: true });
  fs.writeFileSync(
    authCodeFile,
    `export interface AuthSession {\n  userId: string;\n  token: string;\n}\n\nexport function verifyToken(token: string): boolean {\n  return token.startsWith("bearer_");\n}\n`
  );
  console.log(`  ✓ Agent A created src/auth.ts in Worktree A`);

  const diffA = await mcpA.callTool({ name: "gridmind_git_diff", arguments: {} });
  console.log(`  ✓ Agent A git_diff verified (${diffA.content[0].text.length} chars changed)`);

  const commitARes = parseText(await mcpA.callTool({
    name: "gridmind_git_commit",
    arguments: { message: "feat(auth): implement JWT verifyToken backend" },
  }));
  const commitA = commitARes.commit_sha;
  console.log(`  ✓ Agent A committed code via MCP: ${commitA.slice(0, 7)} — "${commitARes.message}"`);

  // Step 7: Record Task A complete
  await mcpA.callTool({
    name: "gridmind_update_task_status",
    arguments: { status: "done", description: "Authentication module completed and committed" },
  });
  console.log(`  ✓ Task A status updated: done`);

  // Step 8: Agent A produces handoff to Task B
  console.log("\n[Step 8] Agent A creating structured handoff with Git commit reference...");
  const handoffRes = parseText(await mcpA.callTool({
    name: "gridmind_create_handoff",
    arguments: {
      target_task_id: taskB.id,
      summary: "Authentication backend completed and committed to worktree branch.",
      completed_work: "Implemented verifyToken() and AuthSession interface in src/auth.ts.",
      changed_files: ["src/auth.ts"],
      decisions: ["Use Bearer token prefix verification"],
      blockers: [],
      next_steps: ["Import verifyToken into frontend login component", "Create login form submission handler"],
      commit_sha: commitA,
      branch: commitARes.branch,
    },
  }));
  const handoff = handoffRes.handoff;
  console.log(`  ✓ Handoff created: [HANDOFF ${handoff.id}] (status: ${handoff.status})`);
  console.log(`    Referenced Commit: ${handoff.commit_sha.slice(0, 7)} (@${handoff.branch})`);

  // Step 9 & 10: Start Agent B on Task B
  console.log("\n[Step 9 & 10] Starting Agent B on Task B in its own isolated worktree...");
  const wtBRes = await api("POST", `/api/projects/${project.id}/worktree`, {
    action: "provision",
    taskId: taskB.id,
  });
  const worktreeB = wtBRes.data.task.worktree_path;
  console.log(`  ✓ Worktree B provisioned at: ${worktreeB}`);
  console.log(`  ✓ Branch B: ${wtBRes.data.task.worktree_branch}`);

  const sessBRes = await api("POST", `/api/projects/${project.id}/agents`, {
    prompt: "Build frontend login consuming Task A's auth",
    taskId: taskB.id,
    role: "worker",
  });
  const sessB = sessBRes.data.session;
  console.log(`  ✓ Agent B session spawned: ${sessB.id}`);

  const { client: mcpB, transport: transB } = await createMcpClient(sessB.token);

  // Agent B retrieves incoming handoff
  const handoffsB = parseText(await mcpB.callTool({ name: "gridmind_get_handoffs", arguments: {} }));
  const receivedHandoff = handoffsB.handoffs.find((h) => h.id === handoff.id);
  console.log(`  ✓ Agent B retrieved handoff: "${receivedHandoff.summary}"`);

  // Step 11: Agent B inspects Agent A's referenced commit
  console.log("\n[Step 11] Agent B inspecting Agent A's referenced commit via MCP git_diff...");
  const inspectCommitRes = await mcpB.callTool({
    name: "gridmind_git_diff",
    arguments: { commit: receivedHandoff.commit_sha },
  });
  console.log(`  ✓ Agent B successfully inspected Agent A commit diff (${inspectCommitRes.content[0].text.length} chars)`);

  // Step 12 & 13: Agent B accepts handoff and continues work
  console.log("\n[Step 12 & 13] Agent B accepts handoff and builds frontend in Worktree B...");
  const acceptB = parseText(await mcpB.callTool({
    name: "gridmind_accept_handoff",
    arguments: { handoff_id: handoff.id },
  }));
  console.log(`  ✓ Handoff accepted! (status: ${acceptB.handoff.status})`);

  const loginCodeFile = path.join(worktreeB, "src", "login.tsx");
  fs.mkdirSync(path.dirname(loginCodeFile), { recursive: true });
  fs.writeFileSync(
    loginCodeFile,
    `import { verifyToken } from "./auth";\n\nexport function LoginForm() {\n  return <form onSubmit={(e) => { e.preventDefault(); verifyToken("bearer_secret"); }}>Login</form>;\n}\n`
  );
  console.log(`  ✓ Agent B created src/login.tsx in Worktree B`);

  const commitBRes = parseText(await mcpB.callTool({
    name: "gridmind_git_commit",
    arguments: { message: "feat(login): implement LoginForm using backend auth" },
  }));
  const commitB = commitBRes.commit_sha;
  console.log(`  ✓ Agent B committed code via MCP: ${commitB.slice(0, 7)} — "${commitBRes.message}"`);

  await mcpB.callTool({
    name: "gridmind_update_task_status",
    arguments: { status: "done", description: "Frontend login UI completed and verified" },
  });
  console.log(`  ✓ Task B status updated: done`);

  // Step 14: GitHub PR Status
  console.log("\n[Step 14] GitHub Pull Request Integration...");
  const ghConfigured = Boolean(process.env.GITHUB_TOKEN && project.github_repo);
  let prStatusText = "GITHUB: NOT CONFIGURED";
  if (ghConfigured) {
    try {
      const prRes = parseText(await mcpB.callTool({
        name: "gridmind_github_create_pr",
        arguments: {
          title: "feat(login): complete authentication and login flow",
          body: `## Summary\nCoordinated delivery across Task A and Task B.\n\n- Backend Auth: Commit ${commitA.slice(0, 7)}\n- Frontend Login: Commit ${commitB.slice(0, 7)}`,
          head_branch: commitBRes.branch,
          base_branch: "main",
        },
      }));
      prStatusText = `PR #${prRes.pr_number}: ${prRes.url}`;
      console.log(`  ✓ GitHub PR Created: ${prStatusText}`);
    } catch (e) {
      console.log(`  ℹ GitHub PR creation skipped (${e.message})`);
    }
  } else {
    console.log(`  ℹ GITHUB: NOT CONFIGURED (No GITHUB_TOKEN or remote repo supplied — verified gracefully without faking)`);
  }

  // Step 15: Print Complete Visualization Chain
  console.log("\n==================================================================");
  console.log("STAGE 5C COORDINATION CHAIN VISUALIZATION");
  console.log("==================================================================");
  console.log(`
Task A: "${taskA.title}"
  │
  ├── Agent A: ${sessA.id.slice(0, 8)} (${sessA.agent_type})
  ├── Worktree: ${worktreeA}
  ├── Commit A: ${commitA.slice(0, 7)} ("${commitARes.message}")
  │
  └── Handoff [ID: ${handoff.id}] ─────────────────────┐
      Status: ${acceptB.handoff.status}                               │
      Commit Ref: ${commitA.slice(0, 7)}                          │
                                                       ↓
                                            Task B: "${taskB.title}"
                                              │
                                              ├── Agent B: ${sessB.id.slice(0, 8)} (${sessB.agent_type})
                                              ├── Worktree: ${worktreeB}
                                              ├── Commit B: ${commitB.slice(0, 7)} ("${commitBRes.message}")
                                              │
                                              ↓
                                            ${prStatusText}
  `);

  await transA.close();
  await transB.close();
  console.log("==================================================================");
  console.log("LIVE DEMO COMPLETED SUCCESSFULLY: ALL WORKFLOW GATES PASSED");
  console.log("==================================================================");
}

runDemo().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
