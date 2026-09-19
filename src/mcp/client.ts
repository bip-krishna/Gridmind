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
    commitSha?: string;
    branch?: string;
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
        commit_sha?: string | null;
        branch?: string | null;
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
      commit_sha: input.commitSha,
      branch: input.branch,
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
        commit_sha?: string | null;
        branch?: string | null;
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
        commit_sha?: string | null;
        branch?: string | null;
        status: string;
        created_at: number;
        consumed_at: number | null;
      };
      already_accepted?: boolean;
    }>("POST", `/api/internal/handoffs/${encodeURIComponent(handoffId)}/accept`);
  }

  /**
   * Stage 5C: Git status of the authenticated task worktree.
   */
  async gitStatus(options?: { taskId?: string }) {
    return this.request<{
      ok: boolean;
      branch: string;
      clean: boolean;
      dirty: boolean;
      changed_files: string[];
      untracked_files: string[];
      changed_files_count: number;
      untracked_files_count: number;
      ahead_behind: string;
      truncated: boolean;
    }>("POST", "/api/internal/git/status", {
      task_id: options?.taskId,
    });
  }

  /**
   * Stage 5C: Git diff with path traversal protection and output bounding.
   */
  async gitDiff(options?: { path?: string; staged?: boolean; commit?: string; taskId?: string }) {
    return this.request<{
      ok: boolean;
      diff: string;
      truncated: boolean;
      length: number;
    }>("POST", "/api/internal/git/diff", {
      path: options?.path,
      staged: options?.staged,
      commit: options?.commit,
      task_id: options?.taskId,
    });
  }

  /**
   * Stage 5C: Git commit of authenticated worktree changes.
   */
  async gitCommit(input: { message: string; taskId?: string }) {
    return this.request<{
      ok: boolean;
      commit_sha: string;
      short_sha: string;
      message: string;
      branch: string;
    }>("POST", "/api/internal/git/commit", {
      message: input.message,
      task_id: input.taskId,
    });
  }

  /**
   * Stage 5C: List branches in repository/worktree.
   */
  async gitBranches(options?: { taskId?: string }) {
    const query = options?.taskId ? `?task_id=${encodeURIComponent(options.taskId)}` : "";
    return this.request<{
      ok: boolean;
      current: string;
      branches: string[];
      total: number;
      truncated: boolean;
    }>("GET", `/api/internal/git/branches${query}`);
  }

  /**
   * Stage 5C: Bounded git log of recent commits.
   */
  async gitLog(options?: { limit?: number; commit?: string; taskId?: string }) {
    return this.request<{
      ok: boolean;
      commits: Array<{
        sha: string;
        short_sha: string;
        message: string;
        author: string;
        date: string;
      }>;
      count: number;
      limit: number;
    }>("POST", "/api/internal/git/log", {
      limit: options?.limit,
      commit: options?.commit,
      task_id: options?.taskId,
    });
  }

  /**
   * Stage 5C: List project repository GitHub issues.
   */
  async githubIssues(options?: { limit?: number }) {
    const query = options?.limit ? `?limit=${encodeURIComponent(options.limit)}` : "";
    return this.request<{
      ok: boolean;
      configured: boolean;
      repository?: string;
      issues: Array<{
        number: number;
        title: string;
        state: string;
        url: string;
        labels: string[];
        created_at: string;
      }>;
      count?: number;
      truncated?: boolean;
      message?: string;
    }>("GET", `/api/internal/github/issues${query}`);
  }

  /**
   * Stage 5C: Create GitHub Pull Request from task branch.
   */
  async githubCreatePr(input: {
    title: string;
    body?: string;
    headBranch: string;
    baseBranch?: string;
    taskId?: string;
  }) {
    return this.request<{
      ok: boolean;
      pr_number: number;
      url: string;
      title: string;
      head: string;
      base: string;
      repository: string;
    }>("POST", "/api/internal/github/pr", {
      title: input.title,
      body: input.body,
      head_branch: input.headBranch,
      base_branch: input.baseBranch,
      task_id: input.taskId,
    });
  }

  /**
   * Stage 5C: Convert GitHub issue to GridMind task.
   */
  async githubIssueToTask(issueNumber: number) {
    return this.request<{
      ok: boolean;
      task: {
        id: string;
        project_id: string;
        title: string;
        description: string;
        status: string;
        priority: string;
        issue_number: number;
      };
    }>("POST", "/api/internal/github/issue-to-task", {
      issue_number: issueNumber,
    });
  }

  /**
   * Stage 5C: Record structured task execution result for current session.
   */
  async reportResult(sessionId: string, input: {
    summary?: string;
    status?: string;
    files?: string[];
    decisions?: string[];
    blockers?: string[];
    nextSteps?: string[];
    commits?: Array<{ sha: string; message?: string } | string>;
  }) {
    return this.request<{
      session: {
        id: string;
        result_summary: string | null;
        result_status: string | null;
        result_files: string[] | null;
        result_decisions: string[] | null;
        result_blockers: string[] | null;
        result_next_steps: string[] | null;
        result_commits: Array<{ sha: string; message?: string } | string> | null;
      };
    }>("POST", `/api/internal/sessions/${encodeURIComponent(sessionId)}/result`, {
      summary: input.summary,
      status: input.status,
      files: input.files,
      decisions: input.decisions,
      blockers: input.blockers,
      next_steps: input.nextSteps,
      commits: input.commits,
    });
  }
}
