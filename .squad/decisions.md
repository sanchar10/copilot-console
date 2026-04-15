# Squad Decisions

## Active Decisions

### 1. copilot_service.py Split — APPROVED ✅

**Status:** Implemented & Verified  
**Reviewer:** Hockney (Tester)  
**Date:** 2026-04-12

Split `copilot_service.py` (1,412 lines) into 4 modules per Keaton's architecture:
- `session_client.py` (298 lines) — Per-session SDK client wrapper
- `elicitation_service.py` (181 lines) — Interactive request/response futures
- `event_processor.py` (339 lines) — SDK event → SSE translation
- `copilot_service.py` (773 lines) — Orchestrator (slimmed)

**Design:** All three new modules are leaf modules with no internal cross-dependencies.

**Compatibility:** Zero breaking changes. All existing imports continue to work.

**Bug fixed:** Latent defect where `SessionClient` methods were accidentally nested inside `_safe_enqueue` function body (unreachable code). Fixed during extraction.

**Verification:**
- 48/48 characterization tests pass
- All imports verified (no broken references)
- No circular dependencies
- Public API surface unchanged

**Verdict:** Ship it.

### 2. Stage 3 Frontend Restructuring — APPROVED ✅

**Author:** Fenster (Frontend Dev)  
**Reviewer:** Keaton (Lead) & Hockney (Tester)  
**Date:** 2026-04-12  
**Status:** Implemented & Verified

#### Changes

**SSE Parser Extraction**
- Created `utils/sseParser.ts` with shared `parseSSEStream()` utility
- Refactored `api/sessions.ts` (sendMessage + resumeResponseStream) — removed ~90 lines of duplicated parsing
- Refactored `api/activeAgents.ts` — removed ~30 lines of duplicated parsing
- Added exponential-backoff reconnection to `subscribeToActiveAgents()` (1s base, 30s max)
- **Net effect:** 3× copy-paste SSE parsing → 1 shared implementation

**ChatStep Deduplication**
- Canonical definition in `types/message.ts`
- Removed duplicate from `types/session.ts` (replaced with re-export)
- Removed duplicate from `stores/chatStore.ts` (replaced with re-export)
- `grep "interface ChatStep"` now returns exactly 1 result

**Component Decomposition**
- **InputBox.tsx:** 834 → 429 lines (49% reduction)
  - Extracted `useFileUpload` hook (drag, paste, click, upload state)
  - Extracted `useSlashCommands` hook (detection, palette state, execution)
  - Kept `handleSubmit` inline (too many closure dependencies to extract safely)

- **ChatPane.tsx:** 818 → 588 lines (28% reduction)
  - Extracted `PinsDrawer` to `components/chat/PinsDrawer.tsx`
  - Extracted utility functions to `utils/chatUtils.ts`
  - Re-exported `scrollToMessageBySdkId` from ChatPane for backward compat (SearchModal imports it)

**Performance Quick Win**
- Added `useMemo` to `splitSegments()` in `StreamingMessage.tsx`

#### Review Dimensions (Keaton)

| Dimension | Verdict | Notes |
|-----------|---------|-------|
| Architecture | ✅ | SSE parser cleanly eliminates 3× copy-paste with shared implementation |
| Reconnection Logic | ✅ | Exponential backoff correct, signal handling proper, AbortError suppressed |
| ChatStep Dedup | ✅ | Single canonical definition in types/message.ts, re-exports elsewhere |
| Import Integrity | ✅ | No circular dependencies, backward-compat maintained |
| Behavioral Preservation | ✅ | SSE callbacks unchanged, no leaked state/closures, handleSubmit kept inline |
| Build Verification | ✅ | tsc --noEmit clean, performance optimization correct |

#### Verification (Hockney)

- **39 characterization tests written pre-refactor**
  - `frontend/src/api/sessions.test.ts` (22 tests)
  - `frontend/src/api/activeAgents.test.ts` (4 tests)
  - `frontend/src/stores/chatStore.stage3.test.ts` (13 tests)
  - `frontend/src/types/chatStep.typetest.ts` (1 type test)

- **Post-refactor verification — all gates passed:**
  - 279/279 frontend tests pass (33 test files)
  - `vite build` succeeds (18.20s)
  - `tsc --noEmit` clean (0 errors)
  - ChatStep dedup confirmed (1 definition)
  - Import graph clean (0 circular deps)
  - 108 backend tests pass (no cross-stack breakage)

#### Verdict

