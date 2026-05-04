# Changelog

## v0.8.5 (DRAFT — not yet released)

### Release Summary

v0.8.5 ships the in-app **`/help` slash command** backed by a hand-validated **FAQ.md** that the help agent reads first, plus a global **Cmd/Ctrl+K SearchModal** for cross-session search. It pins **`github-copilot-sdk==0.3.0`** so SDK changes can't break the build mid-week, and tightens dozens of UX details across MCP, sub-agents, mobile, and chat. Sessions whose history can no longer be loaded by the Copilot CLI now show a clear **"⚠ Session history unavailable"** banner with a one-line CLI-fallback recovery instead of a silent blank pane. The offline-detection layer was removed in favor of a simpler server-truth-only model.

---

### ✨ Features

#### `/help` & Documentation
- **`/help` slash command** — opens a dedicated help session backed by a `help-assistant` agent that reads `docs/guides/FAQ.md` first, then the per-feature guides shipped under `~/.copilot-console/docs/`
- **`docs/guides/FAQ.md`** — new, hand-validated FAQ covering sessions, agents, models, MCP, custom tools, workflows, automations, mobile, special cards, settings, and error banners. Every answer was code-validated against the implementation.
- **WORKFLOWS.md merge** — duplicate `docs/Workflows.md` removed; single source of truth at `docs/guides/WORKFLOWS.md`

#### Global Search & Layout
- **Cmd/Ctrl+K SearchModal** — fast cross-session search from anywhere
- **Global banner system** — unified surface for sticky cross-session notices

#### MCP Servers — Full UI Control
- **New MCP Servers settings tab** — create, edit, enable/disable, and delete MCP servers without editing config files
- **Canonical-source backend** — single source of truth for MCP server config; settings endpoint exposes per-server enabled state
- **Auto-enable defaults** — sensible servers are turned on out of the box for new installs
- **Reset OAuth button** — one-click recovery from stale OAuth tokens (e.g. EACCES port collisions) without manually deleting `~/.copilot/mcp-oauth-config/`
- **Persistent per-server OAuth status badge** in the MCP picker — click a failed badge to re-trigger sign-in
- **Cold-only OAuth readiness gate** — sessions only block on OAuth when servers actually need it
- **Global OAuth event bus + sticky toasts** — sign-in prompts persist across tab switches and survive reloads
- **MCP picker UX** — shortened "app" / "App" labels, tighter badge slots, persistent connection dot

#### Agent Framework Workflows
- **AF declarative features exposed** — Human-in-the-Loop, TryCatch nodes, PowerFx guard expressions, YAML overlay visualization, event styling
- **AF-GHCP / SDK 0.3.0 shim** — keeps the Agent Framework working against the latest Copilot SDK
- **Seed workflow rename** — `feature-tour` → `mood-topic-poem`, `feature-tour-advanced` → `workflow-feature-advanced`; new `backend-feature-kickoff.yaml` seed
- **Removed `emoji-poem` workflow + Emoji Illustrator agent** from seed data
- **WorkflowEditor + WorkflowRunView upgrades** — sticky failure toasts, run timeline polish
- **PowerFx guard tests + visualize overlay tests**

#### Sessions & Sub-Agents
- **Model + agent picker refinements** — clearer sub-agent enablement flow; agents added via the Sub-Agents picker now appear in `/agent`
- **Session-history-unavailable banner** — when the Copilot CLI's `session resume` rejects a session.jsonl (typically written by an older CLI build), an in-chat amber banner explains the cause and points to `copilot --resume <id>` as a CLI-side workaround. No more silent blank panes.

#### Mobile Companion
- **SSE handling fixes** — robust reconnect on backgrounding/network changes
- **OAuth + network state alignment** — mobile no longer races the desktop on auth state

#### Chat & Messages
- **Better loading UX** — Session/Context message tooltips
- **MessageBubble polish** — long system messages wrap instead of overflowing; thinner system divider ticks give text more width
- **Sub-agent events surfaced as chat steps** — `subagent.started/completed/failed` now appear in the chat timeline
- **Toast UX** — distinct error icon, no auto-dismiss on body click

#### Slash Commands & UX
- **`/compact` simplified** — Phase 5 cleanup; MCP gate skipped when no servers configured
- **Reasoning text from SDK** — uses native `reasoning_text` field; dropped legacy system_notification filter

---

### 🧹 Removed

