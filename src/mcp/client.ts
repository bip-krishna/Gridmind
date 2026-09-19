/**
 * GridMind MCP Bridge Client
 *
 * Communicates with the GridMind internal HTTP API using the authenticated session Bearer token.
 * All authorization, security, and project isolation rules are enforced server-side.
 */

export class GridMindApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorText: string
  ) {
    super(`GridMind API error (${status}): ${errorText}`);
    this.name = "GridMindApiError";
  }
}

export type GridMindClientOptions = {
  baseUrl?: string;
  token?: string;
};

export class GridMindClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(options?: GridMindClientOptions) {
    const rawUrl = options?.baseUrl || process.env.GRIDMIND_API || "http://localhost:3000";
    this.baseUrl = rawUrl.replace(/\/+$/, "");
    this.token = (options?.token || process.env.GRIDMIND_TOKEN || "").trim();
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) {
      throw new GridMindApiError(401, "GRIDMIND_TOKEN environment variable is missing or empty");
    }

    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };

    const reqInit: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined && body !== null) {
      reqInit.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, reqInit);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new GridMindApiError(503, `Failed to connect to GridMind server at ${this.baseUrl}: ${message}`);
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      if (text.trim()) {
        data = JSON.parse(text);
      }
    } catch {
      data = text;
    }

    if (!res.ok) {
      const errMessage = (data && typeof data === "object" && "error" in data)
        ? String((data as { error: unknown }).error)
        : (typeof data === "string" ? data : `HTTP ${res.status}`);
      throw new GridMindApiError(res.status, errMessage);
    }

    return data as T;
  }

  /**
   * 1. Discover session context (session_id, project_id, task_id, role, agent_type).
   */
  async getSessionContext() {
    return this.request<{
      ok: boolean;
      session_id: string;
      project_id: string;
      task_id: string | null;
      role: string;
      agent_type: string;
      title: string;
      status: string;
      project: { id: string; name: string } | null;
      task: { id: string; title: string; status: string; branch: string | null; worktree_path: string | null } | null;
    }>("GET", "/api/internal/session");
  }

  /**
   * 2. Retrieve project & task context (project details, task info, context entries, memory brief).
   */
  async getContext(taskId?: string) {
    const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : "";
    return this.request<{
      ok: boolean;
      project: { id: string; name: string; repo_path: string };
      task: { id: string; title: string; description: string; status: string; priority: string; branch: string | null; worktree_path: string | null } | null;
      context: { key: string; value: string }[];
      memories: unknown[];
      contextBrief: string;
    }>("GET", `/api/internal/context${query}`);
  }

  /**
   * 3. Search project memory with relevance ranking and token budget compaction.
   */
  async searchMemory(options: {
    query?: string;
    category?: string;
    limit?: number;
    taskId?: string;
  }) {
    // Map category to memory type or scope if applicable
    const validScopes = ["project_shared", "agent_private", "task"];
    const scopes = options.category && validScopes.includes(options.category)
      ? [options.category as "project_shared" | "agent_private" | "task"]
      : undefined;

    return this.request<{
      ok: boolean;
      memories: Array<{
        id: string;
        scope: string;
        type: string;
        content: string;
        importance: number;
        score: number;
        relevance_reasons: string[];
      }>;
      contextBrief: string;
      tokensUsed: number;
      totalCandidates: number;
      omittedCount: number;
    }>("POST", "/api/internal/memory/retrieve", {
      query: options.query,
      max_tokens: options.limit ?? 1000,
      scopes,
      task_id: options.taskId,
    });
  }

  /**
   * 4. Record persistent memory into GridMind.
   */
  async recordMemory(input: {
    scope: "project_shared" | "agent_private" | "task";
    category?: "fact" | "discovery" | "constraint" | "note";
    title?: string;
    content: string;
    importance?: number;
    taskId?: string;
  }) {
    let effectiveTaskId = input.taskId;
    if (input.scope === "task" && !effectiveTaskId) {
      const sessionCtx = await this.getSessionContext();
      if (!sessionCtx.task_id) {
        throw new GridMindApiError(400, "No task is assigned to this session for task-scoped memory");
      }
      effectiveTaskId = sessionCtx.task_id;
    }

    const formattedContent = input.title?.trim()
      ? `${input.title.trim()}: ${input.content.trim()}`
      : input.content.trim();

    return this.request<{
      ok: boolean;
      memory: {
        id: string;
        project_id: string;
        scope: string;
        type: string;
        content: string;
        importance: number;
        task_id: string | null;
        session_id: string | null;
      };
    }>("POST", "/api/internal/memory", {
      scope: input.scope,
      type: input.category || "note",
      content: formattedContent,
      importance: input.importance ?? 1,
      source: "agent",
      task_id: effectiveTaskId,
    });
  }

  /**
   * 5. Get assigned or specified task details.
   */
  async getTask(taskId?: string) {
    let effectiveTaskId = taskId;
    if (!effectiveTaskId) {
      const sessionCtx = await this.getSessionContext();
      if (!sessionCtx.task_id) {
        throw new GridMindApiError(404, "No task is assigned to this session");
      }
      effectiveTaskId = sessionCtx.task_id;
    }

    return this.request<{
      ok: boolean;
      task: {
        id: string;
        project_id: string;
        title: string;
        description: string;
        status: string;
        priority: string;
        assigned_agent: string | null;
        branch: string | null;
        worktree_path: string | null;
        worktree_branch: string | null;
      };
    }>("GET", `/api/internal/tasks/${encodeURIComponent(effectiveTaskId)}`);
  }

  /**
   * 6. Update task status with lifecycle transition validation.
   */
  async updateTaskStatus(input: {
    status: string;
    description?: string;
    taskId?: string;
  }) {
    let effectiveTaskId = input.taskId;
    if (!effectiveTaskId) {
      const sessionCtx = await this.getSessionContext();
      if (!sessionCtx.task_id) {
        throw new GridMindApiError(404, "No task is assigned to this session");
      }
      effectiveTaskId = sessionCtx.task_id;
    }

    return this.request<{
      task: {
        id: string;
        status: string;
        description?: string;
      };
    }>("POST", `/api/internal/tasks/${encodeURIComponent(effectiveTaskId)}/status`, {
      status: input.status,
      description: input.description,
    });
  }

  /**
   * 7. Record project-scoped decision.
   */
  async recordDecision(input: { title: string; body: string }) {
    return this.request<{
      decision: {
        id: string;
        title: string;
        body: string;
      };
    }>("POST", "/api/internal/decisions", {
      title: input.title,
      body: input.body,
    });
  }

  /**
   * 8. Emit project/session scoped real-time event.
   */
  async emitEvent(input: {
    type: string;
    message?: string;
    payload?: Record<string, unknown>;
  }) {
    return this.request<{ ok: boolean; type: string }>("POST", "/api/internal/events", {
      type: input.type,
      payload: {
        ...(input.payload ?? {}),
        message: input.message,
      },
    });
  }

  /**
   * Stage 5B: Create structured handoff to another task in the project.
   */
  async createHandoff(input: {
    targetTaskId: string;
    summary: string;
    completedWork: string;
    changedFiles?: string[];
    decisions?: string[];
    blockers?: string[];
    nextSteps?: string[];
  }) {
    return this.request<{
      ok: boolean;
      handoff: {
        id: string;
        project_id: string;
        source_session_id: string;
        source_task_id: string;
        target_task_id: string;
        summary: string;
        completed_work: string;
        changed_files: string[];
        decisions: string[];
        blockers: string[];
        next_steps: string[];
        status: string;
        created_at: number;
        consumed_at: number | null;
      };
    }>("POST", "/api/internal/handoffs", {
      target_task_id: input.targetTaskId,
      summary: input.summary,
      completed_work: input.completedWork,
      changed_files: input.changedFiles,
      decisions: input.decisions,
      blockers: input.blockers,
      next_steps: input.nextSteps,
    });
  }

  /**
   * Stage 5B: Retrieve handoffs relevant to current task (worker) or project (master).
   */
  async getHandoffs(options?: { taskId?: string; status?: string }) {
    const params = new URLSearchParams();
    if (options?.taskId) params.set("task_id", options.taskId);
    if (options?.status) params.set("status", options.status);
    const query = params.toString() ? `?${params.toString()}` : "";

    return this.request<{
      ok: boolean;
      handoffs: Array<{
        id: string;
        project_id: string;
        source_session_id: string;
        source_task_id: string;
        target_task_id: string;
        summary: string;
        completed_work: string;
        changed_files: string[];
        decisions: string[];
        blockers: string[];
        next_steps: string[];
        status: string;
        created_at: number;
        consumed_at: number | null;
      }>;
    }>("GET", `/api/internal/handoffs${query}`);
  }

  /**
   * Stage 5B: Accept a handoff targeted at the worker's task.
   */
  async acceptHandoff(handoffId: string) {
    return this.request<{
      ok: boolean;
      handoff: {
        id: string;
        project_id: string;
        source_session_id: string;
        source_task_id: string;
        target_task_id: string;
        summary: string;
        completed_work: string;
        changed_files: string[];
        decisions: string[];
        blockers: string[];
        next_steps: string[];
        status: string;
        created_at: number;
        consumed_at: number | null;
      };
      already_accepted?: boolean;
    }>("POST", `/api/internal/handoffs/${encodeURIComponent(handoffId)}/accept`);
  }
}
