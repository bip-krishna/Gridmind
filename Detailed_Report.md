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
- [Configuring & Using External MCP Clients (OpenCode, Claude Desktop, Cursor, Hermes)](#configuring--using-external-mcp-clients-opencode-claude-desktop-cursor-hermes)
  - [1. Build the MCP Server](#1-build-the-mcp-server)
  - [2. Understanding Authentication Tokens (Master vs. Worker)](#2-understanding-authentication-tokens-master-vs-worker)
  - [3. OpenCode Configuration (`opencode.jsonc`)](#3-opencode-configuration-opencodejsonc)
  - [4. Claude Desktop Configuration](#4-claude-desktop-configuration)
  - [5. Cursor Configuration](#5-cursor-configuration)
  - [6. Hermes & Custom CLI Agents](#6-hermes--custom-cli-agents)
- [How Context & Project Memory Work via MCP](#how-context--project-memory-work-via-mcp)
  - [Automatic Context Ingestion](#automatic-context-ingestion)
  - [Explicit Context & Memory Tools](#explicit-context--memory-tools)
  - [How Context is Surfaced in the Web UI](#how-context-is-surfaced-in-the-web-ui)
- [MCP Tools Reference (20 Tools)](#mcp-tools-reference-20-tools)
- [MCP Troubleshooting & FAQ](#mcp-troubleshooting--faq)
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

## Configuring & Using External MCP Clients (OpenCode, Claude Desktop, Cursor, Hermes)

GridMind exposes its complete agent coordination plane via a standalone **Model Context Protocol (MCP)** server over standard input/output (`stdio`). This allows external coding agents like **OpenCode**, **Claude Desktop**, **Cursor**, and custom CLI agents (e.g., **Hermes**) to seamlessly participate in GridMind projects.

### 1. Build the MCP Server

Before connecting any client, build the standalone MCP bundle:

```bash
npm run build:mcp
```

This compiles `src/mcp/cli.ts` into a self-contained Node.js ESM executable at `dist/mcp/cli.mjs`.

### 2. Understanding Authentication Tokens (Master vs. Worker)

Every MCP interaction requires an authentication token passed via the `GRIDMIND_TOKEN` environment variable.

| Token Type | Purpose | Capabilities | How to Obtain |
|---|---|---|---|
| **Worker Token** | Assigned to an agent working on a specific task | Sandboxed to that task's Git worktree; records memories and emits handoffs for that task. | Generated automatically when an agent session is launched for a task in the UI, or found in `.gridmind/gridmind.db`. |
| **Master Token** | Used by project leads, orchestrator agents, or interactive IDE agents (like OpenCode/Cursor) | Cross-task visibility, ability to set persistent project context (`gridmind_set_context`), view all diffs, create PRs, and inspect all tasks. | Generated when creating a master session, or retrieved from SQLite: `sqlite3 .gridmind/gridmind.db "SELECT token, role, project_id FROM sessions WHERE role='master';"` |

#### Required Environment Variables
- `GRIDMIND_API`: The URL of your running GridMind server (typically `http://localhost:3000`).
- `GRIDMIND_TOKEN`: The bearer session token for authentication.

---

### 3. OpenCode Configuration (`opencode.jsonc`)

[OpenCode](https://opencode.ai) supports MCP servers defined in either your global or project-level configuration.

#### Option A: Global Configuration (Recommended)
Edit or create `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcpServers": {
    "gridmind": {
      "command": "node",
      "args": ["/Users/krishna/Codespace/Agentmind/dist/mcp/cli.mjs"],
      "env": {
        "GRIDMIND_API": "http://localhost:3000",
        "GRIDMIND_TOKEN": "<YOUR_SESSION_TOKEN>"
      }
    }
  }
}
```
*(Replace `/Users/krishna/Codespace/Agentmind/dist/mcp/cli.mjs` with the absolute path to your GridMind installation).*

#### Option B: Project-Level Configuration
Create `.opencode/opencode.jsonc` in the root of the repository you are working on with OpenCode, using the same JSON snippet as above.

#### Verifying OpenCode Connection
1. Launch OpenCode in your target repository:
   ```bash
   opencode
   ```
2. OpenCode will automatically load the `gridmind` tools.
3. Test by prompting OpenCode:
   > *"Use the gridmind_get_context tool to check the project context and any recent memories."*
4. OpenCode can update context or save facts:
   > *"Set a project context key 'backend_framework' with value 'Next.js 15 API Routes' using gridmind_set_context."*

---

### 4. Claude Desktop Configuration

Add GridMind to your `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

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

Restart Claude Desktop. The hammer icon will show all 20 GridMind tools available for Claude.

---

### 5. Cursor Configuration

In Cursor:
1. Open **Cursor Settings** (`Cmd + ,` or `Ctrl + ,`).
2. Navigate to **Features** → **MCP Servers**.
3. Click **"+ Add New MCP Server"**.
4. Configure:
   - **Name**: `gridmind`
   - **Type**: `command`
   - **Command**: `node /absolute/path/to/GridMind/dist/mcp/cli.mjs`
   - **Environment Variables**:
     - `GRIDMIND_API`: `http://localhost:3000`
     - `GRIDMIND_TOKEN`: `<YOUR_SESSION_TOKEN>`

Alternatively, configure `.cursor/mcp.json` in your workspace:

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

---

### 6. Hermes & Custom CLI Agents

To run standalone AI agent workers or CLI models through MCP over `stdio`:

```bash
GRIDMIND_API="http://localhost:3000" \
GRIDMIND_TOKEN="<YOUR_SESSION_TOKEN>" \
node dist/mcp/cli.mjs
```

---

## How Context & Project Memory Work via MCP

GridMind distinguishes between **persistent structured context** (high-level key-values), **learned project memory** (facts, constraints, decisions), and **worktree Git state**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        GridMind Web Dashboard                          │
│                                                                        │
│  [ PROJECT CONTEXT ]                          [ PROJECT MEMORY ]       │
│  architecture_pattern: Next.js + SQLite       ★ [fact] Git commit 4fd..│
│  latest_commit: 4fdbe9e — feat(...)           ★ [fact] Task completed  │
│  auth_method: Bearer JWT                      ★ [constraint] No API key│
└───────────────────▲────────────────────────────────────────▲───────────┘
                    │                                        │
           gridmind_set_context                    gridmind_record_memory
           (or auto-commit update)                 (or auto-commit/status)
                    │                                        │
                    └──────────────────┬─────────────────────┘
                                       │
                              OpenCode / Cursor / MCP
```

### Automatic Context Ingestion
You don't need to manually document every action. GridMind automatically records context for you:
1. **On Git Commit (`gridmind_git_commit`)**:
   - Automatically logs a shared memory fact: `Git commit <sha> on <branch>: "<message>"`.
   - Automatically writes or updates the `latest_commit` key in the project context table.
2. **On Task Completion (`gridmind_update_task_status(status="done")`)**:
   - Automatically logs a completion fact linked to that task with the commit SHA into project memory.

### Explicit Context & Memory Tools
Agents can proactively store knowledge to assist other agents in the swarm:
- **`gridmind_set_context(key, value)`**:
  - Saves persistent project metadata (e.g., `tech_stack`, `api_conventions`, `testing_strategy`).
  - Instantly visible in the left column of the **Context** tab on the web UI.
- **`gridmind_record_memory(content, type, importance)`**:
  - Records granular insights (`fact`, `constraint`, `decision`) with importance `1` to `3`.
  - Stored in the project memory store and retrieved by other agents via `gridmind_get_context` or `gridmind_search_memory`.
- **`gridmind_record_decision(summary, rationale)`**:
  - Records formal architectural trade-offs in the project decisions log.

### How Context is Surfaced in the Web UI
When you open a project at `http://localhost:3000/projects/<project_id>` and switch to the **Context** tab:
1. **Left Panel: "Project Context & Decisions"**:
   - Shows all active key-value pairs (with inline add/remove buttons and a one-click **"Copy Brief"** button).
   - Shows architectural decisions with filtering by status (`proposed`, `accepted`, `superseded`).
2. **Right Panel: "Project Memory & Learned Context"**:
   - Shows the live chronological stream of all commits, task events, constraints, and agent handoffs.
   - Each entry highlights its type, importance badge (★), author session, and relative timestamp.

---

## MCP Tools Reference (20 Tools)

GridMind provides **20 MCP tools** organized into clear functional domains:

### 1. Context & Memory Tools
| Tool | Parameters | Description |
|---|---|---|
| `gridmind_set_context` | `key`, `value` | Persist or update a project-level context key-value entry (e.g. `architecture`, `conventions`). Visible immediately in the web UI. |
| `gridmind_get_context` | `taskId?` | Retrieves token-budgeted project brief, task details, and incoming handoffs for prompt priming. |
| `gridmind_get_session_context` | _none_ | Inspects current agent session, task assignment, and role. |
| `gridmind_record_memory` | `content`, `type`, `importance?`, `scope?` | Records knowledge (`fact`, `constraint`, `decision`) into project or task memory. |
| `gridmind_search_memory` | `query`, `type?`, `scope?` | Searches project-shared and task-scoped memories using semantic text search. |
| `gridmind_record_decision` | `summary`, `rationale`, `status?` | Records an architectural decision in the project decision log. |
| `gridmind_get_task` | `taskId?` | Inspects the assigned task details, status, and branch. |
| `gridmind_update_task_status` | `status`, `notes?` | Updates task status (`in_progress`, `blocked`, `done`, `failed`). Auto-records memory on completion. |
| `gridmind_emit_event` | `event`, `data?` | Emits custom project events to the live SSE stream. |

### 2. Git Tools (Worktree Scoped)
| Tool | Parameters | Description |
|---|---|---|
| `gridmind_git_status` | `taskId?` | Returns clean/dirty status, branch, changed files, untracked files, and ahead/behind count for the authenticated task's worktree. |
| `gridmind_git_diff` | `path?`, `staged?`, `commit?`, `taskId?` | Returns bounded diff (unstaged, staged, or against a commit SHA). Strictly rejects path traversal (`../`). |
| `gridmind_git_commit` | `message`, `taskId?` | Commits changes in the authenticated worktree. Updates task record and auto-records commit to memory and context. |
| `gridmind_git_branches` | _none_ | Lists branches in the project repository (bounded to 50). |
| `gridmind_git_log` | `limit?`, `commit?` | Returns recent bounded commits (default 10, max 50) with commit lookup. |

### 3. Handoff Tools
| Tool | Parameters | Description |
|---|---|---|
| `gridmind_create_handoff` | `target_task_id`, `summary`, `completed_work`, `changed_files`, `decisions`, `blockers`, `next_steps`, `commit_sha`, `branch` | Creates a structured handoff transferring state from one agent/task to another. |
| `gridmind_get_handoffs` | `taskId?` | Retrieves handoffs targeted at or created by the agent's task. |
| `gridmind_accept_handoff` | `handoff_id` | Accepts an incoming handoff idempotently. |

### 4. GitHub Tools
| Tool | Parameters | Description |
|---|---|---|
| `gridmind_github_issues` | `state?` | Lists open issues for the project-configured GitHub repository. |
| `gridmind_github_create_pr` | `title`, `body`, `head_branch`, `base_branch` | Creates a Pull Request using the project-configured repository. |
| `gridmind_github_issue_to_task` | `issue_number`, `priority?` | Converts a GitHub issue into a GridMind task with worktree isolation. |

---

## MCP Troubleshooting & FAQ

### Q: Why am I not seeing context changes in the web UI when using OpenCode?
1. **Check which tab you are looking at**: Open `http://localhost:3000/projects/<your_project_id>` and make sure you click the **Context** tab in the navigation bar.
2. **Key-Value vs Memory**:
   - If you used `gridmind_set_context`, it appears in the **left column** under **"Project Context"**.
   - If you committed via `gridmind_git_commit` or used `gridmind_record_memory`, it appears in the **right column** under **"Project Memory & Learned Context"**.
3. **Verify Project ID**: Ensure the session token in your `opencode.jsonc` belongs to the project you are viewing in the browser. You can verify sessions with:
   ```bash
   sqlite3 .gridmind/gridmind.db "SELECT id, project_id, role, agent_type, token FROM sessions ORDER BY created_at DESC LIMIT 5;"
   ```

### Q: OpenCode reports `401 Unauthorized: invalid token`
Your session token may have expired or may not match any active session in `.gridmind/gridmind.db`. Generate or retrieve a fresh token:
```bash
sqlite3 .gridmind/gridmind.db "SELECT token, role, project_id FROM sessions WHERE role='master' ORDER BY created_at DESC LIMIT 1;"
```
Update `GRIDMIND_TOKEN` in `~/.config/opencode/opencode.jsonc` and restart OpenCode.

### Q: OpenCode reports `connection refused` on MCP calls
The GridMind Next.js web application must be running to handle MCP API calls. Start it with:
```bash
npm run dev
```
Make sure `GRIDMIND_API` is set to `http://localhost:3000`.

### Q: Do I need to rebuild the MCP server after editing GridMind source code?
Yes! If you modify any files in `src/mcp/`, rebuild the standalone executable with:
```bash
npm run build:mcp
```

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
