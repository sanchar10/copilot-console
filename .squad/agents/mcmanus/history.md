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

