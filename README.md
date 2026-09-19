# GridMind 🧠⚡

> **Autonomous AI Agent Control & Coordination Plane for Software Engineering**  
> Connects **Tasks + Git Worktrees + AI Agents + Structured Handoffs + MCP + GitHub PRs** into one coherent developer workflow.

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Step-by-Step Installation](#step-by-step-installation)
- [Step-by-Step Usage Guide](#step-by-step-usage-guide)
  - [1. Create a Project](#1-create-a-project)
  - [2. Define Developer Tasks](#2-define-developer-tasks)
  - [3. Provision Worktrees & Launch Agents](#3-provision-worktrees--launch-agents)
  - [4. Connect Agents via GridMind MCP](#4-connect-agents-via-gridmind-mcp)
  - [5. Agent A: Code, Diff & Commit](#5-agent-a-code-diff--commit)
  - [6. Agent A: Create Structured Handoff with Commit Reference](#6-agent-a-create-structured-handoff-with-commit-reference)
  - [7. Agent B: Inspect Commit, Accept Handoff & Continue Work](#7-agent-b-inspect-commit-accept-handoff--continue-work)
  - [8. Create GitHub Pull Request](#8-create-github-pull-request)
  - [9. Visualize the Live Coordination Chain](#9-visualize-the-live-coordination-chain)
- [Running the Live End-to-End Demo](#running-the-live-end-to-end-demo)
- [Connecting External MCP Clients (Cursor, Claude Desktop, OpenCode)](#connecting-external-mcp-clients-cursor-claude-desktop-opencode)
- [MCP Tools Reference](#mcp-tools-reference)
- [Running Tests](#running-tests)
- [Architecture & Security Invariants](#architecture--security-invariants)

---

## Overview

GridMind is not another code editor or chat interface. **GridMind is the coordination and control plane** that orchestrates autonomous AI coding agents (OpenCode, Codex, Claude Code, Cursor, etc.) working across complex multi-step repositories.

Agents do **not** need to work inside the GridMind UI. Instead:
1. GridMind gives each task an **isolated Git worktree** so agents never overwrite or conflict with each other or your working branch.
2. Agents connect via the **Model Context Protocol (MCP)** to inspect status, view bounded diffs, commit changes, search project memory, and pass structured handoffs.
3. GridMind records every commit, decision, and handoff, and visualizes the complete end-to-end delivery chain up to the final GitHub Pull Request.

---

## How It Works

```
OpenCode / Codex / Claude Code
              ↓
     GridMind MCP Bridge
              ↓
┌───────────────────────────────┐
│ Task A Worktree (Isolated)    │
│ Agent A modifies & commits    │
└──────────────┬────────────────┘
               ↓ (Commit Ref + Decisions)
    Structured Agent Handoff
               ↓
┌───────────────────────────────┐
│ Task B Worktree (Isolated)    │
│ Agent B inspects Commit A     │
│ Agent B builds frontend & commits │
└──────────────┬────────────────┘
               ↓
     GitHub Pull Request (PR)
```

---

## Prerequisites

Ensure you have the following installed on your system:

- **Node.js**: Version `18.0.0` or higher (`v20+` recommended). Check with `node -v`.
- **npm**: Version `9.0.0` or higher. Check with `npm -v`.
- **Git**: Version `2.20+` (worktree support required). Check with `git --version`.
- *(Optional)* **GitHub Personal Access Token**: A fine-grained token with `repo` (issues + pull requests read/write) permissions if you plan to synchronize GitHub issues or create PRs.

---

## Step-by-Step Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/your-username/GridMind.git
cd GridMind
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment Variables

Copy the example environment file to `.env.local`:

```bash
cp .env.example .env.local
```

Open `.env.local` in your editor and configure your secrets:

```env
# Required only if using GitHub PR creation or GitHub Issues import
GITHUB_TOKEN=ghp_yourPersonalAccessTokenHere

# Optional: Default repository (owner/repo)
# GITHUB_DEFAULT_REPO=your-org/your-repo
```

> **Note:** If you don't have a GitHub token right now, GridMind will operate normally in local-only Git mode and report `GITHUB: NOT CONFIGURED` gracefully without breaking.

### Step 4: Build MCP Server & Next.js

Compile the standalone Model Context Protocol bundle (`dist/mcp/cli.mjs`) and the Next.js web application:

```bash
npm run build
```

*(You can also build just the MCP bundle during development using `npm run build:mcp`)*

### Step 5: Start the Local Development Server

```bash
npm run dev
```

The server will start at:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## Step-by-Step Usage Guide

### 1. Create a Project

1. Open **[http://localhost:3000](http://localhost:3000)** in your browser.
2. Click **"+ New Project"**.
3. Fill in:
   - **Project Name**: e.g., `Autonomous Auth & Frontend`
   - **Local Git Repo Path**: Absolute path to an initialized Git repository (e.g. `/Users/yourname/projects/my-app`).
   - **GitHub Repo** *(Optional)*: `owner/repo` (e.g. `gridmind-org/auth-service`).
4. Click **Create Project**.

### 2. Define Developer Tasks

Inside your project dashboard, navigate to the **Tasks** panel:
- **Task A**:
  - Title: `Implement authentication backend`
  - Assigned Agent: `opencode`
- **Task B**:
  - Title: `Build frontend login UI`
  - Assigned Agent: `opencode`

### 3. Provision Worktrees & Launch Agents

Click **"Provision Worktree"** for each task.
- GridMind automatically creates a sandboxed Git worktree under `.gridmind-worktrees/<project_id>/<task_id>` on an isolated branch (e.g. `gridmind/<task_id>/1`).
- The agent will execute strictly in this isolated directory, keeping your main branch clean and protected.

### 4. Connect Agents via GridMind MCP

Each agent session receives a scoped session token (`GRIDMIND_TOKEN`). The agent communicates with GridMind via standard standard-input/output (stdio) MCP:

```bash
GRIDMIND_API="http://localhost:3000" \
GRIDMIND_TOKEN="<agent_session_token>" \
node dist/mcp/cli.mjs
```

### 5. Agent A: Code, Diff & Commit

Agent A operates inside its task worktree using GridMind's Git MCP tools:

1. **Check Status**:
   ```json
   { "tool": "gridmind_git_status" }
   ```
2. **Write Code**: Agent creates/modifies files (e.g. `src/auth.ts`).
3. **Inspect Diff**:
   ```json
   { "tool": "gridmind_git_diff" }
   ```
   *(Output is safely bounded to 30,000 characters with explicit truncation notices to prevent LLM context explosion).*
4. **Commit Changes**:
   ```json
   {
     "tool": "gridmind_git_commit",
     "arguments": {
       "message": "feat(auth): implement JWT verification and middleware"
     }
   }
   ```
   *GridMind captures the commit SHA, updates the task's `latest_commit`, and publishes a real-time `git:commit` SSE event.*

### 6. Agent A: Create Structured Handoff with Commit Reference

Once Agent A finishes its work, it creates a structured handoff targeted at Task B:

```json
{
  "tool": "gridmind_create_handoff",
  "arguments": {
    "target_task_id": "<task_b_id>",
    "summary": "Backend JWT authentication completed and committed.",
    "completed_work": "Implemented verifyToken() and auth middleware in src/auth.ts.",
    "changed_files": ["src/auth.ts"],
    "decisions": ["Tokens passed as HTTP-only Bearer headers"],
    "blockers": [],
    "next_steps": ["Import verifyToken in LoginForm component", "Handle form submit"],
    "commit_sha": "<agent_a_commit_sha>",
    "branch": "gridmind/<task_a_id>/1"
  }
}
```

### 7. Agent B: Inspect Commit, Accept Handoff & Continue Work

Agent B begins Task B:
1. **Retrieve Incoming Handoffs**:
   ```json
   { "tool": "gridmind_get_handoffs" }
   ```
2. **Inspect Agent A's Referenced Commit**:
   ```json
   {
     "tool": "gridmind_git_diff",
     "arguments": { "commit": "<agent_a_commit_sha>" }
   }
   ```
   *Agent B can directly inspect the exact changes made by Agent A without bloating the initial handoff message.*
3. **Accept Handoff**:
   ```json
   {
     "tool": "gridmind_accept_handoff",
     "arguments": { "handoff_id": "<handoff_id>" }
   }
   ```
4. **Build Code & Commit**: Agent B creates `src/login.tsx`, tests it, and commits:
   ```json
   {
     "tool": "gridmind_git_commit",
     "arguments": {
       "message": "feat(login): implement LoginForm using backend auth"
     }
   }
   ```

### 8. Create GitHub Pull Request

When the feature is ready, the agent or operator can trigger PR creation via MCP:

```json
{
  "tool": "gridmind_github_create_pr",
  "arguments": {
    "title": "feat(auth): full authentication backend and login UI",
    "body": "Coordinated delivery across Task A and Task B.\\n\\n- Auth backend: Commit abc1234\\n- Frontend UI: Commit def5678",
    "head_branch": "gridmind/<task_b_id>/1",
    "base_branch": "main"
  }
}
```

### 9. Visualize the Live Coordination Chain

In the GridMind UI (**Tasks Panel**), view the interactive visual chain:

```
Task A: "Implement authentication"
  │
  ├── Agent A (opencode)
  ├── Worktree: /path/to/.gridmind-worktrees/...
  ├── Commit A: 4617cfb ("feat(auth): implement JWT...")
  │
  └── Handoff [ID: -ZZf1jouq] ────────────────────────┐
      Status: accepted                                │
      Commit Ref: 4617cfb                             │
                                                      ↓
                                           Task B: "Build frontend login"
                                             │
                                             ├── Agent B (opencode)
                                             ├── Worktree: /path/to/.gridmind-worktrees/...
                                             ├── Commit B: 4fc3574 ("feat(login): ...")
                                             │
                                             ↓
                                           GitHub PR #42 (Open)
```

---

## Running the Live End-to-End Demo

GridMind includes a fully automated end-to-end demonstration script that runs through the complete 15-step multi-agent workflow:

```bash
# Make sure the dev server is running in one terminal:
npm run dev

# In a second terminal, run the demo:
node scripts/stage5c-demo.mjs
```

**What the demo does:**
1. Initializes an isolated temporary Git repository.
2. Creates Project, Task A, and Task B in GridMind.
3. Provisions isolated worktrees for both tasks.
4. Spawns Agent A session and connects via GridMind MCP.
5. Writes code, checks status, diffs, and commits via MCP.
6. Emits structured handoff with commit SHA reference to Task B.
7. Spawns Agent B session, retrieves handoff, and inspects Agent A's commit.
8. Accepts handoff, writes frontend code, and commits via MCP.
9. Evaluates GitHub PR integration.
10. Prints the coordination chain visualization.

---

## Connecting External MCP Clients (Cursor, Claude Desktop, OpenCode)

You can add GridMind's MCP server to any MCP-compliant client.

### Claude Desktop Configuration

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gridmind": {
      "command": "node",
      "args": ["/absolute/path/to/GridMind/dist/mcp/cli.mjs"],
      "env": {
        "GRIDMIND_API": "http://localhost:3000",
        "GRIDMIND_TOKEN": "<YOUR_SESSION_TOKEN>"
      }
    }
  }
}
```

### Cursor Configuration

In Cursor Settings → **Features** → **MCP Servers** → **Add New MCP Server**:
- **Name**: `gridmind`
- **Type**: `command`
- **Command**: `node /absolute/path/to/GridMind/dist/mcp/cli.mjs`
- **Environment Variables**:
  - `GRIDMIND_API`: `http://localhost:3000`
  - `GRIDMIND_TOKEN`: `<YOUR_SESSION_TOKEN>`

---

## MCP Tools Reference

GridMind provides **19 MCP tools** grouped into clean functional domains:

### 1. Git Tools (Worktree Scoped)
| Tool | Description |
|---|---|
| `gridmind_git_status` | Returns clean/dirty state, branch, changed files, untracked files, ahead/behind count for the authenticated task's worktree. |
| `gridmind_git_diff` | Returns bounded diff (unstaged, staged, or against a commit SHA). Rejects path traversal (`../`). |
| `gridmind_git_commit` | Commits changes in the authenticated worktree. Returns commit SHA and updates task record. |
| `gridmind_git_branches` | Lists branches in the project repository (bounded to 50). |
| `gridmind_git_log` | Returns recent bounded commits (default 10, max 50) with commit lookup. |

### 2. GitHub Tools
| Tool | Description |
|---|---|
| `gridmind_github_issues` | Lists open issues for the project-configured GitHub repository. |
| `gridmind_github_create_pr` | Creates a Pull Request using the project-configured repository. Validates head/base branches. |
| `gridmind_github_issue_to_task` | Converts a GitHub issue into a GridMind task with project isolation. |

### 3. Handoff Tools
| Tool | Description |
|---|---|
| `gridmind_create_handoff` | Creates a structured handoff (completed work, changed files, decisions, blockers, next steps, commit SHA, branch). |
| `gridmind_get_handoffs` | Retrieves handoffs targeted at or created by the agent's task. |
| `gridmind_accept_handoff` | Accepts an incoming handoff idempotently. |

### 4. Memory & Context Tools
| Tool | Description |
|---|---|
| `gridmind_get_session_context` | Inspects current agent session, task assignment, and role. |
| `gridmind_get_context` | Retrieves project context brief, task details, and incoming handoffs within a strict token budget. |
| `gridmind_search_memory` | Searches project-shared and task-scoped memories. |
| `gridmind_record_memory` | Records memory (`project_shared`, `task_scoped`, or `agent_private`). |
| `gridmind_get_task` | Inspects the assigned task details. |
| `gridmind_update_task_status` | Updates task status (`in_progress`, `blocked`, `done`, `failed`). |
| `gridmind_record_decision` | Records an architectural decision in the project log. |
| `gridmind_emit_event` | Emits custom project events to the live SSE stream. |

---

## Running Tests

GridMind is backed by a comprehensive regression and security test suite:

```bash
# Run all 11 test suites (671 tests):
node tests/agent-api.mjs && \
node tests/stage2-lifecycle.mjs && \
node tests/audit-regression.mjs && \
node tests/stage3-worktree.mjs && \
node tests/stage4-memory.mjs && \
node tests/stage4-retrieval.mjs && \
node tests/stage4-security.mjs && \
node tests/stage4-task-auth.mjs && \
node tests/mcp-stage5a.mjs && \
node tests/stage5b-handoffs.mjs && \
node tests/stage5c-git-github.mjs
```

### Running Static Checks & Linting

```bash
# TypeScript typecheck
npx tsc --noEmit

# ESLint
npm run lint

# Production build test
npm run build
```

---

## Architecture & Security Invariants

GridMind enforces strict security boundaries at the API and database levels:

1. **Worktree Path Derivation**:
   - Workers can **never** pass arbitrary filesystem paths.
   - The worktree is derived strictly on the server: `session.task_id → task.worktree_path`.
   - Attempts to access another task's worktree return `403 Forbidden`.
2. **Path Traversal Protection**:
   - All file arguments in `git_diff` are verified with canonical path checking. Paths containing `../` or escaping the worktree root return `400 Bad Request`.
3. **Repository Injection Protection**:
   - Agents cannot supply arbitrary GitHub owner/repo names. All GitHub operations bind strictly to the project's configured repository (`project.github_repo`).
4. **Zero Credential Leaks**:
   - `GITHUB_TOKEN`, session auth tokens, and private passwords are never returned in MCP outputs or emitted in SSE event logs.
5. **Token Budgeting**:
   - Diffs, logs, memory briefs, and handoffs are bounded to fixed size ceilings to protect LLMs from context window exhaustion.

---

## License

MIT
