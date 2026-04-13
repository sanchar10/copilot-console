# Developer Setup Guide

A step-by-step guide for contributors building Copilot Console from source on macOS, Linux, and Windows.

## Prerequisites

### Python 3.11+
**Important:** Do NOT use system Python on macOS (which is often outdated). Install via Homebrew:

```bash
brew install python
```

Verify: `python3 --version` should show 3.11 or higher.

### Node.js 18+
```bash
brew install node    # macOS/Linux via Homebrew
```

Or download from [nodejs.org](https://nodejs.org/) for your platform.

Verify: `node --version` and `npm --version`

### GitHub Copilot CLI
```bash
npm install -g @github/copilot
```

### macOS PATH Configuration
Homebrew installs to `/opt/homebrew/bin` on Apple Silicon Macs. Add to your `~/.zshrc`:

```bash
export PATH="/opt/homebrew/bin:$PATH"
```

Then reload:
```bash
source ~/.zshrc
```

## Clone & Setup

```bash
git clone https://github.com/sanchar10/copilot-console.git
cd copilot-console
```

## Frontend Build

```bash
cd frontend
npm install        # TS errors during post-install are harmless — ignore them
npm run build      # If this fails with TS errors, use: npx vite build
cd ..
```

**Note:** `npm run build` runs `tsc -b && vite build`. If TypeScript strict errors block `tsc`, use `npx vite build` directly — Vite bundles without strict type checking.

## Python Install

Modern Python requires a virtual environment. Create one and activate it:

### macOS & Linux
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### Windows
```powershell
python -m venv .venv
.venv\Scripts\activate
```

### Install in editable mode
```bash
pip install -e .
```

> **Note:** In editable dev installs, the packaged `static/` directory doesn't exist. The app automatically falls back to `frontend/dist/` so you don't need to manually copy built assets — just run `npm run build` (or `npx vite build`) in `frontend/` and start the server.

### Optional: Agent Framework (for workflow support)
```bash
pip install agent-framework --pre
```

## Run

```bash
copilot-console
```

If the command is not in PATH, run via Python module:
```bash
python -m copilot_console.cli
```

### Authentication

Auth is handled in the app UI — the app always opens, no login required upfront. When you first send a message, the UI will prompt you to authenticate if needed.

For CLI-based auth (optional convenience):
```bash
copilot-console login
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `python3` still shows 3.9 on macOS | System Python shadows brew | `export PATH="/opt/homebrew/bin:$PATH"` in `~/.zshrc` |
| `externally-managed-environment` error | Modern Python blocks global installs | Use `python3 -m venv .venv` |
| `frontend/dist not found` at runtime | Frontend was not built | `cd frontend && npx vite build` (the app auto-detects `frontend/dist/` in dev mode) |
| `pip install -e .` fails with hatchling error | Old pip version (<21.3) | `python3 -m pip install --upgrade pip` |
| `npm: command not found` | Node.js not installed | `brew install node` |
| TS errors during `npm run build` | Pre-existing strict TS issues in codebase | Use `npx vite build` instead |
| `copilot-console` command not found | CLI not installed or not in PATH | Verify install: `pip show copilot-console` |

## Windows Setup

Windows setup is typically simpler since Python and Node.js are usually installed fresh without system version conflicts. Use **PowerShell**:

1. Install Python 3.11+ and Node.js 18+ (use installers or `winget`)
2. Follow the same steps above (venv, pip install, frontend build)
3. For end-user installation, the `install.ps1` script handles setup automatically

## Troubleshooting

### Still stuck?

- Verify all prerequisites with: `python3 --version`, `node --version`, `npm --version`
- Check that your venv is activated (you should see `(.venv)` in your shell prompt)
- For macOS, confirm `which python3` points to `/opt/homebrew/bin/python3`
- Review error logs carefully — they often mention the root cause
- Ensure you're on the latest `pip`: `python3 -m pip install --upgrade pip`
