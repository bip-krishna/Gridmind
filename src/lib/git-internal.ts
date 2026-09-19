/**
 * Stage 5C: Internal Git & Worktree resolution helpers.
 *
 * Enforces task worktree isolation, path traversal prevention,
 * and command bounds for internal Git API endpoints.
 */

import path from "node:path";
import fs from "node:fs";
import { execAsync, GitError } from "./git";
import { getTask, getProject, type Session, type Task } from "./db";

export type ResolvedWorktree =
  | { ok: true; worktreePath: string; task: Task | null; projectId: string }
  | { ok: false; error: string; status: number };

/**
 * Resolves and validates the worktree path for an authenticated session.
 *
 * Workers can ONLY access their own assigned task's worktree.
 * Path cannot be supplied by the client; it is derived exclusively from the database.
 */
export function resolveSessionWorktree(
  session: Session,
  requestedTaskId?: string
): ResolvedWorktree {
  const projectId = session.project_id;
  const project = getProject(projectId);
  if (!project) {
    return { ok: false, error: "project not found", status: 404 };
  }

  // Worker cannot request another task
  if (session.role !== "master") {
    if (requestedTaskId && requestedTaskId !== session.task_id) {
      return {
        ok: false,
        error: "forbidden — worker cannot access another task worktree",
        status: 403,
      };
    }
  }

  const effectiveTaskId = (session.role === "master" && requestedTaskId)
    ? requestedTaskId
    : session.task_id;

  if (!effectiveTaskId) {
    // Master without task specified can inspect the main repo path
    if (session.role === "master" && project.repo_path && fs.existsSync(project.repo_path)) {
      return {
        ok: true,
        worktreePath: path.resolve(project.repo_path),
        task: null,
        projectId,
      };
    }
    return {
      ok: false,
      error: "session has no assigned task — worktree not available",
      status: 400,
    };
  }

  const task = getTask(projectId, effectiveTaskId);
  if (!task || task.project_id !== projectId) {
    return { ok: false, error: "task not found in project", status: 404 };
  }

  if (session.role !== "master" && task.id !== session.task_id) {
    return {
      ok: false,
      error: "forbidden — worker cannot access another task worktree",
      status: 403,
    };
  }

  if (!task.worktree_path) {
    return {
      ok: false,
      error: `task ${effectiveTaskId} has no provisioned worktree`,
      status: 400,
    };
  }

  const resolved = path.resolve(task.worktree_path);
  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      error: `worktree directory does not exist on disk: ${task.worktree_path}`,
      status: 404,
    };
  }

  return { ok: true, worktreePath: resolved, task, projectId };
}

/**
 * Checks if a relative path safely resolves within baseDir without traversal.
 */
export function isPathSafe(baseDir: string, candidateRelativePath: string): boolean {
  if (candidateRelativePath.includes("\0")) return false;
  if (candidateRelativePath.includes("../") || candidateRelativePath.includes("..\\")) {
    return false;
  }
  const normalized = path.normalize(candidateRelativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return false;
  }
  const resolved = path.resolve(baseDir, normalized);
  const resolvedBase = path.resolve(baseDir);
  return resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep);
}

/**
 * Safely runs a git command within the specified directory.
 */
export async function runGitSafe(
  cwd: string,
  args: string[],
  options?: { allowFail?: boolean; maxBuffer?: number }
): Promise<string> {
  const cmd = `git ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`;
  try {
    const { stdout } = await execAsync(cmd, {
      cwd,
      maxBuffer: options?.maxBuffer ?? 16 * 1024 * 1024,
      encoding: "utf8",
    });
    return stdout;
  } catch (err: unknown) {
    if (options?.allowFail) {
      const e = err as { stdout?: string; stderr?: string };
      return e.stdout ?? e.stderr ?? "";
    }
    const e = err as { stderr?: string; stdout?: string };
    throw new GitError(cmd, e.stderr ?? String(err));
  }
}
