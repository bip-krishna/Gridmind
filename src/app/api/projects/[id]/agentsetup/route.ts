import { NextResponse } from "next/server";
import { getProject, getOrchestration, setMasterAgent, createAgent, renameAgent, deleteAgent, listAgents } from "@/lib/db";
import { adaptersStatus, AGENT_TYPES, newId } from "@/lib/agents";
import { publish } from "@/lib/events";
import type { AgentRole } from "@/lib/db";

export const runtime = "nodejs";

const VALID_ROLES: AgentRole[] = ["master", "worker", "reviewer"];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    orchestration: getOrchestration(id),
    agents: listAgents(id),
    adapters: adaptersStatus(),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as {
    agent_type?: string;
    role?: string;
    name?: string;
  };
  const agentType = String(body.agent_type ?? "").toLowerCase();
  const role = String(body.role ?? "").toLowerCase();
  const name = String(body.name ?? "").trim();

  if (!AGENT_TYPES.includes(agentType as (typeof AGENT_TYPES)[number])) {
    return NextResponse.json({ error: `unknown agent type: ${agentType}` }, { status: 400 });
  }
  if (!(VALID_ROLES as string[]).includes(role)) {
    return NextResponse.json({ error: `invalid role: ${role}` }, { status: 400 });
  }

  const label = adaptersStatus()[agentType as keyof ReturnType<typeof adaptersStatus>]?.label ?? agentType;
  const displayedName = name || label;

  if (role === "master") {
    const master = setMasterAgent(id, { agent_type: agentType, name: displayedName });
    publish(id, "agentsetup:master", { agentId: master.id, agentType, name: master.name });
    return NextResponse.json({ agent: master, orchestration: getOrchestration(id) }, { status: 201 });
  }

  const agent = createAgent(id, { id: newId(), name: displayedName, agent_type: agentType, role: role as AgentRole });
  publish(id, "agentsetup:change", { agentId: agent.id, role, agentType, name: agent.name });
  return NextResponse.json({ agent, orchestration: getOrchestration(id) }, { status: 201 });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { agentId?: string; name?: string };
  if (!body.agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 });

  const name = String(body.name ?? "").trim();
  const existing = listAgents(id).find((a) => a.id === body.agentId);
  if (!existing) return NextResponse.json({ error: "agent not found" }, { status: 404 });

  const agent = renameAgent(id, body.agentId, name || existing.name);
  publish(id, "agentsetup:change", { agentId: agent!.id, name: agent!.name, role: agent!.role });
  return NextResponse.json({ agent, orchestration: getOrchestration(id) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId");
  if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 });

  const existing = listAgents(id).find((a) => a.id === agentId);
  if (!existing) return NextResponse.json({ error: "agent not found" }, { status: 404 });

  deleteAgent(id, agentId);
  publish(id, "agentsetup:change", { removed: agentId, role: existing.role, agentType: existing.agent_type });
  return NextResponse.json({ orchestration: getOrchestration(id) });
}