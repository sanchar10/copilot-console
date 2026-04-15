# Decisions

## Core Architectural Decisions

### 1. Session Management — Per-Session SDK Clients
**Decision**: Maintain one main CopilotClient (for read-only ops) + per-session CopilotClient instances (for chat).
**Why**: Allows concurrent sessions with different working directories without resource bloat. Lazy activation (create on first message, destroy on tab close) keeps memory footprint low.
**Impact**: Session lifecycle tied to frontend tab — no background sessions without UI.

### 2. File-Based Storage — No Database
**Decision**: All metadata stored as JSON files in `~/.copilot-console/` (sessions/, agents/, automations/, task-runs/).
**Why**: Portability, simplicity, no external dependencies, matches CLI convention.
**Impact**: Scaling beyond 10K sessions may require eventual database migration; for personal use, sufficient.

### 3. Response Buffering — Survive Disconnects
**Decision**: ResponseBufferManager holds in-memory buffers per session; agents run in background tasks (not tied to SSE connection).
**Why**: Browser disconnect doesn't kill agent. Users can close tab, refresh, reconnect, and fetch buffered response.
**Impact**: Requires cleanup task on buffer manager to prevent memory leaks. Trade-off: RAM usage vs. UX robustness.

### 4. Token-Based Auth — Tunnel-Ready
**Decision**: Bearer token for non-localhost requests; localhost always allowed (desktop). Token passed in query param for SSE (EventSource limitation).
**Why**: Enables mobile companion via devtunnel while keeping desktop UI frictionless. Query param workaround is standard practice.
**Impact**: Clients must handle token in both Authorization header and query params.

### 5. Zustand — Lightweight State Management
**Decision**: Per-domain Zustand stores (session, chat, agent, etc.) instead of Redux/Context.
**Why**: Simple, performant, minimal boilerplate. Immer integration handles immutability automatically.
**Impact**: No centralized state tree; team must maintain discipline with store naming/organization.

### 6. MCP Server Discovery — Multi-Source Config
**Decision**: Read MCP configs from 3 sources (priority order): ~/.copilot/mcp-config.json (global) → plugins → app-only config.
**Why**: Allows global CLI sharing + app-specific overrides. Plugins auto-discovered on dir scan.
**Impact**: Per-session MCP server selection passed to SDK at message time.

### 7. Automations — Cron + Background Task Queue
**Decision**: APScheduler for cron triggers, TaskRunnerService for headless agent execution (max 3 concurrent).
**Why**: Simple, standard solution. Concurrency limit prevents server overload.
**Impact**: Runs are fire-and-forget; no persistence of in-flight runs (recover from events on restart).

### 8. Workflow — Agent Framework YAML
**Decision**: Use Microsoft Agent Framework for multi-agent pipelines; store YAML + metadata (id, name, created_at).
**Why**: Deterministic graph-based workflows, native AF tooling, agent chaining without custom orchestration.
**Impact**: Requires team familiarity with AF YAML syntax. Workflow runs create copilot sessions for replay.

### 9. API Design — Domain-Based Routers
**Decision**: Split routers by domain (sessions.py, agents.py, workflows.py, etc.) under `/api` prefix.
**Why**: Maintainability, clear separation of concerns. All protected by auth middleware.
**Impact**: Easy to assign router ownership to team members (Fenster, McManus).

### 10. Logging — Session-Aware Context
**Decision**: DEBUG-level logging with session_id correlation (set_session_context for track-ability).
**Why**: Aids debugging in multi-tab environment; logs include session context by default.
**Impact**: High log volume in DEBUG mode; production may benefit from INFO-level with selective DEBUG for troubleshooting.

---

## Stage 1 Quick Wins — COMPLETE

### Backend Phase 1a: Configuration & Memory Leak Fixes
**Decision**: Three zero-risk backend refactorings (2025-07-18).

1. **`_resolve_session_config()` helper** — Extracted duplicated MCP/tools/system-message/sub-agents resolution pattern from `sessions.py`. Consolidated 4 copy-pasted blocks (set_session_mode, update_runtime_settings, compact_session, SSE send_message) into one private helper. Returns dict: `{cwd, mcp_servers, tools, available_tools, excluded_tools, system_message, custom_agents}`.
2. **Dead code cleanup** — Removed 7 lines of orphaned `_clean_text` copy-pasted after `_format_tool_input`'s try/except in `session_service.py` (lines 525–531). Unreachable — every branch in try/except returns.
3. **Session lock cleanup** — Added `self._session_msg_locks.pop(session_id, None)` to `destroy_session_client()` in `copilot_service.py`. Prevents unbounded dict growth of per-session asyncio.Lock objects.

**Impact:** All behavior-preserving. No API contract changes, no frontend impact.

### Frontend Phase 1b: Error Handling & UI Robustness
**Decision**: Five zero-risk frontend fixes (2025-07-18).

