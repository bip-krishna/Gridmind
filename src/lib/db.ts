import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

const DATA_DIR = path.join(process.cwd(), ".gridmind");

export function dataDir(): string {
  return DATA_DIR;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const globalForDb = globalThis as unknown as { __gridmindDb?: Database.Database };

function createDb(): Database.Database {
  ensureDataDir();
  const db = new Database(path.join(DATA_DIR, "gridmind.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function db(): Database.Database {
  if (!globalForDb.__gridmindDb) globalForDb.__gridmindDb = createDb();
  return globalForDb.__gridmindDb;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      github_repo TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_entries (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, key)
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_agent TEXT,
      session_id TEXT,
      issue_number INTEGER,
      branch TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_type TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'worker',
      title TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      current_step TEXT NOT NULL DEFAULT 'starting',
      output TEXT NOT NULL DEFAULT '',
      exit_code INTEGER,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      token TEXT,
      agent_config_id TEXT,
      task_id TEXT,
      result_summary TEXT,
      result_status TEXT,
      result_files TEXT,
      result_decisions TEXT,
      result_blockers TEXT,
      result_next_steps TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'worker',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_config (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      master_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id);
    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, id);
  `);

  // Migration: add token/agent_config_id to sessions for existing DBs
  try { db.exec(`ALTER TABLE sessions ADD COLUMN token TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sessions ADD COLUMN agent_config_id TEXT`); } catch { /* already exists */ }

  // Migration: add task_id to sessions
  try { db.exec(`ALTER TABLE sessions ADD COLUMN task_id TEXT`); } catch { /* already exists */ }

  // Migration: add result fields to sessions
  try { db.exec(`ALTER TABLE sessions ADD COLUMN result_summary TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sessions ADD COLUMN result_status TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sessions ADD COLUMN result_files TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sessions ADD COLUMN result_decisions TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sessions ADD COLUMN result_blockers TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sessions ADD COLUMN result_next_steps TEXT`); } catch { /* already exists */ }

  // Stage 3: add worktree columns to tasks
  try { db.exec(`ALTER TABLE tasks ADD COLUMN worktree_path TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tasks ADD COLUMN worktree_branch TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tasks ADD COLUMN worktree_status TEXT NOT NULL DEFAULT 'none'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tasks ADD COLUMN worktree_base_branch TEXT`); } catch { /* already exists */ }

  // Stage 3: unique index — no two tasks can share a worktree branch
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_worktree_branch ON tasks(worktree_branch) WHERE worktree_branch IS NOT NULL`); } catch { /* already exists */ }

  // Stage 4: agent memory
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (scope IN ('project_shared', 'agent_private', 'task')),
      session_id TEXT,
      task_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('fact', 'discovery', 'constraint', 'note')),
      content TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 1 CHECK (importance BETWEEN 1 AND 3),
      source TEXT NOT NULL CHECK (source IN ('agent', 'user', 'task', 'decision')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_memories_project_scope ON memories(project_id, scope);
    CREATE INDEX IF NOT EXISTS idx_memories_project_task ON memories(project_id, task_id);
    CREATE INDEX IF NOT EXISTS idx_memories_project_session ON memories(project_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_memories_project_archived ON memories(project_id, archived_at);

    -- Stage 5B: Agent handoffs
    CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      completed_work TEXT NOT NULL,
      changed_files TEXT NOT NULL DEFAULT '[]',
      decisions TEXT NOT NULL DEFAULT '[]',
      blockers TEXT NOT NULL DEFAULT '[]',
      next_steps TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'completed', 'cancelled')),
      created_at INTEGER NOT NULL,
      consumed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_handoffs_project ON handoffs(project_id);
    CREATE INDEX IF NOT EXISTS idx_handoffs_source_session ON handoffs(source_session_id);
    CREATE INDEX IF NOT EXISTS idx_handoffs_source_task ON handoffs(source_task_id);
    CREATE INDEX IF NOT EXISTS idx_handoffs_target_task ON handoffs(target_task_id);
    CREATE INDEX IF NOT EXISTS idx_handoffs_project_status ON handoffs(project_id, status);
  `);
}

export type Project = {
  id: string;
  name: string;
  repo_path: string;
  github_repo: string | null;
  created_at: number;
};

export type Task = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigned_agent: string | null;
  session_id: string | null;
  issue_number: number | null;
  branch: string | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  worktree_status: string;
  worktree_base_branch: string | null;
  created_at: number;
  updated_at: number;
};

export type Session = {
  id: string;
  project_id: string;
  agent_type: string;
  role: string;
  title: string;
  prompt: string;
  status: string;
  current_step: string;
  output: string;
  exit_code: number | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  token: string | null;
  agent_config_id: string | null;
  task_id: string | null;
  result_summary: string | null;
  result_status: string | null;
  result_files: string | null;
  result_decisions: string | null;
  result_blockers: string | null;
  result_next_steps: string | null;
};

export type Decision = {
  id: string;
  project_id: string;
  title: string;
  body: string;
  status: string;
  created_at: number;
};

export type EventRecord = {
  id: number;
  project_id: string;
  type: string;
  payload: string;
  created_at: number;
};

export function now(): number {
  return Date.now();
}

export function listProjects(): Project[] {
  return db()
    .prepare("SELECT * FROM projects ORDER BY created_at DESC")
    .all() as Project[];
}

export function getProject(id: string): Project | null {
  const row = db().prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return (row as Project) ?? null;
}

export function createProject(input: {
  id: string;
  name: string;
  repo_path: string;
  github_repo?: string | null;
}): Project {
  const stmt = db().prepare(
    `INSERT INTO projects (id, name, repo_path, github_repo, created_at)
     VALUES (@id, @name, @repo_path, @github_repo, @created_at)`
  );
  stmt.run({
    id: input.id,
    name: input.name,
    repo_path: input.repo_path,
    github_repo: input.github_repo ?? null,
    created_at: now(),
  });
  return getProject(input.id)!;
}

export function updateProject(
  id: string,
  patch: Partial<{ name: string; github_repo: string | null }>
): Project | null {
  const existing = getProject(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  db()
    .prepare("UPDATE projects SET name = ?, github_repo = ? WHERE id = ?")
    .run(merged.name, merged.github_repo, id);
  return getProject(id);
}

export function deleteProject(id: string): void {
  const tx = db().transaction(() => {
    db().prepare("DELETE FROM events WHERE project_id = ?").run(id);
    db().prepare("DELETE FROM context_entries WHERE project_id = ?").run(id);
    db().prepare("DELETE FROM decisions WHERE project_id = ?").run(id);
    db().prepare("DELETE FROM handoffs WHERE project_id = ?").run(id);
    db().prepare("DELETE FROM memories WHERE project_id = ?").run(id);
    db().prepare("DELETE FROM tasks WHERE project_id = ?").run(id);
    db().prepare("DELETE FROM sessions WHERE project_id = ?").run(id);
    db().prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  tx();
}

// --- Context (project-scoped key/value) ---

export function listContext(projectId: string): { key: string; value: string }[] {
  return db()
    .prepare("SELECT key, value FROM context_entries WHERE project_id = ? ORDER BY key")
    .all(projectId) as { key: string; value: string }[];
}

export function setContext(projectId: string, key: string, value: string): void {
  db()
    .prepare(
      `INSERT INTO context_entries (project_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(projectId, key, value, now());
}