- **Offline-detection layer** — `useNetworkStatus`, `network_probe.py`, `health.py` router, offline banner, and store wiring are gone (~210 LOC removed). The app now trusts the server as the source of truth for connectivity, which is simpler and more accurate than client-side probing.
- **`approve_all_permissions` try/except shim** — no longer needed against current SDK
- **`emoji-poem` workflow + Emoji Illustrator seed agent**
- **Duplicate `docs/Workflows.md`** — content merged into `docs/guides/WORKFLOWS.md`

---

### 🔒 Pinning

- **`github-copilot-sdk==0.3.0`** — pinned exactly so SDK API changes can't silently break a release. Bump deliberately when validating against a new SDK.
- **Bundled CLI** — the SDK ships with its own bundled Copilot CLI; `npm install -g @github/copilot` in the installers remains unpinned (latest is fine).

---

### 🐛 Bug Fixes

- **Installer (Windows): CLI version display** — `install.ps1` no longer prints the entire version line when the regex doesn't match; falls back to `"unknown"` cleanly
- **Installer (Windows): no longer kills the host PowerShell session on error** — `install.ps1` now uses `throw` instead of `exit 1`, so when invoked via `irm | iex` from an interactive prompt the user is returned to the prompt with the error message instead of having the entire `powershell` window close
- **Workflow engine: fresh installs failed with `'WorkflowCopilotAgent' object has no attribute called 'run'`** — root cause: `agent-framework` and its `github-copilot` / `declarative` plugins were hidden behind a `[workflows]` extra that the installer scripts never enabled, so fresh `pipx install` runs got no AF at all. For users who had AF cached from prior installs, the unconstrained `>=1.0.0rc2` floated up to AF 1.2.x where `BaseContextProvider` was renamed `ContextProvider` — old AF-GHCP `b260225` raises `ImportError`, the workflow engine's `except ImportError` substitutes a stub `GitHubCopilotAgent` with no `.run()` method, and AF's declarative runner crashes calling `.run()`. Fix: promoted the three packages to base `dependencies` and pinned to the exact known-good versions (`agent-framework==1.0.0rc2`, `agent-framework-github-copilot==1.0.0b260225`, `agent-framework-declarative==1.0.0b260219`) so fresh installs always get a coherent set. Newer AF-GHCP releases (`b260311`–`b260429`) hard-pin `github-copilot-sdk==0.2.1` and are incompatible with our `github-copilot-sdk==0.3.0` requirement, so a forward-jump is not currently viable.
- **MCP OAuth recovery** — picker badges now reflect real server state; click-to-retrigger works without a session restart
- **Mobile SSE/OAuth races** — fixed inconsistent state on resume from background

---

### 🧪 Tests

- MCP OAuth coordinator + retrigger endpoint + selector badges
- EventBus pub/sub, replay buffer, slow-subscriber drop
- PowerFx guard + workflow visualize overlay
- `/help` service: FAQ.md priority + fallback to guides

---

### 📦 Installation

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.ps1 | iex
```

```bash
# macOS / Linux (Bash)
curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash
```

```powershell
# Or manual install with pipx
pipx install --force https://github.com/sanchar10/copilot-console/releases/download/v0.8.5/copilot_console-0.8.5-py3-none-any.whl
```

---

## v0.8.1 (2026-04-21)

### 🐛 Bug Fixes

- **Model listing resilience** — raw RPC fallback when SDK `list_models()` fails due to server-side API changes (ModelBilling schema)
- **Updated default models** — fallback list now includes gpt-4.1, gpt-5.2, gpt-5-mini, claude-sonnet-4.5, claude-opus-4.5, claude-haiku-4.5
- **UTF-8 encoding** — all JSON file operations now specify `encoding="utf-8"` to prevent Windows cp1252 crashes
- **Resume stream callbacks** — `onElicitation` and `onAskUser` now wired in `resumeResponseStream` for tab-close/refresh recovery
- **Release build** — workflow uses root `npm run build` to include `sync-seed-docs` step

---

### 📦 Installation

```powershell
# One-line installer (recommended)
irm https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.ps1 | iex

