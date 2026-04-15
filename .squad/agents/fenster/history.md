# Fenster — History

## Project Context
- **Project:** Copilot Console — visual management layer for GitHub Copilot CLI
- **Stack:** React / TypeScript / Vite / Tailwind CSS frontend
- **Frontend path:** `frontend/`
- **Build:** `cd frontend && npm run build`
- **Dev:** `cd frontend && npm run dev`
- **User:** sanchar10

## Learnings

### CROSS-TEAM: Keaton Codebase Survey (2026-04-11)
Keaton completed a comprehensive codebase survey. Reference `.squad/agents/keaton/history.md` for:
- Frontend architecture deep-dive (React 19, Zustand stores, API client patterns)
- Component patterns, responsive design, state management conventions
- 10 architectural decisions including Zustand selection rationale
- Test coverage analysis with coverage gaps
- Team responsibilities and constraints

See `.squad/decisions/decisions.md` for architectural decision log.

### Frontend Code Quality Review (2025-07-18)
Completed full review of `frontend/src/`. Key findings:

**Architecture:**
- 12 Zustand stores, generally well-scoped. Cross-store coupling exists between tabStore↔viewedStore and sessionStore↔tabStore.
- SSE events are handled via manual `fetch()` + `ReadableStream` reader (not `EventSource`). Parsing logic duplicated 3×.
- `ChatStep` interface duplicated 5× (including twice in the same file `api/sessions.ts`).
- No app-level error boundary for desktop (mobile has one).

**Critical files (oversized):**
- `InputBox.tsx` (832 lines) — handles too many concerns: session creation, streaming, file upload, slash commands, notifications
- `ChatPane.tsx` (818 lines) — embeds `PinsDrawer` and `SessionTabContent` inline

**SSE & streaming:**
- No reconnection logic for active-agents SSE stream. If connection drops, it stays dead.
- Every SSE delta creates a new Zustand state object — no batching during fast streaming.
- `sendMessage()` has 15 callback parameters — needs an options object refactor.

**State management:**
- `readySessions` and `sessionModes` are module-level `Set`/`Map` outside React — invisible to rendering, never cleaned up.
- `messagesPerSession` grows unboundedly (never pruned on tab close).
- `sendingSessionId` can get stuck if component unmounts during activation.

**Full report:** `.squad/decisions/inbox/fenster-frontend-review.md`

### Phase 1b — Frontend Quick Fixes (2025-07-18)
Completed 5 of 6 items (one was a false positive):

