# Contributing

For contributors who want to modify the code.

## Prerequisites

| Requirement | Version | How to check |
|---|---|---|
| **Python** | 3.11 – 3.13 | `python --version` |
| **Node.js** | 18+ | `node --version` |
| **GitHub Copilot CLI** | Latest | `copilot --version` |

> **Note:** Python 3.14 is not yet fully supported due to pre-release dependency resolution issues. Use 3.11–3.13.

### macOS / Linux Setup

**Important:** Do NOT use system Python on macOS (which is often outdated). Install via Homebrew:

```bash
brew install python
```

Verify: `python3 --version` should show 3.11 or higher.

**Node.js:**
```bash
brew install node    # macOS/Linux via Homebrew
```

Or download from [nodejs.org](https://nodejs.org/) for your platform.

**macOS PATH Configuration:**
Homebrew installs to `/opt/homebrew/bin` on Apple Silicon Macs. Add to your `~/.zshrc`:

```bash
export PATH="/opt/homebrew/bin:$PATH"
```

Then reload:
```bash
source ~/.zshrc
```

## Setup

### Clone the repository

```bash
git clone https://github.com/sanchar10/copilot-console.git
cd copilot-console
```

### Frontend Build

```bash
cd frontend
npm install        # TS errors during post-install are harmless — ignore them
npm run build      # If this fails with TS errors, use: npx vite build
cd ..
```

**Note:** `npm run build` runs `tsc -b && vite build`. If TypeScript strict errors block `tsc`, use `npx vite build` directly — Vite bundles without strict type checking.

### Python Install

Modern Python requires a virtual environment. Create one and activate it:

#### macOS & Linux
```bash
python3 -m venv .venv
source .venv/bin/activate
```

#### Windows
```powershell
python -m venv .venv
.venv\Scripts\activate
```

#### Install in editable mode

**Option A: Using uv (Recommended)**

[uv](https://docs.astral.sh/uv/) is a fast Python package manager that handles venvs automatically.

```bash
# Install Python dependencies (creates .venv automatically, handles pre-release)
uv sync --prerelease=allow

# Ensure Copilot CLI is authenticated
copilot login

# Start in development mode
uv run npm run dev
```

> Don't have uv? Install it: `irm https://astral.sh/uv/install.ps1 | iex` (Windows) or `curl -LsSf https://astral.sh/uv/install.sh | sh` (macOS/Linux)

**Option B: Using pip + venv**

```bash
# Install Python dependencies (agent-framework is pre-release, needs --pre)
pip install -e ".[dev]" --pre

# Ensure Copilot CLI is authenticated
copilot login

# Start in development mode
npm run dev
```

> **Why a virtual environment?** The `agent-framework` package is pre-release. Without a venv, it installs into your global Python and can conflict with other projects.

- Frontend: http://localhost:5173 (Vite dev server with HMR)
- Backend: http://localhost:8765 (FastAPI with auto-reload)

> **Note:** In editable dev installs, the packaged `static/` directory doesn't exist. The app automatically falls back to `frontend/dist/` so you don't need to manually copy built assets — just run `npm run build` (or `npx vite build`) in `frontend/` and start the server.

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

## Authentication

Auth is handled in the app UI — the app always opens, no login required upfront. When you first send a message, the UI will prompt you to authenticate if needed.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `python3` still shows 3.9 on macOS | System Python shadows brew | `export PATH="/opt/homebrew/bin:$PATH"` in `~/.zshrc` |
| `externally-managed-environment` error | Modern Python blocks global installs | Use `python3 -m venv .venv` |
| `agent_framework` import errors (e.g., `FunctionTool`, `AIFunction`) | Pre-release package not installed with support | `uv sync --prerelease=allow` (uv) or `pip install -e ".[dev]" --pre` (pip) |
| `ModuleNotFoundError: No module named 'agent_framework'` | venv not activated or missing uv prefix | Verify venv is activated or use `uv run` prefix |
| `pip install -e .` hangs or fails on Python 3.14 | Pre-release dependency resolution issues | Use Python 3.11–3.13 instead |
| Tests fail with `ModuleNotFoundError` | venv not activated or incomplete install | Activate venv and run `pip install -e ".[dev]" --pre` |
| Frontend build errors (TS errors during `npm run build`) | Pre-existing strict TS issues in codebase | Use `npx vite build` instead |
| `frontend/dist not found` at runtime | Frontend was not built | `cd frontend && npx vite build` |
| `pip install -e .` fails with hatchling error | Old pip version (<21.3) | `python3 -m pip install --upgrade pip` |
| `npm: command not found` | Node.js not installed | `brew install node` |
| `copilot-console` command not found | CLI not installed or not in PATH | Verify install: `pip show copilot-console` |

### Still stuck?

- Verify all prerequisites with: `python3 --version`, `node --version`, `npm --version`
- Check that your venv is activated (you should see `(.venv)` in your shell prompt)
- For macOS, confirm `which python3` points to `/opt/homebrew/bin/python3`
- Review error logs carefully — they often mention the root cause
- Ensure you're on the latest `pip`: `python3 -m pip install --upgrade pip`

### Windows Setup

Windows setup is typically simpler since Python and Node.js are usually installed fresh without system version conflicts. Use **PowerShell**:

1. Install Python 3.11+ and Node.js 18+ (use installers or `winget`)
2. Follow the same venv/pip steps above
3. For end-user installation, the `install.ps1` script handles setup automatically

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
