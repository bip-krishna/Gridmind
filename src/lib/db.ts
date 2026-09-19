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