# Or manual install with pipx
pipx install --force https://github.com/sanchar10/copilot-console/releases/download/v0.8.1/copilot_console-0.8.1-py3-none-any.whl
```

---

## v0.8.0 (2026-04-20)

### Release Summary

v0.8.0 brings **slash commands, unified session settings, and project-aware sessions**. The `/agent` slash command lets you pick an agent persona before or during a session. `/compact` now works seamlessly across new, resumed, and active sessions. When you filter the sidebar by project, new sessions automatically start in that project's folder — with a toast confirming the working directory.

---

### ✨ Features

#### Slash Commands & Session Settings
- **Two-level `/agent` picker** — browse agents by source, select and change the agent persona for the session; works on new and active sessions
- **Unified session settings matrix** — `/compact` and `/agent` persist to `session.json` and work correctly across new, resumed, and active session lifecycles
- **Deferred compact with SSE events** — compact runs post-first-turn with step events streamed to the UI

#### Chat & Messages
- **Timestamps on chat messages** — each message header shows a right-aligned timestamp; `event_id` propagated through the event pipeline
- **Server-confirmed agent names** — agent switch messages use the name returned by the server, with error handling if missing

#### Project-Aware New Sessions
- **New sessions use project folder** — when the sidebar project filter is set to a specific project, "New Session" uses that project's folder as CWD instead of the default
- **Folder existence validation** — checks the project folder via browse endpoint before use; falls back to default with a warning toast if the folder is missing
- **Multi-line info toast** — shows session working directory, project name, and full folder path

---

### 🐛 Bug Fixes

- Fix slash command palette height and dark background contrast (`#2f2f45`)
- Fix duplicate agent switch messages on resumed sessions
- Fix agent selection with `'default'` sentinel and case-insensitive guard
- Fix mode indicator reading from `session.json` on tab reopen
- Fix model switching on resumed sessions via `rpc.model.switch_to()`
- Fix model persistence to `session.json` for resumed sessions
- Remove duplicate compact UI messages; drain SDK events post-compact
- Fix compact error logging at warning level for server visibility
- Remove toast notification for `/agent` on new session (avoids premature toast)
- Right-align timestamps in chat message headers

---

### 📖 Documentation

- Update marketing page: slash commands section with `/agent` picker screenshot, side-by-side layout
- Update README feature table for slash commands
- Add slash command & session settings architecture spec

---

### 📦 Installation

```powershell
# One-line installer (recommended)
irm https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.ps1 | iex

# Or manual install with pipx
pipx install --force https://github.com/sanchar10/copilot-console/releases/download/v0.8.0/copilot_console-0.8.0-py3-none-any.whl
```

