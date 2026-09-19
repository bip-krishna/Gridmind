import { NextResponse } from "next/server";
import { getProject, listSessions, listTasks, buildContextBrief, getOrchestration, getTask } from "@/lib/db";
import { adaptersStatus, type AgentType } from "@/lib/agents";
import { startAgentSession, isSessionActive } from "@/lib/runner";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sessions = listSessions(id).map((s) => ({
    ...s,
    active: isSessionActive(s.id),
  }));

  return NextResponse.json({ sessions, adapters: adaptersStatus() });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as {
    agentType?: AgentType | string;
    role?: string;
    title?: string;
    prompt?: string;
    taskId?: string;
  };

  const agentType = body.agentType ?? "opencode";
  const role = body.role ?? "worker";

  if (body.prompt === undefined) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  // Validate task if provided
  let task = null;
  if (body.taskId) {
    task = getTask(id, body.taskId);
    if (!task) {
      return NextResponse.json({ error: "task not found in this project" }, { status: 404 });
    }
    if (task.project_id !== id) {
      return NextResponse.json({ error: "task does not belong to this project" }, { status: 403 });
    }
  }

  let prompt = body.prompt ?? "";
  let title = body.title?.trim() || (role === "master" ? "Master orchestration" : "Agent run");
  let effectiveAgentType = agentType;

  if (role === "master") {
    const orchestration = getOrchestration(id);
    title = body.title?.trim() || `${orchestration.master?.name ?? "Master"} · orchestration`;
    effectiveAgentType = orchestration.master?.agent_type ?? agentType;
    prompt = buildMasterPrompt(id, prompt, orchestration);
  }

  const { session } = await startAgentSession({
    projectId: id,
    agentType: effectiveAgentType,
    role,
    title,
    prompt,
    taskId: body.taskId,
  });

  return NextResponse.json({ session, available: adaptersStatus()[effectiveAgentType as AgentType]?.available ?? false }, { status: 201 });
}

function buildMasterPrompt(
  projectId: string,
  userDirective: string,
  orchestration: ReturnType<typeof getOrchestration>
): string {
  const tasks = listTasks(projectId);
  const context = buildContextBrief(projectId);

  const masterName = orchestration.master?.name ?? "OpenCode";
  const teamLines = orchestration.subagents.length
    ? orchestration.subagents.map((a) => `- ${a.name} (${a.agent_type}) — ${a.role.toUpperCase()}`).join("\n")
    : "- (no subagents configured yet)";

  const taskLines = tasks.length
    ? tasks
        .map((t) => {
          const assign =
            t.assigned_agent === "auto" || t.assigned_agent === "master"
              ? " (auto → assign via team)"
              : t.assigned_agent
                ? ` (assigned: ${t.assigned_agent})`
                : " (unassigned)";
          return `- [${t.status}] ${t.title}${assign}`;
        })
        .join("\n")
    : "(no tasks yet)";

  return [
    `You are the MASTER / ORCHESTRATOR agent for GridMind. Your identifier is ${masterName} (${orchestration.master?.agent_type ?? "opencode"}).`,
    "You coordinate work across your configured team of coding agents on a shared Git repository.",
    "",
    "Your team:",
    teamLines,
    "",
    "You are responsible for:",
    "1. Analyzing the repository state and the task backlog below.",
    "2. Orchestrating: assign discrete, well-scoped work to your subagents by role (WORKER implements, REVIEWER verifies builds/tests and reports issues).",
    "3. Producing a concise execution plan (3-6 steps) for your team, or directly implementing a change if it is small and self-contained.",
    "4. Handling conflicts and keeping changes scoped. Verify with build/lint/tests when practical.",
    "",
    `Project context:\n${context}`,
    "",
    `Task backlog:\n${taskLines}`,
    "",
    `Operator directive: ${userDirective}`,
    "",
    "When finished, summarize what you did, which subagent should do what next, and what remains.",
  ].join("\n");
}