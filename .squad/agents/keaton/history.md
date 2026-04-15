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

## v0.7.0 Release Prep (2026-04-13)

### Tasks Completed

**TASK A: Interactive Input Guide (docs/guides/INTERACTIVE-INPUT.md)**
- Created comprehensive guide covering both ask_user and elicitation in a single, user-friendly document
- Covers: What it is, Two mechanisms (ask_user vs. elicitation), UI layout, Skip behavior, Mobile support, Reconnect resilience, Desktop notifications, Best practices
- Added placeholder for screenshot (TODO comment)
- Duplicated content to seed location: `src/copilot_console/seed/copilot-console/docs/guides/INTERACTIVE-INPUT.md`
- Positioned docs/guides/ as user-facing reference material

**TASK B: Changelog v0.7.0 (CHANGELOG.md)**
- Organized 87 commits into structured, semantically meaningful categories:
  - ✨ Features: 20 entries (ask_user, elicitation, auth UI, "Open with", agent management, audio, code blocks)
  - 🐛 Bug Fixes: 35+ entries (state/connectivity, lifecycle, mobile UX, elicitation internals, error handling, session mgmt)
  - ♻️ Refactoring: SSE parser consolidation, ChatStep dedup, component decomposition, stage refactors
  - 📱 Mobile: Full section covering input, streaming, step rendering, reconnect
  - 🏗️ Architecture: Core refactoring, revert & stabilization, code cleanup
  - 📝 Documentation: Setup guides, DEV-SETUP.md, codebase survey
  - 🚀 Platform Support: macOS/Linux install.sh, caffeinate, cross-platform messages
- Added release summary paragraph highlighting major themes
- Each category focuses on user-facing value rather than individual commits

### Key Decisions
- Grouped related commits (e.g., all ask_user/elicitation work → one Features entry) to avoid repetition
- Separated mobile work into dedicated section for visibility
- Emphasized architectural improvements (SSE parser, refactors) but kept focus on user features
- Used emojis for quick visual scanning of changelog categories
- Added date: 2026-04-13 (release date)

---

### CROSS-PLATFORM AUDIT (2025-07-17)

**Key Findings — Windows → macOS Compatibility**

1. **Core architecture is already cross-platform.** pathlib.Path used throughout config.py, all storage services, and CLI. os.path.* functions in agent_discovery_service.py are inherently portable. Filesystem router (filesystem.py) already has Windows/macOS/Linux branching for drive listing, parent path, and file opening.

2. **Blockers are installation-only.** The only 🔴 Blockers are the absence of a `scripts/install.sh` for macOS (install.ps1 is PowerShell-only). The core Python app starts and runs fine on macOS.

3. **Sleep prevention (`main.py:32-47`) is Windows-only** — uses `ctypes.windll.kernel32.SetThreadExecutionState`. Needs macOS equivalent via `caffeinate -i -w <pid>` subprocess. The guard `if sys.platform != "win32": return` means it silently no-ops on macOS (safe but feature-missing).

4. **devtunnel error messages hardcode `winget install`** in `cli.py:188` and `dev.js:136`. Needs platform-aware alternatives (`brew install --cask devtunnel` for macOS).

5. **Frontend keyboard shortcut tooltip** says "Ctrl+K" in `Sidebar.tsx:142` but the handler correctly uses `e.ctrlKey || e.metaKey` (works on both). Only the label needs fixing to show ⌘K on Mac.

6. **Documentation** uses `powershell` code fences throughout seed docs. Needs `sh`/`bash` alternatives.

7. **Scope estimate: ~10-12 hours** — focused sprint, not a refactor. Main work is install.sh + caffeinate + message fixes + docs.

Full audit: `.squad/decisions/inbox/keaton-xplat-audit.md`

---

### COPILOT_SERVICE.PY SPLIT ARCHITECTURE (2025-07-18)