See [README](https://github.com/sanchar10/copilot-console#readme) for full setup instructions.

---

## v0.7.0 (2026-04-15)

### Release Summary

v0.7.0 is a substantial release focused on **interactive agent input, mobile parity, macOS support, and auth overhaul**. This version introduces ask_user and elicitation—powerful mechanisms that let agents ask you structured questions mid-conversation without interrupting your workflow. On the platform side, we've unified the mobile and desktop experiences, redesigned settings with a tabbed layout, stabilized auth detection across providers, and added comprehensive macOS/Linux support.

---

### ✨ Features

#### Interactive Agent Input (ask_user & elicitation)
- **Add ask_user support end-to-end** — Agents can now send simple text questions with Submit/Skip UX
- **Add MCP elicitation support** — Rich structured input via JSON schema (text fields, dropdowns, checkboxes, required field validation)
- **Add desktop notifications for input requests** — Users are alerted when agents ask a question (includes session tab open action)
- **Render markdown in question messages** — Question text supports bold, italic, and code formatting
- **Preserve ask_user/elicitation Futures on reconnect** — Pending questions are restored when you reconnect; interact with them to resume
- **Add ElicitationCard and ResolvedElicitationCard components** — Styled cards for rendering and tracking input state

#### Auth & Security
- **Auth overhaul with 3-source fallback** — SDK auth → functional probe → `gh auth status` CLI fallback. No more false "not authenticated" for users who authenticated via `gh auth login`
- **Fix Windows subprocess crash** — Replace `asyncio.create_subprocess_exec` (broken on Windows + Python 3.14) with `subprocess.run` via `asyncio.to_thread`
- **Auth status shows provider and username** — Settings displays "GitHub Copilot (username)" instead of generic "Connected"
- **Provider-agnostic auth terms** — "Connect" / "Disconnect" instead of "Sign in" / "Sign out" (future multi-provider ready)

#### Settings Redesign
- **4-tab settings modal** — Authentication, General, Mobile, Notifications tabs with deep-linking
- **Sidebar lock icon** — Inline 🔒/🔓 emoji after Settings text shows auth status at a glance
- **CLI notifications moved to Notifications tab** — Previously in Mobile tab; now grouped with Registered Devices
- **Auth tab shows inline lock icons** — Emoji locks matching sidebar for visual consistency

#### "Open with" Session Folder
- **Add "Open with" dropdown** — Open session folder in VS Code, Terminal, or Explorer from the sidebar
- **Fix VS Code shell launch** — Use shell=True on Windows for proper shell integration
- **Fix terminal launch on Windows** — Use CREATE_NEW_CONSOLE instead of deprecated cmd start
- **Fix PowerShell compatibility** — Sessions folder opens correctly in PowerShell

#### Agent Management
- **Priority-based agent dedup and sectioned dropdown** — Multiple agents of the same type are deduplicated; sub-agents are organized by section (Copilot, Custom, Workspace)
- **Unified agent discovery across 4 sources** — Agents from CLI config, workspace, npm scripts, and Copilot SDK are unified with priority-based dedup

#### Audio & Notifications
- **Add audio tones for events** — Configurable notification sounds
- **Add desktop notifications for agent responses** — Alerts when agents complete work (in addition to input requests)

#### Code Blocks & UI Polish
- **Add copy button on code blocks with language label** — Easy code sharing; shows syntax language
- **Compact input box height** — Streamlined input UX with adjusted button icons
- **Show live intent + bouncing dots in input box during streaming** — Visual feedback while agent is thinking
- **Render ask_user/elicitation as styled Q&A in steps** — Interactive questions appear as polished cards with dividers

---

### 🐛 Bug Fixes

#### Frontend State & Connectivity
- **Fix race condition in resolve_elicitation** — Prevent duplicate future pop crashes
- **Fix mobile duplicate streaming** — Abort POST /messages reader to prevent message re-send on reconnect
- **Fix mobile stuck streaming state on resume** — Properly clear streaming lock after reconnect
- **Fix mobile response-status field name mismatch** — Align API field names with state machine expectations
- **Fix stale agent badge count and CWD change confirmation** — Session counts update correctly when working directory changes

#### ask_user/elicitation Lifecycle
- **Cancel pending interactions on disconnect/reconnect** — Clean up futures to prevent stale card renders
- **Clear ask_user/elicitation cards on desktop abort** — Dismiss cards when you abort a session
- **Clear pending ask_user/elicitation on mobile abort** — Mobile cleanup matches desktop behavior
- **Fix ask_user Skip to send cancel signal** — Skip button matches CLI Esc behavior (sends cancellation)
- **Disable mobile textarea during pending ask_user/elicitation** — Prevent accidental input while agent awaits response
- **Gray background for mobile input during pending interaction** — Visual indicator that input is temporarily disabled
- **Fix mobile ask_user/elicitation using mobileApiClient** — Use correct client for interaction endpoints

#### Mobile UX & Rendering
- **Fix mobile enqueue state**: Clear sending lock on first SSE event, allow send during streaming
- **Auto-expand steps accordion while streaming on mobile** — Steps are visible as agent works
- **Improve mobile step parser** — Cleaner tool summaries, no raw JSON fragments in output
- **Move StepsAccordion border to bottom** — Separator between steps and content for clarity
- **Move mobile steps above content** — Match desktop step ordering
- **Trim leading whitespace from mobile message content** — Cleaner text rendering
- **Distinguish intentional abort from stream errors** — Proper error messaging on mobile
- **Fix notification click to open session tab** — Even if tab is closed, notification reopens it
- **Fix mobile input during streaming** — 3-state design with activation, thinking, and enqueue support

#### Elicitation/ask_user Internals
- **Fix missing @router decorator on send_message endpoint** — Backend routing error fixed
- **Fix ChatPane test mock for elicitation state** — Test infrastructure updated
- **Update _pending_elicitations refs after service split** — Use ElicitationManager correctly after refactoring
- **Remove redundant cancel_pending_elicitations calls** — Eliminate duplicate cancellation logic
- **Remove leftover .bak file** — Cleanup temporary file
- **Fix turn boundary for streaming** — Use assistant.turn_end instead of assistant.message

#### Error Handling & Toast System
- **Fix contextual error messages** — Error messages are now informative and actionable
- **Fix file upload toast** — User feedback on upload state changes
- **Add toast system + self-healing sub-agent cleanup** — Automatic cleanup on working directory change

#### Session Management
- **Mark session viewed after abort** — Prevent false unread indicator
- **Mark session ready on active response reconnect** — Session state is accurate on resume
- **Move markViewed to active-agents completion callback** — Centralized view tracking

#### Utilities & Dependencies
- **Remove unused common/Select.tsx** — Replaced by custom Dropdown component (no loss of functionality)

---

### ♻️ Refactoring

#### Frontend Architecture (Stage 3)
- **Extract SSE parser to shared utility** — `utils/sseParser.ts` eliminates 3× copy-paste parsing code
- **Deduplicate ChatStep definition** — Single canonical definition in `types/message.ts`; re-exports elsewhere
- **Decompose InputBox.tsx** — Extract `useFileUpload` and `useSlashCommands` hooks (834 → 429 lines)
- **Decompose ChatPane.tsx** — Extract PinsDrawer and utilities (818 → 588 lines)
- **Add exponential-backoff reconnection** — Robust retry logic for active-agent subscriptions

#### Backend Architecture (Stage 2)
- **Backend service restructuring** — Modularize copilot_service.py into focused, testable units

#### Component Cleanup
- **Migrate all native select elements to custom Dropdown** — Consistent, keyboard-accessible dropdown UX
- **Replace sidebar project list native select with Dropdown** — Unified component everywhere

#### TypeScript Strict Mode
- **Resolve 6 pre-existing TypeScript strict errors** — Clean strict:true compilation

---

### 📱 Mobile

#### Input & Interaction
- **Mobile ask_user and elicitation support** — Full parity with desktop; cards render responsively
- **Mobile input: pulsating dots + "Thinking..." with amber background** — Visual feedback while agent streams
- **Remove redundant chat area pulsating dots on mobile** — Single clear indicator
- **Disable mobile textarea during pending ask_user/elicitation** — User-friendly state blocking

#### Streaming & State
- **Fix mobile duplicate streaming by aborting POST /messages reader** — Prevent re-sends
- **Fix mobile stuck streaming state on resume stream error** — Proper error recovery
- **Mobile input: 3-state design with activation, thinking, and enqueue** — Smooth state transitions
- **Fix mobile enqueue: clear sending lock on first SSE event** — Allow send during streaming

#### Step Rendering
- **Auto-expand steps accordion while streaming** — Real-time visibility
- **Improve mobile step parser** — Cleaner summaries, no JSON fragments
- **Move StepsAccordion border and mobile steps above content** — Better UX order
- **Trim leading whitespace from mobile message content** — Polished output

#### Reconnect & Cleanup
- **Restore ask_user card on reconnect via response-status pending_input** — Pending questions are preserved
- **Revert cancel-on-navigate experiments, keep clean mobile state** — Stable cancel logic
- **Switch mobile cancel from sendBeacon to fetch with keepalive** — Reliable cancellation

---

### 🏗️ Architecture

#### Core Refactoring
- **Stage 3 frontend restructuring** — SSE parser consolidation, ChatStep dedup, component decomposition
- **Stage 2 backend restructuring** — Modular service design with clear boundaries

#### Revert & Stabilization
- **Revert system CLI override, use SDK-bundled CLI only** — Simplify dependency management
- **Revert unnecessary replay changes** — Keep clean state machine transitions
- **Revert desktop to original step rendering** — Mobile has dedicated parser; desktop unchanged
- **Migrate desktop MessageBubble to shared stepParser** — Shared logic, desktop behavior preserved

#### Code Cleanup
- **Clean up dead ask_user/elicitation code** — Remove obsolete functions and references
- **Migrate desktop MessageBubble to shared stepParser** — Eliminate parser duplication
- **Migrate mobile steps rendering with shared step parser** — Unified parsing across platforms

---

### 📝 Documentation

#### Setup & Contributing
- **Add DEV-SETUP.md for macOS/Linux contributor setup** — Step-by-step guide for setting up development environment on Unix systems
- **Stage 5 — macOS support** — Install script, caffeinate integration, cross-platform messages
- **Add frontend/dist fallback for editable dev installs** — Support development workflow when frontend isn't pre-built

#### Cross-Platform Documentation
- **Remove Windows bias from all docs** — README, INSTALL, CONTRIBUTING now use `shell` fences, forward-slash paths, and platform-neutral language
- **Cross-platform uninstall instructions** — `pip uninstall` (universal) with `pipx` note, plus platform-specific data removal commands
- **ripgrep as required prerequisite** — Moved from optional to required in install docs; labeled "for session content search"
- **Console Guide agent tip** — Added to "First Things to Try" in README
- **Eliminate seed docs duplication** — Seed docs are now build-generated (via `sync-seed-docs.js`), gitignored, and no longer maintained as separate copies

#### Release
- **Add codebase survey documentation** — Orchestration and architecture notes for future maintainers

---

### 🚀 Platform Support

#### macOS/Linux Support
- **Add install.sh for Unix-like systems** — First-class macOS and Linux support
- **Add caffeinate integration** — Prevent sleep during long-running sessions on macOS
- **Add cross-platform messages** — Consistent user-facing text across Windows, macOS, Linux
- **Add DEV-SETUP.md** — Comprehensive development environment guide for macOS/Linux contributors

