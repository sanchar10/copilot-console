# Manual Installation

## Pre-Requisites

Before installing Copilot Console, ensure the following are available. All commands below can be run in either **PowerShell** or **Command Prompt**.

| Requirement | Version | How to check |
|---|---|---|
| **Windows** | 10 or 11 | — |
| **Python** | 3.11 or higher | `python --version` |
| **Node.js** | 18 or higher | `node --version` |
| **GitHub Copilot CLI** | 0.0.410+ | `copilot --version` |
| **GitHub Copilot subscription** | Active | [github.com/settings/copilot](https://github.com/settings/copilot) |
| **devtunnel** *(optional)* | Latest | `devtunnel --version` |

### Step 1: Install Python

Download from [python.org](https://www.python.org/downloads/). During installation, **check "Add Python to PATH"**.

Verify:
```powershell
python --version    # Should show 3.11+
pip --version       # Should work
```

### Step 2: Install Node.js

Download from [nodejs.org](https://nodejs.org/) (LTS version recommended).

Verify:
```powershell
node --version      # Should show 18+
npm --version       # Should work
```

### Step 3: Install GitHub Copilot CLI

The Copilot CLI is the runtime that Copilot Console communicates with. Install it globally:

```powershell
npm install -g @github/copilot
```

Verify:
```powershell
copilot --version   # Should show 0.0.410 or later
```

Authenticate with GitHub (required before first use):
```powershell
copilot login
```

### Step 4: Install devtunnel (Optional — for Mobile Companion)

Only needed if you want to access Copilot Console from your phone via `--expose`.

**Option A: winget (Windows 10/11)**
```powershell
winget install Microsoft.devtunnel
```

**Option B: npm (any platform)**
```powershell
npm install -g @msdtunnel/devtunnel-cli
```

Then authenticate:
```powershell
devtunnel user login
```

Verify:
```powershell
devtunnel --version
```

---

## Installation

### Option A: pipx (Recommended)

[pipx](https://pipx.pypa.io/) installs Python applications in isolated environments and automatically adds them to PATH.

```powershell
# Install pipx if not already installed
pip install --user pipx
python -m pipx ensurepath
# Close and reopen the terminal after this

# Install Copilot Console
pipx install https://github.com/sanchar10/copilot-agent-console/releases/latest/download/copilot_console-py3-none-any.whl
```

> **Tip:** If you have [uv](https://docs.astral.sh/uv/) installed, you can use `uv tool install` in place of `pipx install` for faster setup.

### Option B: pip

```powershell
pip install https://github.com/sanchar10/copilot-agent-console/releases/latest/download/copilot_console-py3-none-any.whl
```

> **Note:** If `copilot-console` is not found after install, your Python scripts directory may not be on PATH. Option A (pipx) handles this automatically.

## Verify Installation

```powershell
copilot-console --version
```

## Running

```powershell
copilot-console
```

This starts the server and opens the UI in your default browser. Press `Ctrl+C` to stop.

Common options:

```powershell
copilot-console                      # Start with defaults
copilot-console --no-sleep           # Prevent Windows from sleeping
copilot-console --port 8787          # Use a specific port
copilot-console --expose --no-sleep  # Mobile access + prevent sleep
```

Run `copilot-console --help` for all options.

## Updating

When a new version is available, the app shows a banner with the install command. To update manually:

```powershell
pipx install --force https://github.com/sanchar10/copilot-agent-console/releases/latest/download/copilot_console-py3-none-any.whl
```

## Uninstalling

```powershell
pipx uninstall copilot-console
```

This removes the application but keeps session data and settings in `~/.copilot-console/`. To remove everything:

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.copilot-console"
```