export function deleteContext(projectId: string, key: string): void {
  db()
    .prepare("DELETE FROM context_entries WHERE project_id = ? AND key = ?")
    .run(projectId, key);
}

export function buildContextBrief(projectId: string): string {
  const entries = listContext(projectId);
  if (entries.length === 0) return "(no project context set)";
  return entries.map((e) => `${e.key}: ${e.value}`).join("\n");
}

// --- Decisions ---

export function listDecisions(projectId: string): Decision[] {
  return db()
    .prepare("SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Decision[];
}

export function createDecision(
  projectId: string,
  input: { id: string; title: string; body: string }
): Decision {
  db()
    .prepare(
      `INSERT INTO decisions (id, project_id, title, body, status, created_at)
       VALUES (?, ?, ?, ?, 'open', ?)`
    )
    .run(input.id, projectId, input.title, input.body, now());
  return listDecisions(projectId).find((d) => d.id === input.id)!;
}

// --- Tasks ---

export function listTasks(projectId: string): Task[] {
  return db()
    .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Task[];
}

export function getTask(projectId: string, id: string): Task | null {
  const row = db()
    .prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ?")
    .get(id, projectId);
  return (row as Task) ?? null;
}

export function createTask(
  projectId: string,
  input: {
    id: string;
    title: string;
    description?: string;
    priority?: string;
    assigned_agent?: string | null;
    issue_number?: number | null;
    branch?: string | null;
  }
): Task {
  const t = now();
  db()
    .prepare(
      `INSERT INTO tasks (id, project_id, title, description, status, priority, assigned_agent, issue_number, branch, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      projectId,
      input.title,
      input.description ?? "",
      input.priority ?? "medium",
      input.assigned_agent ?? null,
      input.issue_number ?? null,
      input.branch ?? null,
      t,
      t
    );
  return getTask(projectId, input.id)!;
}

export function updateTask(
  projectId: string,
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    status: string;
    priority: string;
    assigned_agent: string | null;
    session_id: string | null;
    issue_number: number | null;
    branch: string | null;
    worktree_path: string | null;
    worktree_branch: string | null;
    worktree_status: string;
    worktree_base_branch: string | null;
  }>
): Task | null {
  const existing = getTask(projectId, id);
  if (!existing) return null;
  const merged = { ...existing, ...patch, updated_at: now() };
  db()
    .prepare(
      `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?,
        assigned_agent = ?, session_id = ?, issue_number = ?, branch = ?,
        worktree_path = ?, worktree_branch = ?, worktree_status = ?, worktree_base_branch = ?,
        updated_at = ?
       WHERE id = ? AND project_id = ?`
    )
    .run(
      merged.title,
      merged.description,
      merged.status,
      merged.priority,
      merged.assigned_agent,
      merged.session_id,
      merged.issue_number,
      merged.branch,
      merged.worktree_path,
      merged.worktree_branch,
      merged.worktree_status,
      merged.worktree_base_branch,
      merged.updated_at,
      id,
      projectId
    );
  return getTask(projectId, id);
}

export function deleteTask(projectId: string, id: string): void {
  db().prepare("DELETE FROM tasks WHERE id = ? AND project_id = ?").run(id, projectId);
}

// --- Sessions ---

export function listSessions(projectId: string): Session[] {
  return db()
    .prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Session[];
}

export function getSession(projectId: string, id: string): Session | null {
  const row = db()
    .prepare("SELECT * FROM sessions WHERE id = ? AND project_id = ?")
    .get(id, projectId);
  return (row as Session) ?? null;
}

export function getSessionByToken(token: string): Session | null {
  const row = db()
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  return (row as Session) ?? null;
}

export function getTaskBySession(projectId: string, sessionId: string, taskId: string): Task | null {
  const row = db()
    .prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ? AND session_id = ?")
    .get(taskId, projectId, sessionId);
  return (row as Task) ?? null;
}

export function listTasksBySession(projectId: string, sessionId: string): Task[] {
  const rows = db()
    .prepare("SELECT * FROM tasks WHERE project_id = ? AND session_id = ? ORDER BY updated_at DESC")
    .all(projectId, sessionId);
  return rows as Task[];
}

export function createSession(
  projectId: string,
  input: {
    id: string;
    agent_type: string;
    role: string;
    title: string;
    prompt: string;
    token?: string;
    agent_config_id?: string;
    task_id?: string | null;
  }
): Session {
  const t = now();
  db()
    .prepare(
      `INSERT INTO sessions (id, project_id, agent_type, role, title, prompt, status, current_step, output, created_at, started_at, token, agent_config_id, task_id)
       VALUES (?, ?, ?, ?, ?, ?, 'running', 'starting', '', ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      projectId,
      input.agent_type,
      input.role,
      input.title,
      input.prompt,
      t,
      t,
      input.token ?? null,
      input.agent_config_id ?? null,
      input.task_id ?? null
    );
  return getSession(projectId, input.id)!;
}

export function updateSession(
  projectId: string,
  id: string,
  patch: Partial<{
    status: string;
    current_step: string;
    output: string;
    exit_code: number | null;
    ended_at: number | null;
    result_summary: string | null;
    result_status: string | null;
    result_files: string | null;
    result_decisions: string | null;
    result_blockers: string | null;
    result_next_steps: string | null;
  }>
): Session | null {
  const existing = getSession(projectId, id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  db()
    .prepare(
      `UPDATE sessions SET status = ?, current_step = ?, output = ?, exit_code = ?, ended_at = ?,
       result_summary = ?, result_status = ?, result_files = ?, result_decisions = ?, result_blockers = ?, result_next_steps = ?
       WHERE id = ? AND project_id = ?`
    )
    .run(
      merged.status,
      merged.current_step,
      merged.output,
      merged.exit_code,
      merged.ended_at,
      merged.result_summary,
      merged.result_status,
      merged.result_files,
      merged.result_decisions,
      merged.result_blockers,
      merged.result_next_steps,
      id,
      projectId
    );
  return getSession(projectId, id);
}

export function appendSessionOutput(
  projectId: string,
  id: string,
  chunk: string
): void {
  db()
    .prepare(
      `UPDATE sessions SET output = output || ? WHERE id = ? AND project_id = ?`
    )
    .run(chunk, id, projectId);
}

/**
 * Atomically create a session and link it to a task.
 * Both operations succeed or both are rolled back.
 */
export function createSessionWithTask(
  projectId: string,
  sessionInput: {
    id: string;
    agent_type: string;
    role: string;
    title: string;
    prompt: string;
    token?: string;
    agent_config_id?: string;
  },
  taskId: string,
  agentType: string
): { session: Session; task: Task } {
  const t = now();
  const result = db().transaction(() => {
    // Create session with task_id set
    db()
      .prepare(
        `INSERT INTO sessions (id, project_id, agent_type, role, title, prompt, status, current_step, output, created_at, started_at, token, agent_config_id, task_id)
         VALUES (?, ?, ?, ?, ?, ?, 'running', 'starting', '', ?, ?, ?, ?, ?)`
      )
      .run(
        sessionInput.id,
        projectId,
        sessionInput.agent_type,
        sessionInput.role,
        sessionInput.title,
        sessionInput.prompt,
        t,
        t,
        sessionInput.token ?? null,
        sessionInput.agent_config_id ?? null,
        taskId
      );

    // Link task to session and set queued
    db()
      .prepare(
        `UPDATE tasks SET session_id = ?, assigned_agent = ?, status = 'queued', updated_at = ?
         WHERE id = ? AND project_id = ?`
      )
      .run(sessionInput.id, agentType, t, taskId, projectId);

    const session = getSession(projectId, sessionInput.id)!;
    const task = getTask(projectId, taskId)!;
    return { session, task };
  })();
  return result;
}

// --- Agent orchestration (project-scoped team config) ---

export type AgentRole = "master" | "worker" | "reviewer";

export type AgentConfig = {
  id: string;
  project_id: string;
  name: string;
  agent_type: string;
  role: AgentRole;
  created_at: number;
};

export type Orchestration = {
  master: AgentConfig | null;
  subagents: AgentConfig[];
};

export function listAgents(projectId: string): AgentConfig[] {
  return db()
    .prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY created_at ASC, id ASC")
    .all(projectId) as AgentConfig[];
}

export function getAgent(projectId: string, id: string): AgentConfig | null {
  const row = db()
    .prepare("SELECT * FROM agents WHERE id = ? AND project_id = ?")
    .get(id, projectId);
  return (row as AgentConfig) ?? null;
}

export function createAgent(
  projectId: string,
  input: { id: string; name: string; agent_type: string; role: AgentRole }
): AgentConfig {
  db()
    .prepare(
      `INSERT INTO agents (id, project_id, name, agent_type, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(input.id, projectId, input.name, input.agent_type, input.role, now());
  return getAgent(projectId, input.id)!;
}

export function renameAgent(projectId: string, id: string, name: string): AgentConfig | null {
  db().prepare("UPDATE agents SET name = ? WHERE id = ? AND project_id = ?").run(name, id, projectId);
  return getAgent(projectId, id);
}

export function deleteAgent(projectId: string, id: string): void {
  db()
    .prepare("UPDATE agent_config SET master_agent_id = NULL WHERE project_id = ? AND master_agent_id = ?")
    .run(projectId, id);
  db().prepare("DELETE FROM agents WHERE id = ? AND project_id = ?").run(id, projectId);
}

/** Set (or replace) the single master agent for a project. Never creates a duplicate master. */
export function setMasterAgent(
  projectId: string,
  input: { agent_type: string; name: string }
): AgentConfig {
  const existingMaster = db()
    .prepare("SELECT * FROM agents WHERE project_id = ? AND role = 'master'")
    .get(projectId) as AgentConfig | undefined;

  let master: AgentConfig;
  if (existingMaster) {
    db()
      .prepare("UPDATE agents SET agent_type = ?, name = ? WHERE id = ?")
      .run(input.agent_type, input.name, existingMaster.id);
    master = getAgent(projectId, existingMaster.id)!;
  } else {
    master = createAgent(projectId, {
      id: nanoid(14),
      name: input.name,
      agent_type: input.agent_type,
      role: "master",
    });
  }

  db()
    .prepare(
      `INSERT INTO agent_config (project_id, master_agent_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET master_agent_id = excluded.master_agent_id, updated_at = excluded.updated_at`
    )
    .run(projectId, master.id, now());
  return master;
}

/** Resolve the full team topology for a project. Master is authoritative even if config is stale. */
export function getOrchestration(projectId: string): Orchestration {
  const agents = listAgents(projectId);
  const cfg = db()
    .prepare("SELECT master_agent_id FROM agent_config WHERE project_id = ?")
    .get(projectId) as { master_agent_id: string | null } | undefined;

  const configured = cfg?.master_agent_id ? agents.find((a) => a.id === cfg.master_agent_id) : null;
  const master = configured ?? agents.find((a) => a.role === "master") ?? null;
  const subagents = agents.filter((a) => a.role !== "master" && a.id !== master?.id);
  return { master, subagents };
}

// --- Events ---

export function insertEvent(projectId: string, type: string, payload: unknown): EventRecord {
  const t = now();
  const info = db()
    .prepare(
      `INSERT INTO events (project_id, type, payload, created_at) VALUES (?, ?, ?, ?)`
    )
    .run(projectId, type, JSON.stringify(payload), t);
  return {
    id: Number(info.lastInsertRowid),
    project_id: projectId,
    type,
    payload: JSON.stringify(payload),
    created_at: t,
  } as EventRecord;
}

export function listEvents(projectId: string, limit = 200): EventRecord[] {
  return db()
    .prepare("SELECT * FROM events WHERE project_id = ? ORDER BY id DESC LIMIT ?")
    .all(projectId, limit)
    .reverse() as EventRecord[];
}

// --- Memories (Stage 4: agent-discovered knowledge) ---

export type MemoryScope = "project_shared" | "agent_private" | "task";
export type MemoryType = "fact" | "discovery" | "constraint" | "note";
export type MemorySource = "agent" | "user" | "task" | "decision";

export type Memory = {
  id: string;
  project_id: string;
  scope: MemoryScope;
  session_id: string | null;
  task_id: string | null;
  type: MemoryType;
  content: string;
  importance: number;
  source: MemorySource;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
};

export function getMemory(projectId: string, id: string): Memory | null {
  const row = db()
    .prepare("SELECT * FROM memories WHERE id = ? AND project_id = ?")
    .get(id, projectId);
  return (row as Memory) ?? null;
}

export function createMemory(
  projectId: string,
  input: {
    id: string;
    scope: MemoryScope;
    type: MemoryType;
    content: string;
    importance?: number;
    source: MemorySource;
    session_id?: string | null;
    task_id?: string | null;
  }
): Memory {
  const t = now();
  db()
    .prepare(
      `INSERT INTO memories (id, project_id, scope, session_id, task_id, type, content, importance, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      projectId,
      input.scope,
      input.session_id ?? null,
      input.task_id ?? null,
      input.type,
      input.content,
      input.importance ?? 1,
      input.source,
      t,
      t
    );
  return getMemory(projectId, input.id)!;
}

export function listMemories(
  projectId: string,
  filters?: {
    scope?: MemoryScope;
    task_id?: string;
    session_id?: string;
    includeArchived?: boolean;
  }
): Memory[] {
  let sql = "SELECT * FROM memories WHERE project_id = ?";
  const params: unknown[] = [projectId];

  if (filters?.scope) {
    sql += " AND scope = ?";
    params.push(filters.scope);
  }
  if (filters?.task_id) {
    sql += " AND task_id = ?";
    params.push(filters.task_id);
  }
  if (filters?.session_id) {
    sql += " AND session_id = ?";
    params.push(filters.session_id);
  }
  if (!filters?.includeArchived) {
    sql += " AND archived_at IS NULL";
  }

  sql += " ORDER BY importance DESC, created_at DESC";
  return db().prepare(sql).all(...params) as Memory[];
}

export function updateMemory(
  projectId: string,
  id: string,
  patch: Partial<{
    content: string;
    type: MemoryType;
    importance: number;
  }>
): Memory | null {
  const existing = getMemory(projectId, id);
  if (!existing) return null;
  if (existing.archived_at !== null) return null;
  const merged = { ...existing, ...patch, updated_at: now() };
  db()
    .prepare(
      `UPDATE memories SET content = ?, type = ?, importance = ?, updated_at = ?
       WHERE id = ? AND project_id = ?`
    )
    .run(merged.content, merged.type, merged.importance, merged.updated_at, id, projectId);
  return getMemory(projectId, id);
}

export function archiveMemory(projectId: string, id: string): Memory | null {
  const existing = getMemory(projectId, id);
  if (!existing) return null;
  if (existing.archived_at !== null) return existing;
  db()
    .prepare("UPDATE memories SET archived_at = ?, updated_at = ? WHERE id = ? AND project_id = ?")
    .run(now(), now(), id, projectId);
  return getMemory(projectId, id);
}

// --- Handoffs (Stage 5B: Agent-to-Agent Structured Handoffs) ---

export type HandoffStatus = "pending" | "accepted" | "completed" | "cancelled";

export type HandoffRecord = {
  id: string;
  project_id: string;
  source_session_id: string;
  source_task_id: string;
  target_task_id: string;
  summary: string;
  completed_work: string;
  changed_files: string;
  decisions: string;
  blockers: string;
  next_steps: string;
  status: HandoffStatus;
  created_at: number;
  consumed_at: number | null;
};

export type Handoff = {
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
  status: HandoffStatus;
  created_at: number;
  consumed_at: number | null;
};

export function deserializeHandoff(row: HandoffRecord): Handoff {
  let changed_files: string[] = [];
  let decisions: string[] = [];
  let blockers: string[] = [];
  let next_steps: string[] = [];

  try { changed_files = JSON.parse(row.changed_files); } catch { /* ignore */ }
  try { decisions = JSON.parse(row.decisions); } catch { /* ignore */ }
  try { blockers = JSON.parse(row.blockers); } catch { /* ignore */ }
  try { next_steps = JSON.parse(row.next_steps); } catch { /* ignore */ }

  return {
    ...row,
    changed_files: Array.isArray(changed_files) ? changed_files : [],
    decisions: Array.isArray(decisions) ? decisions : [],
    blockers: Array.isArray(blockers) ? blockers : [],
    next_steps: Array.isArray(next_steps) ? next_steps : [],
  };
}

export function getHandoff(projectId: string, id: string): Handoff | null {
  const row = db()
    .prepare("SELECT * FROM handoffs WHERE id = ? AND project_id = ?")
    .get(id, projectId) as HandoffRecord | undefined;
  return row ? deserializeHandoff(row) : null;
}

export function createHandoff(
  projectId: string,
  input: {
    id: string;
    source_session_id: string;
    source_task_id: string;
    target_task_id: string;
    summary: string;
    completed_work: string;
    changed_files?: string[];
    decisions?: string[];
    blockers?: string[];
    next_steps?: string[];
    status?: HandoffStatus;
  }
): Handoff {
  const t = now();
  const changedFilesJson = JSON.stringify(input.changed_files ?? []);
  const decisionsJson = JSON.stringify(input.decisions ?? []);
  const blockersJson = JSON.stringify(input.blockers ?? []);
  const nextStepsJson = JSON.stringify(input.next_steps ?? []);

  db()
    .prepare(
      `INSERT INTO handoffs (
        id, project_id, source_session_id, source_task_id, target_task_id,
        summary, completed_work, changed_files, decisions, blockers, next_steps,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      projectId,
      input.source_session_id,
      input.source_task_id,
      input.target_task_id,
      input.summary,
      input.completed_work,
      changedFilesJson,
      decisionsJson,
      blockersJson,
      nextStepsJson,
      input.status ?? "pending",
      t
    );

  return getHandoff(projectId, input.id)!;
}

export function listHandoffs(
  projectId: string,
  filters?: {
    target_task_id?: string;
    source_task_id?: string;
    task_id?: string;
    status?: HandoffStatus;
  }
): Handoff[] {
  let sql = "SELECT * FROM handoffs WHERE project_id = ?";
  const params: unknown[] = [projectId];

  if (filters?.target_task_id) {
    sql += " AND target_task_id = ?";
    params.push(filters.target_task_id);
  }
  if (filters?.source_task_id) {
    sql += " AND source_task_id = ?";
    params.push(filters.source_task_id);
  }
  if (filters?.task_id) {
    sql += " AND (target_task_id = ? OR source_task_id = ?)";
    params.push(filters.task_id, filters.task_id);
  }
  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }

  sql += " ORDER BY created_at DESC";
  const rows = db().prepare(sql).all(...params) as HandoffRecord[];
  return rows.map(deserializeHandoff);
}

export function updateHandoffStatus(
  projectId: string,
  id: string,
  status: HandoffStatus,
  consumedAt?: number | null
): Handoff | null {
  const existing = getHandoff(projectId, id);
  if (!existing) return null;

  const t = consumedAt !== undefined ? consumedAt : (status === "accepted" ? now() : existing.consumed_at);

  db()
    .prepare("UPDATE handoffs SET status = ?, consumed_at = ? WHERE id = ? AND project_id = ?")
    .run(status, t, id, projectId);

  return getHandoff(projectId, id);
}