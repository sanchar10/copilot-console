# Contributing

For contributors who want to modify the code.

## Prerequisites

| Requirement | Version | How to check |
|---|---|---|
| **Python** | 3.11 – 3.13 | `python --version` |
| **Node.js** | 18+ | `node --version` |
| **GitHub Copilot CLI** | Latest | `copilot --version` |

> **Note:** Python 3.14 is not yet fully supported due to pre-release dependency resolution issues. Use 3.11–3.13.

## Setup

### Option A: Using uv (Recommended)

[uv](https://docs.astral.sh/uv/) is a fast Python package manager that handles venvs automatically.

```powershell
# Clone the repo
git clone https://github.com/sanchar10/copilot-console.git
cd copilot-console

# Install Python dependencies (creates .venv automatically, handles pre-release)
uv sync --prerelease=allow

# Install frontend dependencies
npm install --prefix frontend

# Ensure Copilot CLI is authenticated
copilot login

# Start in development mode
uv run npm run dev
```

> Don't have uv? Install it: `irm https://astral.sh/uv/install.ps1 | iex` (Windows) or `curl -LsSf https://astral.sh/uv/install.sh | sh` (macOS/Linux)

### Option B: Using pip + venv

```powershell
# Clone the repo
git clone https://github.com/sanchar10/copilot-console.git
cd copilot-console

# Create and activate a virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1          # PowerShell
# .venv\Scripts\activate.bat        # Command Prompt

# Install Python dependencies (agent-framework is pre-release, needs --pre)
pip install -e ".[dev]" --pre

# Install frontend dependencies
npm install --prefix frontend

# Ensure Copilot CLI is authenticated
copilot login

# Start in development mode
npm run dev
```

- Frontend: http://localhost:5173 (Vite dev server with HMR)
- Backend: http://localhost:8765 (FastAPI with auto-reload)

> **Why a virtual environment?** The `agent-framework` package is pre-release. Without a venv, it installs into your global Python and can conflict with other projects.

## Running Tests

```powershell
# Backend tests
uv run pytest tests/ --ignore=tests/e2e -q      # uv
python -m pytest tests/ --ignore=tests/e2e -q    # pip (venv activated)

# Frontend tests
npm test --prefix frontend
```

## Building the Package

### CI Release (GitHub Actions)

This repo’s wheel is built by GitHub Actions, not manually on developer machines.

- Workflow: `.github/workflows/release.yml`
- Trigger: push a git tag matching `v*` (for example `v0.5.0`)
- Steps (high level): `npm run build --prefix frontend` → `python -m build --wheel` → create a GitHub Release and attach `dist/*.whl`
- No “build token” is committed/pushed — the workflow uses GitHub Actions’ built-in `GITHUB_TOKEN`.

#### Rebuild the same version (retag)

If you need to regenerate the wheel for the *same* version (without bumping version numbers), force-move the tag to the desired commit and force-push it:

```powershell
git tag -f v0.6.0 <commit_sha>
git push -f origin v0.6.0
```

### Local build (optional)

```powershell
# Build frontend
npm run build --prefix frontend

# Build Python wheel
pip install build
python -m build --wheel

# Output: dist\copilot_console-<version>-py3-none-any.whl
```

## Mobile Companion (Dev Mode)

To test the mobile companion during development:

```powershell
# Start with tunnel (secure — same Microsoft work/school account on phone)
npm run dev -- --expose

# Or with anonymous access (token-secured, no login on phone — recommended for personal accounts)
npm run dev -- --expose --allow-anonymous
```

This starts the backend, frontend, and devtunnel automatically. Open Settings in the desktop UI to see the QR code, then scan it from your phone.

> **Note:** Authenticated mode (`--expose` without `--allow-anonymous`) requires a work or school (Microsoft Entra ID) account on both the server and the phone. Personal Microsoft and GitHub accounts fail on Safari/iOS. Use `--allow-anonymous` if you don't have a corporate account.

## Troubleshooting

### `agent_framework` import errors (e.g., `FunctionTool`, `AIFunction`)

The `agent-framework` package is pre-release. Make sure you installed with pre-release support:

```powershell
uv sync --prerelease=allow           # uv
pip install -e ".[dev]" --pre        # pip
```

If you see `ModuleNotFoundError: No module named 'agent_framework'`, your venv may not be activated (pip) or you may need to prefix with `uv run` (uv).

### `pip install -e .` hangs or fails on Python 3.14

Use Python 3.11–3.13 instead. Python 3.14 has known issues with pre-release dependency resolution.

### Tests fail with `ModuleNotFoundError`

Make sure your venv is activated and you ran `pip install -e ".[dev]" --pre`.

### Frontend build errors

```powershell
cd frontend
npx tsc --noEmit    # Check for TypeScript errors
npm run build       # Full build
```

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS, Zustand, React Router |
| Rendering | React Markdown, Syntax Highlighting, Mermaid diagrams |
| Backend | Python, FastAPI, Uvicorn, Pydantic |
| AI Runtime | GitHub Copilot SDK → Copilot CLI |
| Workflows | Microsoft Agent Framework (declarative YAML pipelines) |
| Streaming | Server-Sent Events (SSE) |
| Notifications | pywebpush (VAPID), Service Worker (PWA) |
| Scheduling | APScheduler |
| Storage | JSON files on disk (no database) |