1. **ErrorBoundary** — Created `frontend/src/components/ErrorBoundary.tsx`, wrapped `<App />` in `main.tsx`. Class component catches render errors, shows reload button.
2. **sendingSessionId finally** — Added `finally { setSending(null) }` in InputBox.tsx `handleSubmit`. Removed 45s activation timeout (redundant now that finally guarantees cleanup; backend's own 30s timeout handles hung activation).
3. **fileIcon dedup** — Extracted to `frontend/src/utils/fileIcon.ts`, imported in InputBox.tsx and MessageBubble.tsx.
4. **handleRelatedSessionClick** — Only 1 copy exists in ChatPane.tsx. No dedup needed (false positive from original review).
5. **Fire-and-forget .catch()** — Added `.catch(() => {})` to `apiMarkViewed()` in viewedStore.ts. Other store fetchers (fetchAgents, fetchWorkflows, fetchAutomations) already have internal try/catch.
6. **clearSessionMessages cleanup** — Expanded to also clean `pendingElicitation`, `resolvedElicitations`, and `pendingAskUser` per session. Already called on both tab-close (TabBar.tsx) and session-delete (SessionItem.tsx) paths.

### Stage 3 — Frontend Restructuring (2025-07-18)
Completed 4 items with zero test breakage (279/279 pass):

1. **SSE Parser Extraction** — Created `utils/sseParser.ts` with shared `parseSSEStream()`. Eliminated 3× copy-paste across `api/sessions.ts` and `api/activeAgents.ts`. Added exponential-backoff reconnection to active-agents stream.
2. **ChatStep Deduplication** — Single canonical definition in `types/message.ts`. Removed duplicates from `types/session.ts` and `stores/chatStore.ts` (re-export only). `grep "interface ChatStep"` → exactly 1 result.
3. **Component Decomposition** — InputBox 834→429 lines (extracted `useFileUpload`, `useSlashCommands` hooks). ChatPane 818→588 lines (extracted `PinsDrawer` component, utility functions to `utils/chatUtils.ts`).
4. **Performance** — Added `useMemo` to `splitSegments()` in `StreamingMessage.tsx`.

**Key learning:** `handleSubmit` in InputBox has too many closure dependencies (10+ store hooks, notification callbacks, session creation flow) to safely extract into a separate hook without risking behavior changes. Kept it inline — pragmatic over perfect.

### Stage 6 P1 — State Management Cleanup + SSE Delta Batching (2025-07-18)
Completed both P1 items with zero test breakage (291/291 pass):

1. **State Management Cleanup** — Moved `readySessions` (Set) and `sessionModes` (Map) from module-level singletons in `InputBox.tsx` into `chatStore.ts` (Zustand). Added `markSessionReady`, `setSessionMode`, `isSessionReady`, `getSessionMode`, and `clearSessionState` actions. `clearSessionMessages` now also cleans these. Tab close and session delete paths automatically clean up via existing `clearSessionMessages` calls. Legacy re-exports (`clearReadySession`, `isSessionReady`, `markSessionReady`) kept in InputBox.tsx for backward compat.

2. **SSE Delta Batching** — `appendStreamingContent` now buffers deltas in a module-level array (NOT in Zustand state) and flushes them in a single `setState` call after `DELTA_BATCH_MS` (50ms). `flushStreamingBuffer(sessionId)` forces immediate flush. Called automatically by `finalizeStreaming`, `finalizeTurn`, and the done/error handlers in InputBox + useSession. `getStreamingState` merges unflushed buffer content for accurate reads without triggering extra re-renders. `setStreaming(true)`, `clearSessionMessages`, and `clearSessionState` all clear the buffer to prevent dangling timers.

**Key learning:** Delta batching buffer must be cleaned up on `setStreaming(true)` (not just `false`) because tests reset streaming state between cases. Without this, buffer content leaks across tests. Also, `getStreamingState` must merge unflushed buffer for backward compat — direct `streamingPerSession` access won't see buffered content.

---

## Stage 5 — macOS Support (2026-04-13)

Fenster completed platform-specific keyboard shortcut support for macOS:

1. **Platform Detection** — Detected operating system to show appropriate keyboard shortcut symbols (⌘K on macOS, Ctrl+K on other platforms)

2. **Sidebar.tsx Fix** — Updated keyboard shortcut display in Sidebar component to render platform-appropriate symbols

3. **Cross-Agent Coordination** — Coordinated with McManus to merge changes into single `squad/stage5-macos-support` commit

**Key learning:** Platform detection must happen at component render time for consistent UX across OS boundaries. Keyboard conventions vary significantly (⌘ symbol convention is macOS-specific; other platforms expect Ctrl notation).

### Stage 5 — Marketing Page v0.7.0 Update (2025-07-19)
Updated `docs/index.html` with three changes for v0.7.0:

1. **Install tab switcher** — Added PowerShell/Bash tab buttons in the install section using vanilla JS classList toggles (no framework needed for static page). Updated platform text from "Windows 10/11" to "Windows and macOS/Linux".
2. **Workflows → Ask User section** — Replaced the Workflows feature showcase (Feature 4) with an Interactive Q&A / Ask User section highlighting SDK-driven elicitation. Used `onerror` fallback for the placeholder `screenshots/ask-user.jpg`.
3. **Feature grid expanded to 9 cards** — Added Desktop Notifications, Open With, and Workflows (experimental) cards. Kept first 6 cards with minor copy tweaks for consistency. Workflows demoted to a grid card with `(experimental)` badge.

**Key learning:** The marketing page is static HTML with inline Tailwind via CDN — no build step. Tab switching uses inline `onclick` handlers since there's no JS framework. Use `&amp;` for ampersands in HTML content to avoid validation issues.

### Auth Settings UI — Account Section in SettingsModal (2025-07-19)
Added auth status display to SettingsModal and wired up the sidebar lock icon:

1. **uiStore** — Added `settingsSection: 'auth' | null` field. `openSettingsModal()` accepts optional section param; `closeSettingsModal()` clears it.
2. **Sidebar.tsx** — Lock icon click now calls `openSettingsModal('auth')` instead of TODO comment.
3. **SettingsModal.tsx** — Added "Account" section as first section (above Theme). Shows green connected badge when authenticated, amber "No provider connected" when not. Uses `useAuthStore` for status. Auto-scrolls to auth section via ref + `requestAnimationFrame` + `scrollIntoView` when `settingsSection === 'auth'`.

**Key learning:** `settingsSection` pattern (store a target section identifier, clear on close) is a clean way to support deep-linking into modal sections from multiple entry points. The `requestAnimationFrame` wrapper ensures the DOM is painted before scrollIntoView fires — without it the ref may not be laid out yet in the modal transition.

### Tabbed Settings Modal Redesign (2025-07-20)
Redesigned SettingsModal from a single-scroll layout to 4 horizontal tabs for v0.7.0:

1. **Tab Architecture** — 4 tabs: General, Mobile, Notifications, Authentication. Each tab is a standalone component (`GeneralTab`, `MobileTab`, `NotificationsTab`, `AuthenticationTab`). Tab state managed via `activeTab` local state, auto-selects 'auth' when `settingsSection === 'auth'` from uiStore.

2. **General Tab** — Default Model, Default Working Directory (folder picker), Desktop Notifications toggle, Theme picker. Save/Cancel footer shown only on this tab.

3. **Mobile Tab** — Moved `MobileCompanionSection` here. QR code when devtunnel running, otherwise shows `--expose` message. CLI Notifications toggle disabled when not in expose mode. API Token show/copy/regenerate.

4. **Notifications Tab** — New: lists push notification subscriptions from `GET /api/push/subscriptions` (new backend endpoint). Shows truncated endpoint URLs with Remove buttons. Empty state message when no devices registered.

5. **Authentication Tab** — Full Connect/Disconnect flow. Connect triggers `POST /api/auth/login` SSE stream, parses device code from output lines, shows code card with "Open GitHub" link. Disconnect calls `POST /api/auth/logout`. Uses authStore for status.

6. **Backend** — Added `GET /api/push/subscriptions` endpoint in `push.py` returning `{ subscriptions: [{ endpoint }] }` from existing `push_subscription_service.get_all()`.

**Key learning:** SSE parsing for the auth login flow requires line-by-line buffer management since events arrive as `event:` + `data:` pairs. The device code regex `[A-Z0-9]{4}-[A-Z0-9]{4}` matches GitHub's device flow format. Footer should be conditional per tab — only General needs Save/Cancel since other tabs make instant API calls.
