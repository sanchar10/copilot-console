# Hockney — History

## Project Context
- **Project:** Copilot Console — visual management layer for GitHub Copilot CLI
- **Stack:** Python 3.11+ backend (pytest), React/TypeScript frontend (Vitest)
- **Test path:** `tests/`
- **Run tests:** `pytest` (backend), `cd frontend && npm test` (frontend)
- **User:** sanchar10

## Learnings

### CROSS-TEAM: Keaton Codebase Survey (2026-04-11)
Keaton completed a comprehensive codebase survey. Reference `.squad/agents/keaton/history.md` for:
- Testing strategy overview (23 test modules, pytest + Vitest, markers)
- E2E test modules (test_app_loads, test_sessions, test_chat, test_tabs, test_settings, test_indicators)
- 10 architectural decisions for test coverage planning
- Test patterns, conftest fixtures, coverage gaps
- Frontend and backend testing patterns

See `.squad/decisions/decisions.md` for architectural decision log.

### Stage 2 Pre-Refactor Characterization Tests (2026-04-11)
Wrote 77 characterization tests across 3 new files to capture current backend behavior before McManus restructures:

**Files created:**
- `tests/test_copilot_service.py` — 35 tests covering CopilotService public API: init state, session active/inactive, get/destroy session clients, elicitation management (resolve/cancel), models caching, stop() teardown, enqueue/abort, idle cleanup, SessionClient init.
- `tests/test_storage_service.py` — 18 tests covering StorageService write/read fidelity: full-field roundtrip, minimal session roundtrip, overwrite, raw save, concurrent isolation, settings merge/backfill, delete, JSON integrity, corrupt file handling.
- `tests/test_session_config.py` — 24 tests covering _resolve_session_config (CWD fallback, system_message resolution, tools passthrough, expected keys), migration helpers (_migrate_selections, _migrate_tools for 4 legacy formats), session cleanup (disconnect/delete), create_session (UUID generation, name_set tracking, auto-naming).

