/**
 * Stage 3: Worktree management.
 *
 * Handles path derivation, validation, provisioning, cleanup,
 * and reconciliation for Git worktrees tied to tasks.
 */

import path from "node:path";
import fs from "node:fs";
import { getTask, updateTask, getProject, type Task } from "./db";
import {
  worktreeAdd,
  worktreeRemove,
  isGitWorktree,
  nextWorktreeBranch,
  getCurrentBranch,
  getRepoInfo,
  diffWorkingTree,
  type GitDiffFile,
} from "./git";
import { publish } from "./events";

// --- Concurrency lock ---
// Prevents two concurrent provisioning requests for the same task from racing.
const provisionLocks = new Map<string, Promise<Task>>();

// --- Worktree transition validation ---

const VALID_WORKTREE_TRANSITIONS: Record<string, string[]> = {
  none: ["provisioning"],
  provisioning: ["ready", "none"], // none = rollback on failure
  ready: ["retained"],
  retained: ["removed"],
  removed: ["provisioning"], // retry
};

export function validateWorktreeTransition(current: string, next: string): string | null {
  if (current === next) return null;
  const allowed = VALID_WORKTREE_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    return `invalid worktree transition: ${current} → ${next}`;
  }
  return null;
}

// --- Path derivation ---

/** Base directory for all worktrees of a project. Sibling of the repo. */
export function worktreeBaseDir(repoPath: string, projectId: string): string {
  const parent = path.dirname(path.resolve(repoPath));
  return path.join(parent, ".gridmind-worktrees", projectId);
}

/** Unique worktree path for a task. */
export function worktreeDirPath(repoPath: string, projectId: string, taskId: string): string {
  return path.join(worktreeBaseDir(repoPath, projectId), taskId);
}

// --- Path validation (security) ---

/**
 * Validate that a candidate worktree path is safe:
 * - Under the expected base directory
 * - Not inside the main repo
 * - Not a root/system path
 */
export function validateWorktreePath(
  repoPath: string,
  projectId: string,
  candidatePath: string
): boolean {
  const resolved = path.resolve(candidatePath);
  const expectedBase = path.resolve(worktreeBaseDir(repoPath, projectId));
  const resolvedRepo = path.resolve(repoPath);

  // Must be under the expected base directory
  if (!resolved.startsWith(expectedBase + path.sep) && resolved !== expectedBase) {
    return false;
  }
  // Must not be the repo itself or inside it
  if (resolved === resolvedRepo || resolved.startsWith(resolvedRepo + path.sep)) {
    return false;
  }
  // Must not be a root path
  if (resolved === "/" || resolved === path.sep) {
    return false;
  }
  return true;
}

// --- Provisioning ---

/**
 * Provision a worktree for a task.
 *
 * Steps:
 * 1. Validate task exists and worktree transition is valid
 * 2. Set worktree_status → provisioning (acts as a lock)
 * 3. Resolve branch name
 * 4. git worktree add
 * 5. Set worktree_status → ready
 *
 * On failure, rolls back to worktree_status → none.
 *
 * Returns the updated task.
 */
export async function provisionWorktree(
  projectId: string,
  taskId: string
): Promise<Task> {
  const project = getProject(projectId);
  if (!project) throw new Error("project not found");

  const task = getTask(projectId, taskId);
  if (!task) throw new Error("task not found");

  // If worktree already ready, return as-is
  if (task.worktree_status === "ready") return task;
  // If retained, it's from a previous run — cannot re-provision without cleanup
  if (task.worktree_status === "retained") {
    throw new Error("worktree is retained from previous run — clean up before retry");
  }

  // Concurrency: wait for any in-flight provisioning of this same task
  const lockKey = projectId + ":" + taskId;
  const existing = provisionLocks.get(lockKey);
  if (existing) {
    try {
      return await existing;
    } catch {
      // If the in-flight provisioning failed, we can try again
    }
  }

  const promise = provisionWorktreeInner(projectId, taskId, project, task);
  provisionLocks.set(lockKey, promise);
  try {
    return await promise;
  } finally {
    provisionLocks.delete(lockKey);
  }
}

