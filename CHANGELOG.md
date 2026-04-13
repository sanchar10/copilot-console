# Changelog

## v0.7.0 (2026-04-13)

### Release Summary

v0.7.0 is a substantial release focused on **interactive agent input, mobile parity, and macOS support**. This version introduces ask_user and elicitation—powerful mechanisms that let agents ask you structured questions mid-conversation without interrupting your workflow. On the platform side, we've unified the mobile and desktop experiences, stabilized reconnection resilience, and added comprehensive macOS/Linux contributor support.

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
- **Add auth status UI** — Lock icon, API endpoint status check, non-blocking UX (users can work even if auth unavailable)

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

#### Release
- **Add codebase survey documentation** — Orchestration and architecture notes for future maintainers

---

### 🚀 Platform Support

#### macOS/Linux Support
- **Add install.sh for Unix-like systems** — First-class macOS and Linux support
- **Add caffeinate integration** — Prevent sleep during long-running sessions on macOS
- **Add cross-platform messages** — Consistent user-facing text across Windows, macOS, Linux
- **Add DEV-SETUP.md** — Comprehensive development environment guide for macOS/Linux contributors

