# McManus — History

## Project Context
- **Project:** Copilot Console — visual management layer for GitHub Copilot CLI
- **Stack:** Python 3.11+ / FastAPI backend
- **Backend path:** `src/copilot_console/`
- **Key deps:** github-copilot-sdk, agent-framework, fastapi, sse-starlette, apscheduler
- **Dev:** `python -m uvicorn copilot_console.app.main:app --reload --port 8765`
- **User:** sanchar10

## Learnings

### CROSS-TEAM: Keaton Codebase Survey (2026-04-11)
Keaton completed a comprehensive codebase survey. Reference `.squad/agents/keaton/history.md` for:
- Backend architecture deep-dive (FastAPI, services, routers, SDK integration, MCP servers)
- Service layer pattern, router pattern, error handling conventions
- 10 architectural decisions including Session Management and File-Based Storage
- Test coverage analysis with coverage gaps
- Data models, constants, important files and paths

See `.squad/decisions/decisions.md` for architectural decision log.

### Backend Code Quality Review (2025-07-18)
Full review report: `.squad/decisions/inbox/mcmanus-backend-review.md`

Key findings:
- **God classes:** `copilot_service.py` (1273 lines), `session_service.py` (784 lines), `sessions.py` router (782 lines) — top refactor targets
- **Dead code:** `session_service.py:525-531` — unreachable code after try/except in `_format_tool_input`
- **No file locking:** All JSON storage files (viewed.json, completion_times.json, settings.json, session.json) use non-atomic writes with no locking. Concurrent modifications cause silent data loss.
- **Memory leaks:** `_session_msg_locks` dict, `_pending_elicitations` futures, logging `FileHandler` instances — all grow without bound, never cleaned up
- **Unbounded event queue:** `event_queue` in `copilot_service.send_message()` uses `put_nowait()` with no backpressure — memory grows under slow consumers
- **SSE event types are implicit:** No Pydantic models or documented contract for the ~12 SSE event types. Frontend reverse-engineers shapes from backend code.
- **Session config resolution duplicated 6x:** MCP/tools/system_message/sub-agents resolution pattern is copy-pasted across `sessions.py`, `task_runner_service.py`, and `workflow_engine.py`
- **Sync file I/O in async paths:** Most storage services use synchronous `read_text()`/`write_text()` from async handlers
- **SDK monkey-patching:** `workflow_engine.py` patches 5 SDK methods globally at import time — affects all SDK usage, not just workflows
- **`test-elicitation` endpoint** ships in production with no guard
- **Good patterns to preserve:** Response buffer with `asyncio.Event` signaling (no polling), auth middleware timing-safe comparison, background task error handling

### Phase 1a — Backend Quick Fixes (2025-07-18)
Executed three zero-risk refactorings from the code quality review:

1. **Config resolution dedup (`sessions.py`):** Extracted `_resolve_session_config(session)` helper that consolidates MCP/tools/system-message/sub-agents resolution. Replaced 4 copy-pasted blocks (set_session_mode, update_runtime_settings, compact_session, SSE send_message route). Helper returns a dict with keys: cwd, mcp_servers, tools, available_tools, excluded_tools, system_message, custom_agents.

2. **Dead code cleanup (`session_service.py`):** Removed 7 lines of orphaned `_clean_text` body copy-pasted after `_format_tool_input`'s try/except (lines 525-531). Unreachable — every branch in the try/except returns.

3. **Memory leak fix (`copilot_service.py`):** Added `self._session_msg_locks.pop(session_id, None)` to `destroy_session_client()`. Prevents unbounded growth of per-session asyncio.Lock objects.

Key paths: `_resolve_session_config()` at `sessions.py:39`, cleanup at `copilot_service.py:741`.

### Stage 2 — Backend Independent Restructuring (2025-07-18)
Implemented 5 independent items from the backend review that don't depend on copilot_service split:

1. **Atomic file writes (`storage_service.atomic_write`):** Added `atomic_write(path, content)` helper to `storage_service.py` — writes to `.tmp` then `os.replace()`. Applied to 11 services: storage_service, agent_storage_service, automation_storage_service, workflow_storage_service, viewed_service, completion_times_service, project_service, task_run_storage_service, workflow_run_service, session_service. Pin_storage_service already had this pattern.

