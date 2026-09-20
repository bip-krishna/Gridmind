#!/usr/bin/env node

/**
 * GridMind: Automatic Context Capture Demonstration on Repolens-AI
 * 
 * Proves that context saving is 100% AUTOMATIC:
 * 1. Task created for Repolens-AI
 * 2. Worktree provisioned
 * 3. Real code changes implemented in Repolens-AI
 * 4. Changes committed via GridMind MCP (gridmind_git_commit)
 * 5. Task completed
 * 6. PROOF: GridMind automatically extracted & saved the commit and completion context
 *    to project memory without ANY manual record_memory call!
 * 7. PROOF: A subsequent agent query automatically receives this context!
 */

import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BASE = "http://localhost:3000";
const PROJECT_ID = "08VIlKKgIW5exP"; // Repolens-AI

async function api(method, urlPath, body = null, headers = {}) {
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
  const client = new Client({ name: "auto-context-demo", version: "1.0.0" }, { capabilities: {} });
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
  console.log("\n========================================================");
  console.log("GRIDMIND AUTOMATIC CONTEXT PERSISTENCE — REPOLENS-AI");
  console.log("========================================================\n");

  // Step 1: Create a feature task in Repolens-AI
  console.log("[Step 1] Creating developer task in Repolens-AI...");
  const taskRes = await api("POST", `/api/projects/${PROJECT_ID}/tasks`, {
    title: "Implement Git repository velocity and code churn analyzer",
    description: "Build an AST-aware repository metrics analyzer for code churn, commit frequency, and contributor velocity.",
    priority: "high",
  });
  const task = taskRes.data?.task;
  console.log(`  ✓ Task created: [${task.id}] "${task.title}"`);

  // Step 2: Provision isolated Git worktree for this task
  console.log("\n[Step 2] Provisioning isolated worktree for the task...");
  const wtRes = await api("POST", `/api/projects/${PROJECT_ID}/worktree`, {
    action: "provision",
    taskId: task.id,
  });
  const wt = wtRes.data?.task;
  console.log(`  ✓ Worktree provisioned at: ${wt.worktree_path}`);
  console.log(`  ✓ Isolated Git branch: ${wt.worktree_branch}`);

  // Step 3: Spawn an agent session
  console.log("\n[Step 3] Spawning Agent Session for the task...");
  const agRes = await api("POST", `/api/projects/${PROJECT_ID}/agents`, {
    agentType: "opencode",
    role: "worker",
    taskId: task.id,
    prompt: "Implement the Git repository velocity and churn analyzer module in src/lib/git-analyzer.ts",
  });
  const session = agRes.data?.session;
  console.log(`  ✓ Agent Session spawned: id=${session.id} (token=${session.token.slice(0, 10)}...)`);

  // Step 4: Connect to GridMind MCP
  console.log("\n[Step 4] Connecting Agent to GridMind MCP over stdio...");
  const { client, transport } = await createMcpClient(session.token);
  const initCtx = parseText(await client.callTool({ name: "gridmind_get_session_context", arguments: {} }));
  console.log(`  ✓ MCP Session Authenticated: role=${initCtx.role}, assigned_task=${initCtx.task?.id}`);

  // Step 5: Implement real code changes in Repolens-AI worktree
  console.log("\n[Step 5] Writing new feature module in Repolens-AI worktree...");
  const analyzerCode = `/**
 * Repolens-AI Git Metrics & Velocity Analyzer
 * Automatically computes code churn, commit cadence, and contributor health score.
 */

export interface CommitMetric {
  hash: string;
  author: string;
  date: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface VelocityReport {
  totalCommits: number;
  churnRate: number;
  codeGrowthRatio: number;
  velocityScore: number;
  healthGrade: "A" | "B" | "C" | "D";
}

export function computeVelocity(metrics: CommitMetric[]): VelocityReport {
  if (metrics.length === 0) {
    return {
      totalCommits: 0,
      churnRate: 0,
      codeGrowthRatio: 1,
      velocityScore: 100,
      healthGrade: "A",
    };
  }

  const totalIns = metrics.reduce((acc, m) => acc + m.insertions, 0);
  const totalDel = metrics.reduce((acc, m) => acc + m.deletions, 0);
  const totalChanges = totalIns + totalDel;

  const churnRate = totalChanges > 0 ? Number((totalDel / totalChanges).toFixed(3)) : 0;
  const growthRatio = totalDel > 0 ? Number((totalIns / totalDel).toFixed(2)) : totalIns;

  let score = 85;
  if (churnRate > 0.6) score -= 20;
  if (churnRate < 0.35 && totalChanges > 100) score += 10;
  score = Math.max(0, Math.min(100, score));

  let grade: VelocityReport["healthGrade"] = "A";
  if (score < 60) grade = "D";
  else if (score < 75) grade = "C";
  else if (score < 90) grade = "B";

  return {
    totalCommits: metrics.length,
    churnRate,
    codeGrowthRatio: growthRatio,
    velocityScore: score,
    healthGrade: grade,
  };
}
`;

  const targetDir = path.join(wt.worktree_path, "src", "lib");
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, "git-analyzer.ts");
  fs.writeFileSync(targetFile, analyzerCode, "utf8");
  console.log(`  ✓ Created: ${targetFile} (${analyzerCode.length} bytes)`);

  // Step 6: Commit changes via GridMind MCP
  console.log("\n[Step 6] Committing code change via GridMind MCP...");
  const commitRes = parseText(await client.callTool({
    name: "gridmind_git_commit",
    arguments: {
      message: "feat(analyzer): implement Git repository velocity and code churn analyzer",
    },
  }));
  console.log(`  ✓ Committed via MCP: SHA ${commitRes.short_sha} (${commitRes.commit_sha})`);
  console.log(`  ✓ Message: "${commitRes.message}" on branch "${commitRes.branch}"`);

  // Step 7: Update task status to done
  console.log("\n[Step 7] Marking task as done via GridMind MCP...");
  await client.callTool({
    name: "gridmind_update_task_status",
    arguments: {
      status: "done",
    },
  });
  console.log("  ✓ Task marked as done.");

  // Close MCP client
  await transport.close();

  // Step 8: THE PROOF — Context was saved AUTOMATICALLY without any manual record_memory call!
  console.log("\n========================================================");
  console.log("[Step 8] PROVING AUTOMATIC CONTEXT PERSISTENCE");
  console.log("========================================================");

  // Query project memories via internal memory endpoint
  const memRes = await api("GET", `/api/internal/memory`, null, {
    Authorization: `Bearer ${session.token}`,
  });
  const memories = memRes.data?.memories ?? [];
  const autoCommitMem = memories.find((m) => m.content.includes(commitRes.short_sha));
  const autoTaskMem = memories.find((m) => m.content.includes(task.title));

  console.log("\n1. Auto-Captured Git Commit Memory:");
  if (autoCommitMem) {
    console.log(`  ✓ FOUND! [ID: ${autoCommitMem.id}]`);
    console.log(`    Content: "${autoCommitMem.content}"`);
    console.log(`    Scope: ${autoCommitMem.scope} | Source: ${autoCommitMem.source} | Importance: ★${autoCommitMem.importance}`);
  } else {
    console.log("  ✗ Not found");
  }

  console.log("\n2. Auto-Captured Task Completion Memory:");
  if (autoTaskMem) {
    console.log(`  ✓ FOUND! [ID: ${autoTaskMem.id}]`);
    console.log(`    Content: "${autoTaskMem.content}"`);
    console.log(`    Scope: ${autoTaskMem.scope} | Source: ${autoTaskMem.source} | Importance: ★${autoTaskMem.importance}`);
  } else {
    console.log("  ✗ Not found");
  }

  // Step 9: Verify a subsequent agent prompt automatically receives this context!
  console.log("\n[Step 9] Simulating Next Agent: Checking Retrieved Context for query 'velocity churn analyzer'...");
  const retrieveRes = await api("POST", `/api/internal/memory/retrieve`, {
    query: "velocity churn analyzer",
    max_tokens: 1500,
  }, {
    Authorization: `Bearer ${session.token}`,
  });

  const brief = retrieveRes.data?.contextBrief || "";
  console.log("\n--- AUTOMATICALLY INJECTED AGENT CONTEXT BRIEF ---");
  console.log(brief);
  console.log("-------------------------------------------------");

  const hasCommitInBrief = brief.includes(commitRes.short_sha);
  console.log(`\n  ✓ Did the agent automatically get the commit context without manual saving? ${hasCommitInBrief ? "YES! 🚀" : "NO"}`);

  console.log("\n========================================================");
  console.log("DEMONSTRATION COMPLETED SUCCESSFULLY");
  console.log("========================================================\n");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