**Key patterns:**
- Reuse `_fresh_config()` from test_services.py for hermetic module isolation
- `asyncio.run(_run())` for async tests (project doesn't use pytest-asyncio markers)
- Mock external deps (SDK) with `unittest.mock.AsyncMock`; never call real APIs
- SessionClient's `touch()`/`stop()` are nested inside `_safe_enqueue` due to indentation — tests must use mock clients, not real SessionClient methods

**Coverage gaps identified:**
- `send_message()` and `send_message_background()` are the most complex methods (~350 lines) — not yet tested due to deep SDK coupling. Will need integration-level mocks.
- `list_sessions()` populates `_sdk_metadata_cache` as a side effect — tested indirectly but deserves explicit test post-refactor.
- No tests for the SSE streaming event format — deferred to e2e.

---

## CROSS-TEAM: McManus Infrastructure Hardening (2026-04-12)

McManus completed 5 independent backend fixes before module split:

1. **Atomic writes pattern** — Added `atomic_write(path, content)` to storage_service.py. Used in 11 services: storage_service, agent_storage_service, automation_storage_service, workflow_storage_service, viewed_service, completion_times_service, project_service, task_run_storage_service, workflow_run_service, session_service, copilot_service.
   - **Convention:** All JSON/YAML writes go through `atomic_write()` (write to .tmp then os.replace).
   - **Impact:** Prevents data corruption on crash.

2. **Bounded SSE event queue** — Per-session event queue now has maxsize=1000. `_safe_enqueue()` drops oldest non-sentinel event on backpressure.
   - **Invariant:** Never call `put_nowait()` directly on event_queue.
   - **Impact:** Prevents unbounded memory growth under slow consumers.

3. **Session log handler cleanup** — Added `close_session_log(session_id)` to logging_service.py. Wired into `destroy_session_client()`.
   - **Impact:** Prevents unbounded file descriptor growth.

4. **test-elicitation endpoint gating** — Returns 404 unless COPILOT_DEBUG=1 env var set.
   - **Impact:** Production-safe endpoint for UI development.

5. **Session message lock cleanup** — `self._session_msg_locks.pop(session_id, None)` in `destroy_session_client()`.
   - **Impact:** Prevents unbounded dict growth (already in Phase 1a).

### Tests Should Pass After These Changes

The 77 characterization tests are designed to verify that McManus's changes didn't break existing behavior. All tests should pass after infrastructure hardening because we only fixed edge cases (memory leaks, data corruption protection), not altered semantics.

---

## CROSS-TEAM: Keaton's copilot_service.py Split Architecture (2026-04-12)

Keaton designed a clean 4-module split for `copilot_service.py` (1,412 lines):

### 4 New Modules (All Leaf Modules)

1. **session_client.py** (~250 lines) — `SessionClient` class + SDK permission helpers
2. **elicitation_service.py** (~120 lines) — `ElicitationManager` for interactive futures
3. **event_processor.py** (~280 lines) — `EventProcessor` for SDK→SSE event translation
4. **copilot_service.py** (slimmed to ~400 lines) — Orchestrator, keeps all public methods

### Key Design Invariants

- No circular imports (all 3 new modules are leaf modules)
- No breaking API changes (singleton + public methods stay in copilot_service.py)
- Shared state via callbacks (e.g., `get_client: Callable` not dict sharing)
- `_session_clients` dict exclusive to CopilotService

### Migration Plan (4 Sequential Steps)

1. Extract session_client.py → Run tests
2. Extract elicitation_service.py (with `get_client` callback) → Run tests
3. Extract event_processor.py (closure → instance attributes) → Run tests
4. Verify imports, all 77 tests pass

### Test Coverage Gate

The 77 characterization tests serve as the regression suite. All must pass after module split. Tests are designed to verify public behavior, not internal structure, so they should all pass even as internal organization changes.

**Next Phase:** McManus implements 4 sequential extraction steps.

---

### Stage 3 Split Verification (2026-04-12)
Verified McManus's 4-module split of copilot_service.py. Result: **APPROVED**.

**Test updates:** 4 tests in `test_copilot_service.py` updated to access `svc._elicitation_mgr._pending` instead of `svc._pending_elicitations` (internal dict moved to ElicitationManager).

**Key findings:**
- All 48 characterization tests pass after test updates
- All imports (original + new modules) verified working
- No circular imports, no broken cross-references
- `SessionClient` properly re-exported from `copilot_service.py`
- `_safe_enqueue` duplicated in elicitation_service.py and event_processor.py (minor smell, acceptable)
- 17 `test_workflow_serialization` failures are pre-existing (Agent Framework), not caused by split

**Verdict file:** `.squad/decisions/inbox/hockney-split-verdict.md`

---

### Stage 3 Frontend Characterization Tests (2026-04-12)
Wrote 39 characterization tests across 3 new test files + 1 type-level test to pin current frontend behavior before Fenster's restructuring:

**Files created:**
- `frontend/src/api/sessions.test.ts` — 22 tests covering SSE parsing in sendMessage (delta, step, done, usage_info, turn_done, error, mode_changed, elicitation, ask_user), resumeResponseStream (3 tests), fetch body construction (attachments, fleet, agent_mode), edge cases (split chunks, malformed JSON, HTTP errors, no body).
- `frontend/src/api/activeAgents.test.ts` — 4 tests covering subscribeToActiveAgents SSE parsing (update, completed events, error handling, AbortController return).
- `frontend/src/stores/chatStore.stage3.test.ts` — 13 tests covering gaps in existing chatStore.test.ts: setMessages (2), finalizeTurn with queued message ordering (3), latestIntent extraction from report_intent steps (3), elicitation lifecycle (3), askUser lifecycle (1), clearSessionMessages full cleanup (1).
- `frontend/src/types/chatStep.typetest.ts` — Type-level test asserting ChatStep shape (title: string, detail?: string) is identical across all 3 definition sites (types/message.ts, types/session.ts, stores/chatStore.ts). Checked via `tsc --noEmit`.

**Key patterns:**
- Mock fetch + ReadableStream for SSE stream simulation
- `sseChunk()` helper builds properly formatted SSE text
- Zustand store tests use `setState(initialState, true)` for reset (matching existing convention)
- Type tests use conditional types (`AssertExtends`, `AssertEquals`) — no runtime execution needed

**Coverage gaps remaining:**
- ChatPane and InputBox component tests (React rendering) — deferred until Fenster's decomposition plan is final
- No E2E integration of sendMessage → chatStore pipeline (would require full component mount)

---

### Stage 3 Frontend Restructuring Verification (2026-04-12)
Verified Fenster's Stage 3 frontend restructuring. Result: **APPROVED**.

**Verification gates (all 6 passed):**
1. **Frontend tests:** 33 test files, 279 tests — all passed (includes 39 characterization tests)
2. **Vite build:** Clean build in 18.20s, zero errors
3. **TypeScript check:** `tsc --noEmit` clean, zero type errors
4. **ChatStep dedup:** Exactly 1 definition in `types/message.ts` — no duplicates
5. **Import graph:** No circular deps — hooks, sseParser, PinsDrawer all clean
6. **Backend tests:** 108 tests passed — no cross-stack breakage

**Key observation:** The 279 frontend tests vs expected ~57 (39 char + 18 pre-existing) means Fenster added significant test coverage during restructuring — a good sign.

**Verdict file:** `.squad/decisions/inbox/hockney-stage3-verdict.md`

---

### Stage 6 P1 Pre-Implementation Tests (2026-04-13)
Wrote 10 tests in `frontend/src/stores/chatStore.stage6.test.ts` to validate two P1 changes before Fenster implements them:

**Item 1 — State Cleanup (3 tests):**
- `readySessions` initialized in store (not module-level)
- `sessionModes` initialized in store (not module-level)
- `clearSessionState(sessionId)` removes from both collections
- Clearing one session doesn't affect others

**Item 2 — SSE Delta Batching (7 tests):**
- Multiple rapid deltas batched into fewer setState calls (spy on setState)
- `flushStreamingBuffer` immediately applies buffered content
- `finalizeStreaming` (done path) flushes without 50ms delay
- `finalizeTurn` (done path) flushes without 50ms delay
- Buffer cleanup on `clearSessionState` — no dangling timers
- Buffer cleanup on `clearSessionMessages` — no dangling timers
- Final content identical whether batched or unbatched (correctness check)

**Key patterns:**
- `vi.useFakeTimers()` + `vi.advanceTimersByTime(100)` for timer-dependent batching tests
- `vi.spyOn(useChatStore, 'setState')` to verify batching reduces state updates
- Tests are polymorphic over Set/Map/Record for readySessions/sessionModes (Fenster may choose any)
- Tests will fail until Fenster adds `clearSessionState`, `flushStreamingBuffer`, `readySessions`, `sessionModes` to the store

---