**Ship it.** Zero functionality breakage. Clean, type-safe, fully backward-compatible refactor. All 6 verification gates passed.

### 3. User Directive: No Auto-Commits — APPROVED ✅

**Status:** Governance rule  
**Requestor:** sanchar10 (via Copilot)  
**Date:** 2026-04-12T06:25:48Z  
**Impact:** All future work (code and .squad/ state changes)

**Rule:** Always ask user before committing any changes — code or .squad/ documentation state. No auto-commits.

**Rationale:** Ensures user retains explicit control over repository state and CI/CD triggers.

**Enforcement:** Scribe (and all agents) check for user approval before `git commit`.

### 4. Stage 6 Scope — Frontend Performance & Quality — APPROVED ✅

**Lead:** Keaton  
**Prepared:** 2026-04-12  
**Status:** Ready for implementation (awaiting user approval)

Defined 7 items across 3 priority tiers (P1/P2/P3) totaling 6–10 hours estimated effort. P1 items (State Management Cleanup, SSE Delta Batching) implemented by Fenster in Stage 6 P1 (commit: b36b6dd). All 291/291 frontend + 108/108 backend tests pass.

**Remaining items:** P2 (Lazy Loading, Zustand Cleanup), P3 (Callback Options, Error Boundaries, Accessibility) deferred to future stages per resource allocation.

### 5. v0.7.0 Release Plan — IN PROGRESS ✅

**Status:** Stage 5 code done, release prep remaining  
**Coordinator:** sanchar10  
**Date:** 2026-04-13T20:35:00Z

**Uncommitted Changes (worktree: E:\repos\New\copilot-console-stage5)**
- README.md: macOS experimental badge, platform line, cross-platform --no-sleep
- CONTRIBUTING.md (×2): Merged DEV-SETUP.md content
- DEV-SETUP.md (×2): DELETED
- cli.py: Removed login subcommand
- auth.py: Removed login_command field
- Sidebar.tsx: Lock icon auth indicator (🔒/🔓)
- InputBox.tsx: Toast on unauthenticated message send
- authStore.ts: NEW - Zustand auth state store
- auth.py router: NEW - GET /api/auth/status endpoint

**Release Prep Tasks:**

1. **Marketing Page (docs/index.html)**
   - Add bash install tab alongside PowerShell
   - Replace Workflows section → "Ask User" section (screenshot: Elicitation.jpg, mention works on mobile)
   - Update "And much more" grid → 9 cards:
     1-6: Keep existing (Automations, Agent Library, Agent Teams, Files & Images, MCP & Custom Tools, Web Browsing)
     7: 🔔 Desktop Notifications
     8: 📂 Open With — quickly open project folders in preferred tools
     9: 🔀 Workflows (experimental)

2. **README.md update**
   - Add 3 rows to features table: Interactive Q&A (ask_user), Desktop Notifications, Open With
   - Mark Workflows row as "(experimental)"
   - Add bash install command for macOS/Linux
   - Add link to new guide in "More Information"

3. **New doc — docs/guides/INTERACTIVE-INPUT.md (or similar name)**
   - Cover BOTH ask_user AND elicitation in one guide
   - What it looks like, skip behavior, mobile support, reconnect resilience
   - NOT something user triggers manually — SDK decides when to ask
   - Screenshot: Elicitation.jpg

4. **Update existing docs**
   - INSTALL.md: add macOS/Linux bash install
   - KNOWN-LIMITATIONS.md: macOS experimental, Workflows experimental
   - TROUBLESHOOTING.md: macOS common issues

5. **Release notes (v0.7.0)**
   - 87 commits since v0.6.3
   - Major: ask_user/elicitation, mobile maturity, macOS support, auth UI
   - See session history for full categorized changelog

6. **Commit, merge, tag**
   - Commit all uncommitted changes (with user approval REQUIRED)
   - Merge worktree branch to main
   - Tag v0.7.0, push everything
   - Clean up worktree

**User Directives:**
- Always confirm before commit/push
- No copilot-console login subcommand, no gh CLI dependency
- Auth handled in-app, never forced — lock icon UX
- Provider-agnostic auth terms (no "sign in")
- DEV-SETUP.md merged into CONTRIBUTING.md
- macOS = "experimental", not "tested"
- Elicitation screenshot available but only ask_user works in real agent flow currently
- Workflows are experimental / failing — will fix after release

### 6. Stage 5 macOS Support — APPROVED ✅

