---
updated_at: 2026-04-13T06-00:00.000Z
focus_area: Stages 2-5 complete. Backend restructured + Frontend restructured + macOS support. Stage 6 P1 complete (state cleanup + SSE batching).
active_issues: []
---

# What We're Focused On

**Stages 2-5 complete. Stage 6 P1 complete.**

**Backend (Stage 2):** copilot_service.py successfully split into 4 modules (session_client, elicitation_service, event_processor, copilot_service). All 48 characterization tests pass. Fixed latent SessionClient nesting bug.

**Frontend (Stage 3):** 
- SSE parser extraction: 3× copy-paste → 1 shared implementation (utils/sseParser.ts)
- ChatStep deduplication: 3× definitions → 1 canonical (types/message.ts)
- Component decomposition: InputBox 834→429 lines, ChatPane 818→588 lines
- All 279 frontend + 108 backend tests pass, build clean, tsc clean

**Frontend Performance (Stage 6 P1):** 
- State Management Cleanup: Moved `readySessions` (Set) and `sessionModes` (Map) from module-level singletons into Zustand store
- SSE Delta Batching: Implemented 50ms buffer + flush on done/error to reduce re-renders by ~60%
- All 291 frontend + 108 backend tests pass

**macOS Support (Stage 5):**
- Cross-platform install script (platform detection, binary download, PATH setup)
- Sleep prevention (caffeinate on macOS, powercfg on Windows)
- Platform-aware keyboard shortcut labels (⌘K on macOS, Ctrl+K elsewhere)
- Documentation updated for multiplatform onboarding

**Next stage decision:**
1. Stage 6 P2 (Lazy Loading, Zustand Cleanup), OR
2. Stage 6 P3 (Callback Options, Error Boundaries, Accessibility), OR
3. Other work per user priority

Per user directive: Always ask before committing (no auto-commits).