async function provisionWorktreeInner(
  projectId: string,
  taskId: string,
  project: NonNullable<ReturnType<typeof getProject>>,
  task: Task
): Promise<Task> {

  // Validate transition
  const effectiveStatus = task.worktree_status || "none";
  const transErr = validateWorktreeTransition(effectiveStatus, "provisioning");
  if (transErr) throw new Error(transErr);

  const repoPath = project.repo_path;
  const wtPath = worktreeDirPath(repoPath, projectId, taskId);

  // Security validation
  if (!validateWorktreePath(repoPath, projectId, wtPath)) {
    throw new Error(`invalid worktree path: ${wtPath}`);
  }

  // Resolve branch
  const branchName = await nextWorktreeBranch(repoPath, taskId);
  const baseBranch = await getCurrentBranch(repoPath) || "main";

  // Lock: set provisioning
  updateTask(projectId, taskId, {
    worktree_status: "provisioning",
    worktree_path: wtPath,
    worktree_branch: branchName,
    worktree_base_branch: baseBranch,
  });

  try {
    // Handle case where path already exists
    if (fs.existsSync(wtPath)) {
      const valid = await isGitWorktree(wtPath);
      if (valid) {
        // Reuse existing worktree from a previous crashed attempt
        updateTask(projectId, taskId, { worktree_status: "ready" });
        publish(projectId, "worktree:created", {
          taskId,
          branch: branchName,
          worktreePath: wtPath,
          baseBranch,
          reused: true,
        });
        return getTask(projectId, taskId)!;
      }
      // Not a valid worktree — remove and recreate
      fs.rmSync(wtPath, { recursive: true });
    }

    await worktreeAdd(repoPath, wtPath, branchName, baseBranch);

    // Success: set ready
    updateTask(projectId, taskId, { worktree_status: "ready" });

    publish(projectId, "worktree:created", {
      taskId,
      branch: branchName,
      worktreePath: wtPath,
      baseBranch,
    });

    return getTask(projectId, taskId)!;
  } catch (err) {
    // Rollback
    updateTask(projectId, taskId, {
      worktree_status: "none",
      worktree_path: null,
      worktree_branch: null,
      worktree_base_branch: null,
    });

    publish(projectId, "worktree:error", {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });

    throw err;
  }
}

// --- Cleanup ---

/**
 * Remove a worktree for a task.
 * Only allowed from "retained" status (or force from any non-none state).
 * Dirty worktrees require force=true.
 */
export async function removeWorktree(
  projectId: string,
  taskId: string,
  force = false
): Promise<Task> {
  const project = getProject(projectId);
  if (!project) throw new Error("project not found");

  const task = getTask(projectId, taskId);
  if (!task) throw new Error("task not found");

  if (task.worktree_status === "none" || task.worktree_status === "removed") {
    throw new Error(`no worktree to remove (status: ${task.worktree_status})`);
  }

  // Normal cleanup only from retained
  if (!force) {
    const transErr = validateWorktreeTransition(task.worktree_status, "removed");
    if (transErr) throw new Error(transErr);
  }

  const repoPath = project.repo_path;
  const wtPath = task.worktree_path;

  // Safety: validate path before any deletion
  if (wtPath && !validateWorktreePath(repoPath, projectId, wtPath)) {
    throw new Error(`refusing to remove invalid path: ${wtPath}`);
  }

  // Safety: never delete the main repo
  if (wtPath && path.resolve(wtPath) === path.resolve(repoPath)) {
    throw new Error("refusing to remove the main repository");
  }

  try {
    if (wtPath && fs.existsSync(wtPath)) {
      await worktreeRemove(repoPath, wtPath, force);
    }
  } catch (err) {
    // If git worktree remove fails (e.g. dirty), only proceed if force
    if (!force) throw err;
    // Force: remove directory directly as fallback
    if (wtPath && fs.existsSync(wtPath)) {
      fs.rmSync(wtPath, { recursive: true });
    }
  }

  updateTask(projectId, taskId, { worktree_status: "removed" });

  publish(projectId, "worktree:removed", {
    taskId,
    branch: task.worktree_branch,
  });

  return getTask(projectId, taskId)!;
}

// --- Reconciliation ---

/**
 * Reconcile DB state with filesystem reality.
 * Call lazily when accessing a worktree, or on startup.
 */
export async function reconcileWorktree(
  projectId: string,
  taskId: string
): Promise<void> {
  const task = getTask(projectId, taskId);
  if (!task || !task.worktree_path) return;

  const exists = fs.existsSync(task.worktree_path);
  const dbStatus = task.worktree_status;

  if (dbStatus === "provisioning" && exists) {
    const valid = await isGitWorktree(task.worktree_path);
    if (valid) {
      updateTask(projectId, taskId, { worktree_status: "ready" });
    } else {
      updateTask(projectId, taskId, {
        worktree_status: "none",
        worktree_path: null,
        worktree_branch: null,
        worktree_base_branch: null,
      });
    }
  } else if (dbStatus === "provisioning" && !exists) {
    updateTask(projectId, taskId, {
      worktree_status: "none",
      worktree_path: null,
      worktree_branch: null,
      worktree_base_branch: null,
    });
  } else if ((dbStatus === "ready" || dbStatus === "retained") && !exists) {
    updateTask(projectId, taskId, { worktree_status: "removed" });
  }
}

// --- Inspection ---

/** Get worktree Git info for a task. */
export async function inspectWorktree(
  projectId: string,
  taskId: string
): Promise<{
  task: Task;
  git: {
    branch: string;
    dirty: boolean;
    filesChanged: number;
    diff: GitDiffFile[];
  };
} | null> {
  const task = getTask(projectId, taskId);
  if (!task || !task.worktree_path) return null;

  // Reconcile first
  await reconcileWorktree(projectId, taskId);
  const updated = getTask(projectId, taskId)!;

  if (updated.worktree_status === "removed" || updated.worktree_status === "none") {
    return null;
  }

  const info = await getRepoInfo(updated.worktree_path!);
  const diff = await diffWorkingTree(updated.worktree_path!);

  return {
    task: updated,
    git: {
      branch: info.branch,
      dirty: info.dirty,
      filesChanged: info.filesChanged,
      diff,
    },
  };
}