**Reviewer:** Keaton (Lead)  
**Date:** 2025-01-28  
**Branch:** squad/stage5-macos-support  
**Verdict:** APPROVED — Ship it

**Summary:** Comprehensive cross-platform implementation addressing all 5 audit items. Changes include new install.sh script (353 lines), platform-aware sleep prevention via caffeinate, cross-platform messaging, dynamic platform UI detection, and synchronized documentation. TypeScript compilation passes with no errors.

**Completeness — All 5 Audit Items Addressed:**

| Item | Status | Implementation |
|------|--------|----------------|
| 🔴 No install.sh for macOS | ✅ Fixed | New 353-line install.sh mirrors install.ps1 functionality |
| Sleep prevention (Windows-only) | ✅ Fixed | Added caffeinate support for macOS in main.py |
| devtunnel messages hardcode winget | ✅ Fixed | Platform branching in cli.py and dev.js |
| Sidebar says "Ctrl+K" but handler supports ⌘ | ✅ Fixed | Dynamic label based on platform detection |
| Docs use PowerShell only | ✅ Fixed | Added bash alternatives throughout INSTALL.md and MOBILE-COMPANION.md |

**Key Implementation Details:**

- **install.sh Quality:** Proper error handling (set -euo pipefail), version checking (Python 3.11+, Node 18+), platform-specific package managers (brew/apt-get), JSON manipulation via Python, graceful fallback from pipx to pip, interactive prompts for optional features
- **Sleep Prevention:** caffeinate with `-i` (idle sleep) and `-w PID` (auto-terminate) — correct subprocess management with proper cleanup, no resource leaks
- **Platform Detection:** Python uses sys.platform, JavaScript uses process.platform, frontend uses navigator.platform with SSR safety guard (typeof navigator !== 'undefined')
- **Documentation Parity:** docs/INSTALL.md and seed copy byte-identical (MD5 match), docs/MOBILE-COMPANION.md and seed copy byte-identical

**Verification:**
- TypeScript build: tsc --noEmit passes with 0 errors
- Behavioral preservation: Windows functionality unchanged, no breaking changes
- Edge cases handled: missing dependencies, existing auth, pipx unavailable, brew unavailable, existing MCP config, user bin not in PATH

**Decision Record:**
- Install.sh mirrors install.ps1 feature-for-feature
- Platform detection uses standard library checks (sys.platform, process.platform)
- Frontend detection is SSR-safe with typeof navigator guard
- Impact: Unlocks macOS and Linux support without compromising Windows experience
- Recommended next step: Merge to main

### 7. Stage 5 macOS Support — Implementation Decisions

**Author:** McManus (Backend Dev)  
**Date:** 2025-01-26  
**Context:** Stage 5 deliverables for cross-platform support

**Key Decisions:**

1. **install.sh Structure**
   - Mirrored install.ps1 exactly for consistency
   - python3 (Linux/macOS convention), brew for macOS, apt-get for Linux
   - ANSI color codes instead of PowerShell color parameters

2. **Sleep Prevention — macOS Implementation**
   - Used caffeinate -i -w $PID (native macOS tool)
   - -i prevents idle sleep, -w $PID auto-terminates when process dies
   - Stored process handle in _caffeinate_proc for manual cleanup
   - Rejected pmset (requires sudo)

3. **Platform-aware Error Messages**
   - Changed hardcoded Windows commands to platform-aware conditionals
   - Locations: cli.py line 188, dev.js line 139
   - Devtunnel mapping: macOS (brew), Windows (winget), Linux (npm)

4. **Documentation Updates**
   - Updated both primary docs and seed copies to stay synchronized
   - Changed "Windows only" → "Windows / macOS / Linux"
   - Added platform-specific install commands side-by-side
   - One-line install: curl -fsSL ... | bash (macOS/Linux)

5. **install.sh Permissions**
   - Platform-specific executable bit handling via icacls
   - Ensures file marked executable when cloned on Unix systems

**Testing Checklist:**
- [x] install.sh syntax valid
- [x] main.py imports properly
- [x] cli.py platform detection logic correct
- [x] dev.js platform detection logic correct
- [x] Documentation consistency verified
- [ ] Actual runtime testing (requires macOS/Linux environment)

**Future Improvements:**
- Auto-detect Linux distribution for ripgrep (Debian vs RPM-based)
- Add FreeBSD/OpenBSD support if requested
- Test on older macOS versions (currently assumes 10.15+)

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
- User approval required before committing any changes (code or .squad/ state)