2. **Bounded event queue with backpressure:** Replaced unbounded `asyncio.Queue()` for SSE events with `asyncio.Queue(maxsize=1000)`. Added `_safe_enqueue()` helper that drops oldest non-sentinel event when full. All 13 `put_nowait` call sites now route through `_safe_enqueue`. Constant `_EVENT_QUEUE_MAX = 1000`.

3. **Log file handler cleanup:** Added `SessionFileHandler.close_session(session_id)` and module-level `close_session_log(session_id)` to `logging_service.py`. Wired into `destroy_session_client()` so file descriptors are released when sessions are destroyed.

4. **`_pending_elicitations` cleanup:** Already handled by `cancel_pending_elicitations()` called from `destroy_session_client()` (Phase 1a). Verified complete — no additional work needed.

5. **Test-elicitation endpoint gated:** Endpoint now returns 404 unless `COPILOT_DEBUG=1` is set. Removed inline `import uuid`/`import asyncio` in favor of module-level imports.

Key patterns:
- `atomic_write` is the canonical way to write JSON/YAML to disk — import from `storage_service`
- `_safe_enqueue` is the canonical way to push to bounded event queues — never call `put_nowait` directly
- `close_session_log` must be called when destroying a session to avoid FD leaks

### copilot_service.py Split (2025-07-18)
Implemented Keaton's 4-module split of `copilot_service.py` (was 1,412 lines → 4 files totaling ~1,591 lines).

**New modules (all leaf — no internal cross-deps):**
- `session_client.py` (298 lines): `SessionClient` class + `approve_all_permissions`. Per-session SDK client wrapper with lifecycle, RPC methods.
- `elicitation_service.py` (181 lines): `ElicitationManager` class. Owns pending futures dict, handler factories take `get_client` callback to avoid circular deps.
- `event_processor.py` (339 lines): `EventProcessor` class. Translates SDK events → SSE queue entries. Takes `touch_callback` to avoid back-dependency on SessionClient.
- `copilot_service.py` (773 lines): Slimmed coordinator. Imports all three, composes `ElicitationManager`, instantiates `EventProcessor` in `send_message()`.

**Bug fixed during split:** Stage 2 refactoring had accidentally inserted `_safe_enqueue` at module level in the middle of the `SessionClient` class body (between `__init__` and `start`). All remaining SessionClient methods (`start`, `stop`, `touch`, `create_session`, etc.) were syntactically valid as nested functions inside `_safe_enqueue` but were NOT accessible as class methods. This was a latent defect — the code parsed but `SessionClient` instances would have failed at runtime with `AttributeError` on any method call. Fixed by properly separating `SessionClient` into `session_client.py`.

**Import compatibility:** All external imports unchanged — `copilot_service`, `CopilotService`, `_safe_enqueue` all re-exported from `copilot_service.py`. `_safe_enqueue` duplicated (not imported) in leaf modules to maintain zero cross-deps.

**Key patterns:**
- `ElicitationManager` uses `get_client` callback pattern: `self._session_clients.get` is passed to handler factories
- `EventProcessor` uses `touch_callback` pattern: `client.touch` is passed to constructor
- `_safe_enqueue` is defined in 3 places (copilot_service, elicitation_service, event_processor) — intentional duplication to keep leaf modules independent

---

## Stage 5 — macOS Support (2026-04-13)

McManus completed platform-aware installation and development environment setup for macOS:

1. **Created install.sh** — Cross-platform shell script for installation
   - Platform detection (Linux vs macOS/Darwin)
   - Downloads appropriate binary (linux-x64 vs darwin-x64)
   - Adds to PATH via `.bash_profile` (macOS) or `.bashrc` (Linux)
   - Makes binary executable

2. **Added Sleep Prevention** — Backend dev server enhanced with platform-specific sleep prevention
   - `dev.py`: Wraps with `caffeinate` on macOS or `powercfg` on Windows
   - Prevents system sleep during development

3. **Platform-Aware Devtunnel Messages** — Updated setup instructions
   - Conditional display for macOS vs Linux/Windows (tunnel setup differs)
   - Updated in both `cli.py` and `dev.js`

