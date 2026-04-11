# Keaton — History

## Project Context
- **Project:** Copilot Console — visual management layer for GitHub Copilot CLI
- **Stack:** Python 3.11+ / FastAPI backend, React / TypeScript / Vite / Tailwind frontend
- **Key deps:** github-copilot-sdk, agent-framework, sse-starlette, apscheduler
- **User:** sanchar10

## Learnings

### BACKEND ARCHITECTURE

**Entry Points:**
- CLI: `src/copilot_console/cli.py` (main) → FastAPI server startup + browser launch
- FastAPI app: `src/copilot_console/app/main.py` (app object) — lifespan context manager handles startup/shutdown
- Entry point: Uvicorn on port 8765 (default), auto-opens browser unless --no-browser
- Static files bundled from `frontend/dist/` and mounted at `/` (SPA fallback)

**Directory Structure:**
```
src/copilot_console/
├── app/
│   ├── main.py          # FastAPI app, routers, middleware setup
│   ├── config.py        # Constants (APP_HOME, paths, models list, API_PREFIX)
│   ├── workflow_config.py # Agent Framework workflow config
│   ├── models/          # Pydantic models (session, message, agent, automation, workflow, etc.)
│   ├── services/        # Business logic singletons
│   │   ├── copilot_service.py         # SDK client mgmt (main + per-session clients, CWD support)
│   │   ├── session_service.py         # Session CRUD, message history, migrations
│   │   ├── mcp_service.py             # MCP server discovery (global + plugin + app-only config)
│   │   ├── automation_service.py      # APScheduler-based cron triggers
│   │   ├── task_runner_service.py     # Headless agent execution (concurrency-controlled)
│   │   ├── response_buffer.py         # In-memory buffering for SSE (survives reconnects)
│   │   ├── workflow_engine.py         # Agent Framework integration
│   │   ├── storage_service.py         # Settings/metadata JSON persistence
│   │   ├── tools_service.py           # Custom tool discovery from ~/.copilot-console/tools/
│   │   ├── notification_manager.py    # Push notification pipeline
│   │   ├── push_service.py            # VAPID/web push
│   │   ├── search_service.py          # Cross-session message search
│   │   └── ... (pin, agent, workflow, viewed, logging services)
│   ├── routers/         # API endpoints (FastAPI routers by domain)
│   │   ├── sessions.py         # Chat CRUD, SSE streaming, mode/model switching
│   │   ├── automations.py      # Cron-based runs
│   │   ├── workflows.py        # AF-based multi-agent pipelines
│   │   ├── agents.py           # Agent library CRUD
│   │   ├── tools.py            # Custom tool listing
│   │   ├── mcp.py              # MCP server selection
│   │   ├── settings.py         # User settings
│   │   ├── cli_hooks.py        # Bridge from CLI agentStop hook
│   │   └── ... (search, filesystem, logs, pins, push, etc.)
│   └── middleware/
│       ├── auth.py             # Bearer token for remote (non-localhost) access
│       └── selective_gzip.py   # Compress >1KB responses, skip SSE
├── cli.py               # `copilot-console` command
├── cli_notify.py        # `cli-notify` command (enable/disable CLI notifications)
└── seed/                # Bundled default agents, workflows, tools, MCP servers
    └── copilot-console/
        ├── agents/
        ├── tools/
        ├── workflows/
        └── local-mcp-servers/

Key paths (from config.py):
- APP_HOME = ~/.copilot-console (or $COPILOT_CONSOLE_HOME)
- COPILOT_SESSION_STATE = ~/.copilot/session-state (Copilot SDK sessions, read-only)
- SESSIONS_DIR = APP_HOME/sessions (Console-managed session metadata)
- AGENTS_DIR = APP_HOME/agents (Agent definitions)
- AUTOMATIONS_DIR = APP_HOME/automations (Cron automations)
- TASK_RUNS_DIR = APP_HOME/task-runs (Headless run history)
- SETTINGS_FILE = APP_HOME/settings.json (User settings)
```

