# Decisions

## Codebase Survey — Key Architectural Decisions & Patterns

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