**Decision:** Split `copilot_service.py` (1,412 lines) into 4 modules:
1. `session_client.py` (~250 lines) — `SessionClient` class + SDK permission imports
2. `elicitation_service.py` (~120 lines) — `ElicitationManager` class for interactive futures
3. `event_processor.py` (~280 lines) — `EventProcessor` class for SDK→SSE event translation
4. `copilot_service.py` (~400 lines) — slimmed coordinator, keeps singleton + all public methods

**Import graph:** All 3 new modules are leaf modules. `copilot_service.py` imports them. No circular deps.

**Key pattern:** Shared state accessed via callbacks (e.g., `get_client: Callable`) not direct dict access. `_session_clients` dict stays exclusively in `CopilotService`.

**No breaking changes:** External imports (`from copilot_service import copilot_service`) unchanged.

**Full decision:** `.squad/decisions/inbox/keaton-copilot-service-split.md`

---

## CROSS-TEAM: Stage 2 Wave 1 Summary (2026-04-12)

### McManus Completed Infrastructure Hardening

McManus executed 5 independent backend fixes in preparation for module split:

1. **Atomic writes pattern** — All 11 storage services now use `atomic_write(path, content)` from storage_service.py. Prevents data corruption on crash (write to .tmp then os.replace).

2. **Bounded SSE event queue** — Per-session event queue maxsize=1000. `_safe_enqueue()` drops oldest non-sentinel event on backpressure. Never call `put_nowait()` directly.

3. **Session log handler cleanup** — Added `close_session_log(session_id)` to logging_service.py. Wired into `destroy_session_client()`. Prevents unbounded FD growth.

4. **test-elicitation endpoint gating** — Returns 404 in production. Set COPILOT_DEBUG=1 to enable during UI development.

5. **Session message lock cleanup** — `self._session_msg_locks.pop(session_id, None)` in `destroy_session_client()`. Prevents unbounded dict growth.

### Hockney Created Pre-Refactor Characterization Tests

Hockney wrote 77 tests across 3 files to capture current behavior before module split:
- **test_copilot_service.py** — 35 tests covering CopilotService public API (session lifecycle, elicitation, models caching, stop/cleanup)
- **test_storage_service.py** — 18 tests covering StorageService write/read fidelity (roundtrip, merge, corrupt file handling)
- **test_session_config.py** — 24 tests covering config resolution, migrations, session cleanup

All 77 tests passing. These are the regression suite for module split.

### Architecture Ready for Implementation

All prerequisites satisfied:
- ✅ Keaton: Architecture design complete (4-module split decision documented)
- ✅ McManus: Infrastructure hardened (atomic writes, bounded queue, cleanup)
- ✅ Hockney: Test suite in place (77 characterization tests, all passing)

Next: McManus implements module split in 4 sequential steps, with test gates.

---

### Stage 3 Frontend Restructuring — Code Review (2025-07-18)

**Verdict:** APPROVED ✅

Reviewed Fenster's Stage 3 decomposition. Key findings:
- SSE parser (`utils/sseParser.ts`) is clean — handles multi-line data, CRLF, buffer flush, reader lock release
- Exponential backoff in `activeAgents.ts` is correct: `min(1s * 2^attempt, 30s)`, resets on success, aborts cleanly
- `ChatStep` has exactly 1 canonical definition in `types/message.ts`, re-exported from `session.ts` and `chatStore.ts`
- `useFileUpload` hook: clean encapsulation, proper cleanup with `consumeAttachments/consumePendingFiles`
- `useSlashCommands` hook: correct state isolation, no leaked closures
- `PinsDrawer` props match exactly what ChatPane was passing inline
- `scrollToMessageBySdkId` re-exported from ChatPane for backward compat (SearchModal imports it)
- `useMemo` on `splitSegments()` in StreamingMessage — correct dependency on `[content]`
- `npx tsc --noEmit` passes with 0 errors
- No circular dependencies detected between hooks/components/utils
- `useMessageSender` was not extracted — `handleSubmit` kept inline due to closure deps (correct call)

No functionality breakage detected.