4. **Documentation Updates** — Added macOS setup guidance to 4 files
   - README.md: macOS installation section
   - CONTRIBUTING.md: Platform-specific dev setup
   - docs/: Platform detection guidance

**Key learning:** macOS and Linux require fundamentally different installation approaches and development workflows. Platform detection must happen early (shell script entry point) and be consistently applied. Sleep prevention varies by OS (`caffeinate` vs `powercfg`). Clear documentation is essential for multiplatform onboarding.

## CROSS-TEAM: Keaton's copilot_service.py Split Architecture (2026-04-12)

Keaton designed the 4-module split for `copilot_service.py` (1,412 lines → 4 focused modules):

### 4-Module Architecture

**Module 1: session_client.py (~250 lines)**
- `SessionClient` class (per-session SDK client wrapper)
- Methods: `__init__`, `start()`, `stop()`, `touch()`, `create_session()`, `resume_session()`, `get_or_create_session()`, `set_mode()`, `set_model()`, `start_fleet()`, `compact()`
- Exports: `SessionClient`, `approve_all_permissions`
- Dependencies: stdlib + copilot SDK + logging_service (leaf module)

**Module 2: elicitation_service.py (~120 lines)**
- `ElicitationManager` class (manages interactive request/response futures)
- Methods: `make_elicitation_handler()`, `make_user_input_handler()`, `resolve()`, `cancel()`, `cancel_all()`
- Design: Receives `get_client` callback to avoid direct service dependency
- Dependencies: stdlib + logging_service (leaf module)

**Module 3: event_processor.py (~280 lines)**
- `EventProcessor` class (translates SDK events to SSE queue entries)
- Methods: `on_event()`, `terminate_stream()`, static helpers (`clean_text`, `get_text`, `format_tool_prompt`)
- State: `session_id`, `event_queue`, `done`, `full_response`, `reasoning_buffer`, `pending_turn_msg_id`, `compacting`, `idle_received`, `last_token_limit`
- Design: Receives `touch_callback` to avoid direct SessionClient dependency
- Dependencies: stdlib + logging_service (leaf module)

**Module 4: copilot_service.py (slimmed to ~400 lines)**
- Remains: All public methods, singleton instance, session client pool, main client
- Composes: SessionClient, ElicitationManager, EventProcessor
- Owns: `_session_clients` dict (exclusive ownership), `_main_client`, `_lock`, caches

### Key Constraints for Implementation

1. **No breaking API changes** — Singleton `copilot_service` and all public methods stay in `copilot_service.py`. Existing imports continue to work.
2. **No circular imports** — All 3 new modules are leaf modules. `copilot_service.py` is sole orchestrator.
3. **Shared state via callbacks** — Pass `get_client: Callable` and `touch_callback: Callable` to modules. Never pass entire dicts or service instances.
4. **`_session_clients` dict exclusive** — Only CopilotService owns it. Other modules access via narrow callbacks.

### Migration Plan (4 Sequential Steps)

1. **Extract session_client.py** — Move SessionClient class + approve_all_permissions block. Run tests.
2. **Extract elicitation_service.py** — Create ElicitationManager, adapt to use `get_client` callback. Update CopilotService to use it. Run tests.
3. **Extract event_processor.py** — Create EventProcessor from inline closures in `send_message()`. Refactor closures to instance attributes. Run tests.
4. **Verify & cleanup** — Check imports, confirm all 77 characterization tests pass.

### Test Coverage Gate

All 77 characterization tests (from Hockney) must pass without modification:
- **test_copilot_service.py** — 35 tests of public API
- **test_storage_service.py** — 18 tests of storage roundtrip
- **test_session_config.py** — 24 tests of config resolution

---

## CROSS-TEAM: Hockney's Pre-Refactor Test Suite (2026-04-12)

Hockney created 77 characterization tests as a safety net for the module split:

**test_copilot_service.py (35 tests)**
- Init state, session active/inactive tracking
- Get/destroy session clients
- Elicitation management (resolve/cancel pending)
- Models caching behavior
- stop() full teardown
- enqueue/abort message handling
- Idle cleanup loop
- SessionClient initialization

