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

