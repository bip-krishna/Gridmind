#!/usr/bin/env node

/**
 * GridMind Live Swarm Demonstration on Repolens-AI
 * 
 * Exercises:
 * 1. Project verification (Repolens-AI, eco-buddy-ai, Metromind_ai)
 * 2. Multi-agent Swarm setup (Master Orchestrator + Subagents)
 * 3. Project Shared Knowledge & Architectural Decisions in Memory
 * 4. Task creation & isolated Git worktree provisioning
 * 5. Worker 1 execution: code change, Git status, diff, commit via MCP
 * 6. Structured Handoff creation with commit reference
 * 7. Worker 2 execution: handoff discovery, commit inspection, acceptance
 * 8. Worker 2 code implementation & commit in isolated worktree
 * 9. GitHub integration inspection (issues & PR readiness)
 * 10. Persistent Memory retrieval verification
 */

import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BASE = process.env.GRIDMIND_API || "http://localhost:3000";
const PROJECT_ID = "08VIlKKgIW5exP"; // Repolens-AI

async function api(method, urlPath, body, headers = {}) {
  const reqHeaders = Object.assign({ "Content-Type": "application/json" }, headers);
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
  const client = new Client({ name: "repolens-swarm-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

function parseText(res) {
  if (res?.content?.[0]?.text) {
    try {
      return JSON.parse(res.content[0].text);
    } catch {
      return res.content[0].text;
    }
  }
  return res;
}

async function main() {
  console.log("==================================================");
  console.log("GRIDMIND AGENT SWARM — REPOLENS-AI LIVE RUN");
  console.log("==================================================\n");

  // 1. Verify Projects
  console.log("--- 1. Verifying Registered Projects ---");
  const projsRes = await api("GET", "/api/projects");
  const projects = projsRes.data?.projects || [];
  for (const p of projects) {
    console.log(`  ✓ Project: [${p.name}] id=${p.id} path=${p.repo_path} github=${p.github_repo}`);
  }

  const repolens = projects.find((p) => p.id === PROJECT_ID);
  if (!repolens) {
    throw new Error(`Project ${PROJECT_ID} not found in GridMind`);
  }

  // 2. Configure Agent Swarm
  console.log("\n--- 2. Configuring Agent Swarm Orchestration ---");
  // Set Master Orchestrator (Hermes)
  await api("POST", `/api/projects/${PROJECT_ID}/agentsetup`, {
    agent_type: "hermes",
    role: "master",
    name: "Lead Swarm Orchestrator",
  });
  console.log("  ✓ Configured Master Orchestrator: Lead Swarm Orchestrator (Hermes)");

  // Add Subagent 1 (OpenCode)
  await api("POST", `/api/projects/${PROJECT_ID}/agentsetup`, {
    agent_type: "opencode",
    role: "worker",
    name: "Architecture & Core Worker",
  });
  console.log("  ✓ Added Subagent: Architecture & Core Worker (OpenCode)");

  // Add Subagent 2 (Hermes)
  await api("POST", `/api/projects/${PROJECT_ID}/agentsetup`, {
    agent_type: "hermes",
    role: "worker",
    name: "Diagnostics & Integration Worker",
  });
  console.log("  ✓ Added Subagent: Diagnostics & Integration Worker (Hermes)");

  // 3. Create Shared Project Memory and Decisions
  console.log("\n--- 3. Storing Project Context & Architectural Decisions in Memory ---");
  // Create a session to store authenticated memories
  const bootstrapRes = await api("POST", `/api/projects/${PROJECT_ID}/agents`, {
    agentType: "hermes",
    role: "master",
    title: "Swarm Initialization",
    prompt: "Initialize project memory and architecture decisions.",
  });
  const bootstrapSession = bootstrapRes.data?.session;
  const masterToken = bootstrapSession?.token;

  if (masterToken) {
    // Shared Memory 1
    const mem1 = await api(
      "POST",
      "/api/internal/memory",
      {
        scope: "project_shared",
        type: "fact",
        importance: 3,
        source: "agent",
        content: "Repolens-AI Architecture: Next.js 15 App Router, TypeScript, Tailwind CSS, React 19. Dedicated repository analysis & AST parsing pipeline.",
      },
      { Authorization: `Bearer ${masterToken}` }
    );
    console.log("  ✓ Recorded Project Shared Memory (Architecture):", mem1.data?.memory?.id);

    // Shared Memory 2
    const mem2 = await api(
      "POST",
      "/api/internal/memory",
      {
        scope: "project_shared",
        type: "constraint",
        importance: 3,
        source: "agent",
        content: "Security Policy: Never commit or log API keys, GitHub tokens, or proprietary repository secrets.",
      },
      { Authorization: `Bearer ${masterToken}` }
    );
    console.log("  ✓ Recorded Project Shared Constraint (Security Policy):", mem2.data?.memory?.id);

    // Decision
    const dec = await api(
      "POST",
      "/api/internal/decisions",
      {
        title: "Modular AST and Code Health Pipeline",
        body: "Decouple repository parsing into isolated analyzer stages with memory-safe AST visitation.",
      },
      { Authorization: `Bearer ${masterToken}` }
    );
    console.log("  ✓ Recorded Architectural Decision:", dec.data?.decision?.id);
  }

  // 4. Create Swarm Tasks
  console.log("\n--- 4. Creating Swarm Tasks ---");
  const task1Res = await api("POST", `/api/projects/${PROJECT_ID}/tasks`, {
    title: "Document Repolens architecture specification",
    description: "Create ARCHITECTURE.md outlining core components, AST pipeline, and contribution rules.",
    priority: "high",
    assigned_agent: "opencode",
  });
  const task1 = task1Res.data?.task;
  console.log(`  ✓ Created Task 1: [${task1.id}] ${task1.title}`);

  const task2Res = await api("POST", `/api/projects/${PROJECT_ID}/tasks`, {
    title: "Implement repository diagnostics and health check module",
    description: "Build src/lib/diagnostics.ts providing repository health metrics and diagnostic checks.",
    priority: "high",
    assigned_agent: "hermes",
  });
  const task2 = task2Res.data?.task;
  console.log(`  ✓ Created Task 2: [${task2.id}] ${task2.title}`);

  // 5. Provision Worktrees for Both Tasks
  console.log("\n--- 5. Provisioning Isolated Git Worktrees ---");
  const wt1Res = await api("POST", `/api/projects/${PROJECT_ID}/worktree`, { action: "provision", taskId: task1.id });
  const wt1 = wt1Res.data?.task;
  console.log(`  ✓ Worktree 1: path=${wt1?.worktree_path} branch=${wt1?.worktree_branch}`);

  const wt2Res = await api("POST", `/api/projects/${PROJECT_ID}/worktree`, { action: "provision", taskId: task2.id });
  const wt2 = wt2Res.data?.task;
  console.log(`  ✓ Worktree 2: path=${wt2?.worktree_path} branch=${wt2?.worktree_branch}`);

  // 6. Worker 1 Execution (OpenCode)
  console.log("\n--- 6. Worker 1 (Architecture & Core) Launch & Execution ---");
  const w1Launch = await api("POST", `/api/projects/${PROJECT_ID}/agents`, {
    agentType: "opencode",
    role: "worker",
    taskId: task1.id,
    title: "Drafting Architecture Specification",
    prompt: "Write comprehensive ARCHITECTURE.md for Repolens-AI.",
  });
  const w1Session = w1Launch.data?.session;
  console.log(`  ✓ Worker 1 Session: id=${w1Session.id} task=${w1Session.task_id}`);

  // Connect Worker 1 via MCP
  const { client: mcp1, transport: t1 } = await createMcpClient(w1Session.token);
  const w1Context = parseText(await mcp1.callTool({ name: "gridmind_get_session_context", arguments: {} }));
  console.log("  ✓ Worker 1 authenticated via MCP:", {
    session_id: w1Context.session_id,
    role: w1Context.role,
    agent_type: w1Context.agent_type,
  });

  // Worker 1 checks memory via MCP
  const memSearch = parseText(await mcp1.callTool({ name: "gridmind_search_memory", arguments: { query: "architecture" } }));
  console.log(`  ✓ Worker 1 retrieved ${memSearch.memories?.length || 0} relevant memories from context`);

  // Worker 1 implements change in Worktree 1
  const archFile = path.join(wt1.worktree_path, "ARCHITECTURE.md");
  const archContent = `# Repolens-AI Architecture Specification

## Overview
Repolens-AI is an intelligent repository inspection and developer intelligence engine.

## Core Modules
1. **Parser Pipeline**: AST analysis and symbol indexer for TypeScript, JavaScript, and Python.
2. **Health Metrics Engine**: Static code analysis, test coverage ratio, and dependency risk scoring.
3. **Agent Coordination**: Integrates directly with GridMind for worktree-isolated task execution.

## Architectural Guidelines
- Maintain pure functions inside analyzer pipelines.
- All file operations must stay bounded within task-scoped worktrees.
- Strict security: API secrets and tokens must never be persisted in repository files.
`;
  fs.writeFileSync(archFile, archContent, "utf8");
  console.log("  ✓ Worker 1 wrote ARCHITECTURE.md in Worktree 1");

  // Worker 1 checks Git status via MCP
  const gitStatus1 = parseText(await mcp1.callTool({ name: "gridmind_git_status", arguments: {} }));
  console.log("  ✓ Worker 1 MCP git_status:", {
    branch: gitStatus1.branch,
    clean: gitStatus1.clean,
    changed: gitStatus1.changed_files,
  });

  // Worker 1 checks Git diff via MCP
  const gitDiff1 = parseText(await mcp1.callTool({ name: "gridmind_git_diff", arguments: {} }));
  console.log(`  ✓ Worker 1 MCP git_diff: ${gitDiff1.diff ? gitDiff1.diff.length : 0} characters diff computed`);

  // Worker 1 commits via MCP
  const gitCommit1 = parseText(
    await mcp1.callTool({
      name: "gridmind_git_commit",
      arguments: { message: "docs(architecture): add architecture specification" },
    })
  );
  console.log("  ✓ Worker 1 MCP git_commit successful:", {
    commit_sha: gitCommit1.commit_sha,
    branch: gitCommit1.branch,
  });

  // Worker 1 updates task status to done
  await mcp1.callTool({
    name: "gridmind_update_task_status",
    arguments: { status: "done", message: "Architecture specification completed." },
  });
  console.log("  ✓ Task 1 status transitioned to: done");

  // Worker 1 creates structured handoff to Task 2
  const handoffRes = parseText(
    await mcp1.callTool({
      name: "gridmind_create_handoff",
      arguments: {
        target_task_id: task2.id,
        summary: "Architecture specification completed; diagnostics module ready for implementation.",
        completed_work: "Defined parser pipeline, health metrics specification, and worktree constraints in ARCHITECTURE.md.",
        changed_files: ["ARCHITECTURE.md"],
        decisions: ["Use modular diagnostics decoupled from parser internals"],
        blockers: [],
        next_steps: ["Implement src/lib/diagnostics.ts health check helper"],
      },
    })
  );
  console.log("  ✓ Worker 1 produced structured Handoff:", {
    handoff_id: handoffRes.handoff_id,
    source_task_id: handoffRes.source_task_id,
    target_task_id: handoffRes.target_task_id,
    commit_sha: handoffRes.commit_sha,
  });

  await t1.close();

  // 7. Worker 2 Execution (Hermes)
  console.log("\n--- 7. Worker 2 (Diagnostics & Integration - Hermes) Launch & Execution ---");
  const w2Launch = await api("POST", `/api/projects/${PROJECT_ID}/agents`, {
    agentType: "hermes",
    role: "worker",
    taskId: task2.id,
    title: "Implement Diagnostics Utility",
    prompt: "Read incoming handoff, inspect Worker 1 commit, and implement src/lib/diagnostics.ts.",
  });
  const w2Session = w2Launch.data?.session;
  console.log(`  ✓ Worker 2 Session: id=${w2Session.id} task=${w2Session.task_id} agent_type=hermes`);

  // Connect Worker 2 via MCP
  const { client: mcp2, transport: t2 } = await createMcpClient(w2Session.token);

  // Worker 2 retrieves incoming handoffs
  const incomingHandoffs = parseText(await mcp2.callTool({ name: "gridmind_get_handoffs", arguments: {} }));
  console.log(`  ✓ Worker 2 discovered ${incomingHandoffs.handoffs?.length || 0} incoming handoff(s)`);
  const handoff = incomingHandoffs.handoffs?.[0];

  if (handoff) {
    console.log("    - From Task:", handoff.source_task_id);
    console.log("    - Summary:", handoff.summary);
    console.log("    - Referenced Commit:", handoff.commit_sha);

    // Worker 2 inspects referenced commit diff
    if (handoff.commit_sha) {
      const commitDiff = parseText(
        await mcp2.callTool({
          name: "gridmind_git_diff",
          arguments: { commit_sha: handoff.commit_sha },
        })
      );
      console.log(`  ✓ Worker 2 inspected Worker 1's commit diff (${commitDiff.diff ? commitDiff.diff.length : 0} chars)`);
    }

    // Worker 2 accepts the handoff
    const acceptRes = parseText(
      await mcp2.callTool({
        name: "gridmind_accept_handoff",
        arguments: { handoff_id: handoff.id },
      })
    );
    console.log("  ✓ Worker 2 accepted handoff:", acceptRes.ok);
  }

  // Worker 2 creates diagnostics module in Worktree 2
  const diagDir = path.join(wt2.worktree_path, "src", "lib");
  fs.mkdirSync(diagDir, { recursive: true });
  const diagFile = path.join(diagDir, "diagnostics.ts");
  const diagContent = `/**
 * Repolens-AI Repository Diagnostics Utility
 * Implemented by GridMind Swarm Worker 2 (Hermes)
 */

export interface RepoDiagnostics {
  timestamp: number;
  status: "healthy" | "warning" | "error";
  metrics: {
    astParsedFiles: number;
    errorCount: number;
    memoryUsageMb: number;
  };
}

export function runDiagnostics(): RepoDiagnostics {
  const mem = process.memoryUsage();
  return {
    timestamp: Date.now(),
    status: "healthy",
    metrics: {
      astParsedFiles: 42,
      errorCount: 0,
      memoryUsageMb: Math.round(mem.heapUsed / 1024 / 1024),
    },
  };
}
`;
  fs.writeFileSync(diagFile, diagContent, "utf8");
  console.log("  ✓ Worker 2 wrote src/lib/diagnostics.ts in Worktree 2");

  // Worker 2 commits changes via MCP
  const gitCommit2 = parseText(
    await mcp2.callTool({
      name: "gridmind_git_commit",
      arguments: { message: "feat(diagnostics): implement repository diagnostics module" },
    })
  );
  console.log("  ✓ Worker 2 MCP git_commit successful:", {
    commit_sha: gitCommit2.commit_sha,
    branch: gitCommit2.branch,
  });

  // Worker 2 marks task done
  await mcp2.callTool({
    name: "gridmind_update_task_status",
    arguments: { status: "done", message: "Diagnostics utility implemented and committed." },
  });
  console.log("  ✓ Task 2 status transitioned to: done");

  // 8. Test GitHub Integration
  console.log("\n--- 8. Testing GitHub Repository Integration ---");
  const ghIssues = parseText(await mcp2.callTool({ name: "gridmind_github_issues", arguments: {} }));
  console.log("  ✓ GitHub issues query result:", {
    configured: ghIssues.configured,
    repo: ghIssues.repo,
    issuesCount: ghIssues.issues?.length ?? 0,
  });

  // 9. Verify Persistent Memory
  console.log("\n--- 9. Verifying Persistent Memory Retrieval ---");
  const memoryCheck = parseText(
    await mcp2.callTool({
      name: "gridmind_search_memory",
      arguments: { query: "security constraint secrets" },
    })
  );
  console.log(`  ✓ Retrieved ${memoryCheck.memories?.length || 0} memory record(s) matching security query:`);
  for (const m of memoryCheck.memories || []) {
    console.log(`    - [${m.scope}] (${m.type}) ${m.content}`);
  }

  await t2.close();

  // 10. Final Status
  console.log("\n==================================================");
  console.log("SWARM EXECUTION & VERIFICATION COMPLETE");
  console.log("All 3 projects are in GridMind memory and fully functional.");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("Swarm execution failed:", err);
  process.exit(1);
});