**Key Patterns:**

*SDK Integration (copilot_service.py):*
- **Main client**: Single shared CopilotClient (no CWD) for read-only operations: list_sessions(), get_messages()
- **Per-session clients**: One CopilotClient per active tab (with session's CWD) for chat/mode changes
- **Lazy activation**: Client created on first message, destroyed when tab closes
- **CWD switching**: Destroys old client, creates new one if CWD changes mid-session
- **Permissions**: Uses PermissionHandler.approve_all from SDK ≥0.1.28 (fallback for older SDKs)
- **Custom agents**: Discovers .agent.md files from [cwd]/.github/agents/ + ~/.github/agents/

*Session Lifecycle:*
- Session created with SessionCreate (model, name, cwd, mcp_servers, tools, system_message, sub_agents)
- SDK session folder: ~/.copilot/session-state/{session_id}/ (raw events.jsonl file)
- Console metadata: ~/.copilot-console/sessions/{session_id}.json (name_set flag, auto-naming)
- First message → creates SDK session + per-session client
- Message history: read from SDK events.jsonl (includes reasoning text)
- Session closed: per-session client destroyed, metadata persists

*Response Streaming:*
- **Buffering model**: ResponseBufferManager holds in-memory buffers per session
- **Long-running agents**: Messages processed in background tasks (not tied to SSE connection)
- **Reconnect tolerance**: Browser disconnect doesn't kill agent, SSE can reconnect and fetch buffered content
- **Token usage tracking**: Completion times service caches latest token counts
- **SSE events**: 'update' (streaming content), 'done' (final), 'reasoning' (step details)

*Error Handling:*
- HTTPException + JSONResponse for API errors
- Logging at DEBUG level for comprehensive event logging
- Session-aware logging context (set_session_context for correlation)
- Graceful SDK method fallbacks (e.g., approve_all compatibility)
- try/catch in services with logger.warning/error — no silent failures

*Config Loading:*
- Pydantic BaseModel validation on all inputs
- Env vars: COPILOT_CONSOLE_HOME, COPILOT_NO_SLEEP, COPILOT_EXPOSE
- File storage: JSON (settings, agents, automations, pins, projects, metadata)
- No database — fully file-based for portability

**Workflows & Automations:**
- **Workflows**: Agent Framework YAML-based multi-agent pipelines (deterministic graph)
- **Storage**: YAML file + metadata.json (id, name, description, created_at, updated_at)
- **Execution**: Async task runner with queue management (max 3 concurrent runs)
- **Automations**: Cron-scheduled via APScheduler (stored as Automation records)
- **Task runs**: Headless execution results cached in ~/.copilot-console/task-runs/
- **Integration**: AutomationService starts on app startup, registers jobs, runs are fire-and-forget

**MCP Server Integration:**
- **Discovery**: Reads from 3 sources (priority): ~/.copilot/mcp-config.json (global), ~/.copilot/installed-plugins/copilot-plugins/*/mcp.json (plugins), ~/.copilot-console/mcp-config.json (app-only)
- **Server types**: local (command-based), http (REST), sse (Server-Sent Events)
- **Per-session selection**: Sessions track enabled MCP server names (list[str])
- **Tool selection**: Per-session granular tool filtering (custom + builtin SDK tools)
- **Caching**: MCPService caches config with mtime-based refresh

**Authentication:**
- **Localhost bypass**: Desktop UI (localhost) always allowed, no token needed
- **Tunnel detection**: Host header checked to distinguish tunnel traffic from localhost loopback
- **Bearer token**: For remote access (phone via devtunnel) — stored in settings.json
- **SSE compatibility**: Token passed in query param (EventSource can't set headers)
- **Token generation**: Cryptographic (secrets.token_urlsafe) on first non-localhost request

---

### FRONTEND ARCHITECTURE

**Tech Stack:**
- React 19 + TypeScript + Vite
- State: Zustand stores (per-domain: session, chat, tab, agent, automation, etc.)
- Routing: React Router v7
- Styling: Tailwind CSS 3.4
- UI: Custom components + react-markdown, react-syntax-highlighter, mermaid
- Testing: Vitest + React Testing Library

**Directory Structure:**
```
frontend/src/
├── App.tsx             # Root component (tabs, modals, agent monitor)
├── main.tsx            # React entry point
├── setupTests.ts       # Vitest configuration
├── api/                # REST + SSE API clients
│   ├── client.ts       # Base fetch wrapper (GET/POST/DELETE + EventSource)
│   ├── sessions.ts     # Session CRUD, chat send, elicitation responses
│   ├── agents.ts       # Agent CRUD
│   ├── automations.ts  # Automation CRUD
│   ├── workflows.ts    # Workflow CRUD, run execution
│   ├── mcp.ts          # MCP server selection
│   ├── tools.ts        # Tool discovery
│   ├── settings.ts     # Settings CRUD
│   ├── pins.ts         # Pin CRUD
│   ├── search.ts       # Cross-session search
│   ├── activeAgents.ts # Active agent stream
│   └── ...
├── components/
│   ├── layout/         # Layout wrapper, sidebar, header
│   ├── chat/           # ChatPane, MessageBubble, streaming UI
│   ├── session/        # SettingsModal, AgentMonitor, session config
│   ├── agent/          # Agent library, agent editor
│   ├── workflow/       # Workflow editor, run viewer
│   ├── automation/     # Automation scheduler, runs list
│   ├── tabs/           # Tab bar (close, rename, add)
│   └── ...
├── stores/             # Zustand state stores
│   ├── sessionStore.ts # Sessions list, current session, MCP/tools selection
│   ├── chatStore.ts    # Per-session messages, streaming state, elicitation
│   ├── tabStore.ts     # Open tabs, active tab, tab operations
│   ├── agentStore.ts   # Agent library
│   ├── automationStore.ts
│   ├── workflowStore.ts
│   ├── pinStore.ts
│   ├── projectStore.ts
│   ├── uiStore.ts      # Global UI state (modals, theme)
│   ├── viewedStore.ts  # Viewed timestamps for unread indicators
│   └── agentMonitorStore.ts
├── hooks/
│   ├── useSession.ts   # Session context/queries
│   └── useTheme.ts     # Dark mode toggle
├── types/              # TypeScript interfaces
│   ├── session.ts
│   ├── message.ts
│   ├── agent.ts
│   ├── api.ts
│   └── ...
├── utils/              # Helpers (formatting, parsing, etc.)
├── mobile/             # Mobile UI components
│   ├── MobileApp.tsx
│   └── MobileChat.tsx
└── index.css           # Global Tailwind + custom CSS
```

**Key Patterns:**

*State Management (Zustand):*
- Each domain has a store (session, chat, agent, etc.)
- Stores are singletons — created once, accessible from any component
- Actions use immer under hood for immutable updates
- Per-session data keyed by sessionId (e.g., messagesPerSession[sessionId])
- No context providers needed — direct store imports

*API Client Pattern:*
- Base client (`client.ts`) provides GET/POST/DELETE + EventSource
- Domain clients (sessions.ts, agents.ts, etc.) use base client
- Error handling: ApiError class wraps status code + message
- EventSource for streaming (SSE) — used in sessions, active-agents
- No auth header logic in frontend (localhost bypass + query param token fallback)

*Chat & Streaming:*
- ChatStore tracks per-session state: messages[], streaming (content + steps), elicitation/ask-user requests
- SSE stream from `/api/sessions/{id}/send` sends events: 'update', 'reasoning', 'tool_result', 'done'
- Streaming content appended incrementally (ChatPane re-renders as store updates)
- Elicitation/ask-user modal blocks agent until user responds
- File/image upload: multipart form POST to `/api/sessions/{id}/send`

*Session Lifecycle:*
- Tab creation: tab added to tabStore, no session API call yet
- Tab open: SessionCreate form → POST /api/sessions → store session in sessionStore
- Message send: SSE stream from SendMessage endpoint, streamed response updates chatStore
- Tab close: navigator.sendBeacon to disconnect (frees per-session SDK client)

*Unread Indicators:*
- ViewedStore tracks last viewed_at timestamp per session
- Session updated_at > viewed_at → session marked unread
- Viewed timestamp updated when user opens session tab

*Responsive Design:*
- Desktop: Sidebar + main chat pane
- Mobile (PWA): Simplified layout in `mobile/` folder
- Tailwind responsive classes used throughout
- CSS media queries in index.css for breakpoints

---

### INTEGRATION POINTS

**Frontend ↔ Backend Communication:**
1. **REST**: Session CRUD, agent/automation/workflow CRUD, MCP/tool selection
2. **SSE (Server-Sent Events)**: Chat streaming, active agents monitoring
3. **Multipart form**: File/image uploads with messages
4. **Query params for auth**: Token passed in EventSource URL (no header support)

**Session Lifecycle:**
- Browser: Create session → POST /api/sessions (returns Session with session_id)
- Browser: Send message → SSE stream from /api/sessions/{id}/send (streaming response)
- Browser closes: sendBeacon /api/sessions/{id}/disconnect (cleanup)

**Authentication Model:**
- **Localhost**: No auth (desktop UI)
- **Remote (tunnel)**: Bearer token required in Authorization header
- **SSE (no headers)**: Token in query param `?token=<token>`
- **Token storage**: In settings.json (sync'd to frontend via /api/settings)

**CLI Hooks Integration:**
- CLI agentStop hook → POST /api/cli-hooks/agent-stop
- Triggers notification pipeline (30s delay, viewed check, push)
- Session lookup to add name + preview

**MCP Server Integration:**
- Frontend selects enabled MCP servers per session (list[str])
- Backend passes selected servers to SDK on message send
- Tool selection: granular per-session via SDK ToolFilter

**Push Notifications:**
- Web Push API (VAPIF) for mobile companion
- NotificationManager checks unread sessions on startup + after each agent response
- Delayed by 30s (accounts for browser reconnect) before push sent

---

### TESTING STRATEGY

**Test Files (23 test modules):**
- Unit tests: `test_services.py` (service logic), `test_seed_service.py` (bundled content)
- API tests: `test_routers.py` (endpoint responses), `test_api_smoke.py` (sanity checks)
- Domain tests:
  - `test_agents.py` — Agent CRUD, storage
  - `test_automations.py` — Cron scheduling, task runs
  - `test_workflows.py` — Workflow YAML parsing, execution
  - `test_mcp.py` — MCP server discovery
  - `test_push.py`, `test_pins_router.py` — Feature-specific
  - `test_cli_notify.py` — CLI notification hook
- E2E tests (6 modules in `tests/e2e/`):
  - `test_app_loads.py` — Basic app startup
  - `test_sessions.py` — Session creation, message exchange
  - `test_chat.py` — Streaming, elicitation, ask-user
  - `test_tabs.py` — Tab management
  - `test_settings.py` — User settings
  - `test_indicators.py` — Unread indicators

**Frontend Tests:**
- Vitest run (React component tests)
- Stores: `sessionStore.test.ts`, `chatStore.test.ts`, `tabStore.test.ts`, etc.
- Focus on store logic, not UI rendering

**Test Patterns:**
- Backend: pytest + pytest-asyncio (async test support)
- Conftest: `conftest.py` in tests/ provides fixtures (mock SDK, test client)
- Markers: `@pytest.mark.e2e` for E2E tests (deselect with `-m 'not e2e'`)
- No coverage CI yet — baseline needed

**Coverage Gaps:**
- Error scenarios (network failures, SDK exceptions, file I/O)
- Session persistence under crash recovery
- Multi-tab concurrency (race conditions)
- Mobile push notification edge cases
- Workflow rollback on step failure
- MCP server timeout + retry logic
- Custom tool validation

---

### CONSTANTS & CONFIG FILES

**Key Constants (config.py):**
- `DEFAULT_MODELS` = ["gpt-4.1", "gpt-4o", "gpt-4", "claude-sonnet-4"]
- `DEFAULT_MODEL` = "gpt-4.1"
- `DEFAULT_CWD` = user's home directory
- `DEFAULT_WORKFLOW_STEP_TIMEOUT` = 600 seconds (10 min)
- `DEFAULT_CLI_NOTIFICATIONS` = False
- `API_PREFIX` = "/api"
- `DEFAULT_MODELS` determined from Copilot SDK docs

**Settings File (settings.json):**
```json
{
  "default_model": "gpt-4.1",
  "default_cwd": "/home/user",
  "cli_notifications": false,
  "api_token": "base64-secure-token",
  "push_subscription": { "endpoint": "...", "keys": {...} }
}
```

**Project Metadata (projects.json):**
- List of projects (folder paths + names)
- Used for sidebar project filtering

**Metadata File (metadata.json):**
- Schema version, app version snapshots (for migration tracking)

---

### DATA MODELS (Pydantic)

**Core Models:**
- `Session` — session_id, model, cwd, mcp_servers, tools, system_message, name_set, created_at, updated_at
- `Message` — role, content, id, created_at, attachments, steps, tool_results
- `Agent` — id, name, description, icon, system_message, model, tools, mcp_servers, sub_agents, starter_prompts
- `Automation` — id, agent_id, name, cron, enabled, input (template), cwd
- `TaskRun` — id, automation_id, agent_id, prompt, cwd, status, result, started_at, completed_at
- `Workflow` — id, name, yaml_content, metadata (created_at, updated_at)
- `WorkflowRun` — id, workflow_id, status, node_results, events, error, session_id, copilot_session_ids
- `Agent` — Can have starter_prompts (title + prompt)
- `Tool` — name, description, enabled, custom/builtin origin

**Enums:**
- `MessageRole` — "user", "assistant", "system"
- `TaskRunStatus` — "pending", "running", "completed", "failed", "cancelled"
- `WorkflowRunStatus` — "pending", "running", "paused", "completed", "failed", "aborted"
- `AgentMode` — "interactive", "plan", "autopilot"

---

### IMPORTANT FILES & PATHS

Backend:
- `src/copilot_console/app/main.py` — FastAPI app entry, all routers
- `src/copilot_console/app/config.py` — Constants, paths
- `src/copilot_console/app/services/copilot_service.py` — SDK integration
- `src/copilot_console/app/services/session_service.py` — Session logic
- `src/copilot_console/app/routers/sessions.py` — Chat API
- `src/copilot_console/cli.py` — CLI entry point
- `pyproject.toml` — Package metadata, dependencies

Frontend:
- `frontend/src/App.tsx` — Root component
- `frontend/src/api/client.ts` — Base HTTP/SSE client
- `frontend/src/stores/sessionStore.ts` — Session state
- `frontend/src/stores/chatStore.ts` — Chat + streaming state
- `frontend/package.json` — Dependencies, build script
- `frontend/vite.config.ts` — Vite configuration

Tests:
- `tests/conftest.py` — Pytest fixtures
- `tests/test_routers.py` — API endpoint tests
- `tests/e2e/test_sessions.py` — End-to-end flow

Seed Content:
- `src/copilot_console/seed/copilot-console/` — Bundled agents, workflows, tools, MCP servers
- Deployed to ~/.copilot-console/ on CLI run

---