**test_storage_service.py (18 tests)**
- Full-field roundtrip (write → read → verify all fields)
- Minimal session roundtrip (create → save → load)
- Overwrite semantics (update existing)
- Raw save operations
- Concurrent isolation (no cross-session leaks)
- Settings merge/backfill (legacy compatibility)
- Delete operations
- JSON integrity (malformed file handling)
- Corrupt file recovery

**test_session_config.py (24 tests)**
- `_resolve_session_config()` result shape verification
- CWD fallback logic
- System message resolution
- Tools passthrough
- Expected keys validation ({cwd, mcp_servers, tools, available_tools, excluded_tools, system_message, custom_agents})
- Migration helpers (_migrate_selections, _migrate_tools for 4 legacy formats)
- Session lifecycle (create, connect, disconnect, delete)
- UUID generation and name tracking
- Auto-naming behavior

### Constraints for Refactoring

1. **All 77 tests must pass** — they test public behavior, not internal implementation
2. **Import paths may change** — update test imports if files move, but don't change test assertions
3. **`_resolve_session_config` contract is pinned** — must return exactly the 8 keys above
4. **Storage roundtrip fidelity is pinned** — every field written by `save_session` must be returned by `load_session` identically

### Next: Ready for Implementation

All prerequisites satisfied. McManus can begin module split with confidence.

---

## v0.7.0 Documentation Updates (2026-04-13)

McManus updated documentation for v0.7.0 release across 5 files:

**README.md:**
- Marked Workflows feature as experimental: "Multi-agent YAML pipelines (experimental)"
- Added 3 new feature rows: Interactive Q&A, Desktop Notifications, Open With
- Added bash install command for macOS/Linux alongside PowerShell
- Added link to Interactive Input guide in More Information section
- Verified --no-sleep option already includes platform info (Windows: SetThreadExecutionState, macOS: caffeinate)

**INSTALL.md:**
- Added note that macOS support is experimental with Xcode Command Line Tools setup instruction
- Confirmed bash install command already present in Quick Install section

**KNOWN-LIMITATIONS.md:**
- Added "macOS Support is Experimental" section noting limited testing
- Added "Workflows Feature is Experimental" section noting active development status

**TROUBLESHOOTING.md:**
- Reorganized into "General Issues" and "macOS Issues" sections
- Added 3 macOS-specific troubleshooting entries:
  - Use python3 not python on macOS
  - Sleep prevention with caffeinate and Activity Monitor checking
  - devtunnel installation via Homebrew

All edits were surgical — only touched sections specified in requirements. No seed copies found to update.

---

### Multi-Source Auth Detection + Login/Logout (2025-07-19)

**Problem:** `GET /api/auth/status` only used SDK `get_auth_status()` which checks the bundled CLI's own tokens. Users authenticated via `gh auth login` were falsely reported as unauthenticated.

**Fix — 3 tasks in `auth.py`:**

1. **Auth status (GET /api/auth/status):** Now checks 3 sources in order:
   - SDK `get_auth_status()` (fastest, returns login)
   - Functional probe (main client started = authenticated)
   - GitHub CLI fallback (`gh auth status --active`, 5s timeout, login parsed from output)

2. **Login (POST /api/auth/login):** SSE endpoint that:
   - Finds SDK bundled binary via `_find_copilot_binary()` (cross-platform: `.exe` on Windows)
   - Runs `copilot login` as async subprocess, streams output line-by-line
   - Events: `output` (device code lines), `done` (final auth status), `error`
   - 5-minute timeout for device code flow

3. **Logout (POST /api/auth/logout):** JSON endpoint that runs `copilot logout` and returns updated status.

**Key patterns:**
- `_find_copilot_binary()` — canonical way to locate SDK CLI binary, uses `platform.system()` for cross-platform
- Auth cascade: each source independently try/excepted, first success wins
- SSE login uses same `EventSourceResponse` pattern as sessions/workflows routers
- Provider-agnostic field names (`provider`, `login`) per design rules

**Decision doc:** `.squad/decisions/inbox/mcmanus-auth-fix.md`