1. **ErrorBoundary** — New `ErrorBoundary.tsx` wraps `<App />` in `main.tsx`. Catches unhandled render errors app-wide.
2. **sendingSessionId finally** — `finally { setSending(null) }` replaces scattered cleanup. Removed 45s activation timeout (backend's 30s timeout + finally covers all paths).
3. **fileIcon dedup** — Shared util at `frontend/src/utils/fileIcon.ts` (reused in InputBox + MessageBubble).
4. **clearSessionMessages** — Now also cleans `pendingElicitation`, `resolvedElicitations`, `pendingAskUser` on tab close / session delete.
5. **apiMarkViewed .catch()** — Belt-and-suspenders catch on fire-and-forget call.

**Impact:** Improved robustness without behavior changes. Fixes stuck send button and prevents white-screen crashes.

---

## Stage 2 Backend Restructuring — IN PROGRESS

### Phase 2a: Infrastructure Hardening
**Decision**: Five independent fixes before module split (2026-04-12).

1. **Atomic writes pattern** — Implemented `atomic_write(path, content)` in `storage_service.py`. Writes to `.tmp` then `os.replace()` to prevent corruption on crash. Converted 11 services: storage_service, agent_storage_service, automation_storage_service, workflow_storage_service, viewed_service, completion_times_service, project_service, task_run_storage_service, workflow_run_service, session_service, copilot_service.
   - **Convention:** All JSON/YAML writes now go through `atomic_write()`.

2. **Bounded SSE event queue** — Per-session event queue now has `maxsize=1000`. `_safe_enqueue()` in `copilot_service.py` handles backpressure by dropping oldest non-sentinel event when full.
   - **Invariant:** Never call `put_nowait()` directly on event_queue.

3. **Session log handler cleanup** — Added `close_session_log(session_id)` in `logging_service.py` to clean up file handler instances. Wired into `destroy_session_client()`.

4. **test-elicitation endpoint gating** — Returns 404 in production. Set `COPILOT_DEBUG=1` env var to enable during UI development.

5. **Session message lock cleanup** — Already implemented in Phase 1a; mentioned here for completeness.

**Impact:** Prevents memory leaks, data corruption, and unbounded queue growth. Hardens infrastructure before structural changes.

### Phase 2b: Module Split Architecture
**Decision**: Split `copilot_service.py` (1,412 lines) into 4 focused modules (2026-04-12 planned).

**4-Module Architecture:**

1. **session_client.py** (~250 lines) — Per-session SDK client wrapper
   - Class: `SessionClient` (lifecycle, RPC calls)
   - Exports: `SessionClient`, `approve_all_permissions`
   - Dependencies: stdlib + copilot SDK + logging_service (leaf module)

2. **elicitation_service.py** (~120 lines) — Interactive request/response cycles
   - Class: `ElicitationManager` (manages pending futures)
   - Methods: `make_elicitation_handler()`, `make_user_input_handler()`, `resolve()`, `cancel()`, `cancel_all()`
   - Receives: `get_client` callback (no direct service dependency)
   - Dependencies: stdlib + logging_service (leaf module)

3. **event_processor.py** (~280 lines) — SDK event translation to SSE queue
   - Class: `EventProcessor` (processes streaming events)
   - Methods: `on_event()`, `terminate_stream()`, static helpers
   - State: `full_response`, `reasoning_buffer`, `pending_turn_msg_id`, `compacting`, `idle_received`, `last_token_limit`
   - Receives: `session_id`, `event_queue`, `done`, `touch_callback`
   - Dependencies: stdlib + logging_service (leaf module)

4. **copilot_service.py** (slimmed to ~400 lines) — Orchestrator
   - Remains: All public methods, singleton instance, session client pool, main client
   - Composes: `SessionClient`, `ElicitationManager`, `EventProcessor`
   - Owns exclusively: `_session_clients` dict, `_main_client`, `_lock`, caches
   - Delegation: Pass callbacks to modules, no circular imports

**Import Graph:**
```
session_client.py    (leaf)
elicitation_service.py (leaf)
event_processor.py   (leaf)
        ↑      ↑      ↑
        └──────┼──────┘
               │
      copilot_service.py (sole orchestrator)
```

**Key Invariants:**
- No circular imports (all three new modules are leaf modules)
- No breaking API changes (public methods and singleton remain in `copilot_service.py`)
- Shared state via narrow callbacks, not shared references
- `_session_clients` dict remains exclusively owned by `CopilotService`

**Migration Plan (4 sequential steps):**
1. Extract `session_client.py` — move SessionClient class
2. Extract `elicitation_service.py` — refactor to use `get_client` callback
3. Extract `event_processor.py` — refactor closures to instance attributes
4. Verify imports and run full test suite

**Coverage Gate:** 77 characterization tests (35 CopilotService + 18 StorageService + 24 SessionConfig) must pass without modification.

**Risks & Mitigations:**
- **Closure variable capture:** Instance attributes become state variables. Mitigated by unit-testing EventProcessor in isolation with mock events.
- **Thread safety:** Single-threaded async model is safe; ElicitationManager dict accessed only from event loop.
- **Generator semantics:** `send_message()` remains an AsyncGenerator; event callback moves out, yield statements stay in place.

---

## Cross-Platform Compatibility — macOS Support Plan

### macOS Audit Results
**Status**: PLANNING (2025-07-17)  
**Total issues found**: 22  
- 🔴 Blockers: 3 (app won't start on macOS)
- 🟡 Functional: 11 (broken/degraded features)
- 🟢 Cosmetic: 8 (UX/docs)

**Key clusters:** Path handling, sleep prevention, filesystem browsing, search service, CLI encoding, install script, documentation.

**Priority:** Focused sprint after Stage 2 backend restructuring completes.

---

## User Directives

### Git Commit Policy (2026-04-11T04:18Z)
**Directive:** Scribe must not auto-commit. Always verify with user before committing .squad/ changes to git.
**Source:** sanchar10 via Copilot
