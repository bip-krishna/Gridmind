"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge, Dot } from "@/components/ui";
import { AGENT_ROLE_LABEL, type AgentCardInfo } from "@/lib/topology";
import { agentTone, cn } from "@/lib/utils";

const NODE_W = 236;
const NODE_H = 150;
const COMPACT_W = 206;
const GAP_X = 34;
const ROW_Y = NODE_H + 64;

type TeamData = { card: AgentCardInfo; compact: boolean };

function buildGraph(cards: AgentCardInfo[], compact: boolean) {
  const w = compact ? COMPACT_W : NODE_W;
  const { master, subs } = {
    master: cards.find((c) => c.role === "master") ?? null,
    subs: cards.filter((c) => c.role !== "master"),
  };

  const nodes: Node<TeamData>[] = [];
  const edges: Edge[] = [];

  if (master) {
    nodes.push({
      id: master.id,
      type: "team",
      position: { x: 0, y: 0 },
      data: { card: master, compact },
    });
  }

  const totalW = subs.length > 0 ? subs.length * w + (subs.length - 1) * GAP_X : w;
  const startX = master ? 0 - totalW / 2 + w / 2 : 0 - totalW / 2;

  subs.forEach((s, i) => {
    nodes.push({
      id: s.id,
      type: "team",
      position: { x: startX + i * (w + GAP_X), y: master ? ROW_Y : 0 },
      data: { card: s, compact },
    });
    if (master) {
      edges.push({
        id: `${master.id}->${s.id}`,
        source: master.id,
        target: s.id,
        type: "smoothstep",
        animated: s.working,
        style: { stroke: "var(--border-strong)", strokeWidth: 1.5 },
      });
    }
  });

  return { nodes, edges };
}

function TeamNode({ data }: NodeProps<Node<TeamData>>) {
  const { card, compact } = data;
  return (
    <div
      className={cn(
        "rounded-lg border bg-bg-elevated transition-colors",
        compact ? "w-[206px]" : "w-[236px]",
        card.working ? "border-amber/50" : "border-border"
      )}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <AgentCardBody card={card} compact={compact} />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

const nodeTypes = { team: TeamNode };

export function TeamGraph({
  cards,
  compact = false,
  height = 320,
  onSelect,
  emptyHint,
}: {
  cards: AgentCardInfo[];
  compact?: boolean;
  height?: number;
  onSelect?: (card: AgentCardInfo) => void;
  emptyHint?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const built = useMemo(() => buildGraph(cards, compact), [cards, compact]);
  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);

  useEffect(() => {
    setEdges(built.edges);
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return built.nodes.map((n) => {
        const existing = prevById.get(n.id);
        return existing ? { ...existing, data: n.data } : n;
      });
    });
  }, [built, setEdges, setNodes]);

  if (!mounted) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-[11px] text-fg-dim animate-pulse"
      >
        Initializing canvas…
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-border bg-bg-elevated text-center"
        style={{ height }}
      >
        <div className="px-6">
          <div className="text-[12px] font-medium text-fg-muted">No team configured yet</div>
          {emptyHint && <p className="mt-1 text-[11px] leading-relaxed text-fg-dim">{emptyHint}</p>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full overflow-hidden rounded-lg border border-border bg-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_e, node) => {
          onSelect?.((node.data as TeamData).card);
        }}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1.15 }}
        minZoom={0.35}
        maxZoom={1.6}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch
        proOptions={{ hideAttribution: true }}
        nodesFocusable
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border)" />
      </ReactFlow>
    </div>
  );
}

export function AgentCardBody({ card, compact = false }: { card: AgentCardInfo; compact?: boolean }) {
  return (
    <div className="flex flex-col p-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Dot tone={card.statusTone} pulse={card.working} />
          <span className="truncate text-[12px] font-semibold uppercase tracking-wide text-fg">
            {card.name}
          </span>
        </div>
        <Badge tone={card.role === "master" ? "dim" : card.role === "reviewer" ? "dim" : agentTone(card.agent_type)}>
          {AGENT_ROLE_LABEL[card.role]}
        </Badge>
      </div>

      {!compact && (
        <div className="mt-2 flex flex-col gap-1 text-[10px] text-fg-dim font-mono">
          <span className="flex items-center gap-1.5">
            <span className="w-10 uppercase tracking-wide text-fg-dim/80">Status</span>
            <span className={cn("font-medium", card.working ? "text-amber" : card.connected ? "text-green" : "text-fg-muted")}>
              {card.statusLabel}
            </span>
            <span className="text-fg-dim/50">·</span>
            <span className="normal-case">{card.agent_type}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-10 uppercase tracking-wide text-fg-dim/80">Task</span>
            <span className="truncate text-fg-muted">{card.taskTitle ?? "idle"}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-10 uppercase tracking-wide text-fg-dim/80">Branch</span>
            <span className="truncate text-fg-muted">{card.branch ?? "none"}</span>
          </span>
        </div>
      )}
    </div>
  );
}

export function MiniChain({
  taskTitle,
  master,
  subs,
}: {
  taskTitle: string;
  master: AgentCardInfo | null;
  subs: AgentCardInfo[];
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span className="rounded border border-border bg-bg-subtle px-2 py-0.5 text-[10px] font-mono text-fg">
          {taskTitle.length > 42 ? `${taskTitle.slice(0, 42)}…` : taskTitle}
        </span>
      </div>
      <div className="flex items-center gap-1 pl-3 text-fg-dim">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </div>
      <div className="flex items-center gap-2 pl-3">
        <span className="rounded border border-border bg-bg-subtle px-2 py-0.5 text-[10px] font-medium text-fg">
          {master ? master.name : "Master"}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-fg-dim font-mono">· {master ? master.agent_type : "none configured"}</span>
      </div>
      {subs.length > 0 && (
        <>
          <div className="flex items-center gap-1 pl-6 text-fg-dim">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
          <div className="flex flex-wrap gap-1.5 pl-6">
            {subs.map((s) => (
              <span
                key={s.id}
                className="rounded border border-border bg-bg-subtle px-2 py-0.5 text-[10px] font-mono text-fg-muted"
              >
                {s.name} · {AGENT_ROLE_LABEL[s.role]}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}