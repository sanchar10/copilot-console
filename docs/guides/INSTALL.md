# Manual Installation

## Pre-Requisites

Before installing Copilot Console, ensure the following are available. All commands below can be run in either **PowerShell** or **Command Prompt** (Windows) or **Terminal** (macOS/Linux).

| Requirement | Version | How to check |
|---|---|---|
| **Windows / macOS / Linux** | Windows 10/11 or macOS 10.15+ or Linux | — |
| **Python** | 3.11 or higher | `python --version` (Windows) or `python3 --version` (macOS/Linux) |
| **Node.js** | 18 or higher | `node --version` |
| **GitHub Copilot CLI** | Latest | `copilot --version` |
| **GitHub Copilot subscription** | Active | [github.com/settings/copilot](https://github.com/settings/copilot) |
| **devtunnel** *(optional)* | Latest | `devtunnel --version` |
| **ripgrep** | Latest | `rg --version` |

### Step 1: Install Python

Download from [python.org](https://www.python.org/downloads/). The one-line installer automatically detects Python even if it's not on PATH. For manual installation on Windows, check "Add Python to PATH" during the Python installer.

> **macOS/Linux Note:** Use `python3` and `pip3` on macOS/Linux.

Verify:
```bash
# Windows
python --version       # Should show 3.11+
python -m pip --version  # Should work

# macOS/Linux
python3 --version      # Should show 3.11+
python3 -m pip --version  # Should work
```

### Step 2: Install Node.js

Download from [nodejs.org](https://nodejs.org/) (LTS version recommended).

Verify:
```bash
node --version      # Should show 18+
npm --version       # Should work
```

### Step 3: Install GitHub Copilot CLI

The Copilot CLI is the runtime that Copilot Console communicates with. Install it globally:

```bash
npm install -g @github/copilot
```

Verify:
```bash
copilot --version   # Should show latest
```

Authenticate with GitHub (required before first use):
```bash
copilot login
```

### Step 4: Install devtunnel (Optional — for Mobile Companion)

Only needed if you want to access Copilot Console from your phone via `--expose`.

**Windows:**
```powershell
winget install Microsoft.devtunnel
```

**macOS:**
```bash
brew install --cask devtunnel
```

**Linux:**
```bash
curl -sL https://aka.ms/DevTunnelCliInstall | bash
```

Then authenticate:
```bash
devtunnel user login
```

> **Which account?** Use a **work or school (Microsoft Entra ID) account** for the best experience on all platforms. Personal Microsoft and GitHub accounts fail on Safari/iOS. If you don't have a work/school account, you can skip login and use `--allow-anonymous` mode instead — see [Mobile Companion](MOBILE-COMPANION.md#security).

Verify:
```bash
devtunnel --version
```

---

## Quick Install

**Windows:**
```powershell
irm https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash
```

The installer checks dependencies, installs Copilot Console, ripgrep, and optionally configures mobile access and web browsing.

The installer automatically detects Python and Node.js even if they're not on PATH, and fixes PATH issues for you.

---

## Manual Install

If the quick installer doesn't work or you prefer manual installation:

### Step 5: Install Copilot Console

### Option A: pipx (Recommended)

[pipx](https://pipx.pypa.io/) installs Python applications in isolated environments and automatically adds them to PATH.

```shell
# Install pipx if not already installed
python -m pip install --user pipx      # Use python3 on macOS/Linux
python -m pipx ensurepath              # Use python3 on macOS/Linux
# Close and reopen the terminal after this

# Install Copilot Console (replace URL with latest .whl from Releases page)
pipx install https://github.com/sanchar10/copilot-console/releases/download/v<VERSION>/copilot_console-<VERSION>-py3-none-any.whl
```

> **Example** (v0.8.2):
> ```
> pipx install https://github.com/sanchar10/copilot-console/releases/download/v0.8.2/copilot_console-0.8.2-py3-none-any.whl
> ```

> **Tip:** Get the latest wheel URL from the [Releases page](https://github.com/sanchar10/copilot-console/releases/latest). Note the tag uses `v` prefix (e.g., `v0.8.2`) but the wheel filename does not. Or use the one-click installer from the main README which always fetches the latest version automatically.

### Option B: pip

```shell
python -m pip install https://github.com/sanchar10/copilot-console/releases/download/v<VERSION>/copilot_console-<VERSION>-py3-none-any.whl
```

> **Note:** If `copilot-console` is not found after install, your Python scripts directory may not be on PATH. Option A (pipx) handles this automatically.

### Step 6: Install ripgrep (for session content search)

**Windows:**
```powershell
winget install BurntSushi.ripgrep.MSVC
```

**macOS:**
```bash
brew install ripgrep
```

**Linux:**
```bash
sudo apt-get install ripgrep
```

Verify:
```bash
rg --version
```

### Step 7: Install Agent Framework (Optional)

**Optional** — only needed for workflow orchestration. Copilot Console works fully without it.
Clicking **Workflows** in the app will also show a dialog with the install command for your OS if you haven't install it with below steps.

Agent Framework is pre-release and needs the `--pre` flag:

**Windows:**
```shell
python -m pip install agent-framework --pre
```

**macOS / Linux:**
```shell
python3 -m pip install agent-framework --pre
```

If you used pipx, also inject it into the pipx venv:
```bash
pipx inject copilot-console agent-framework --pip-args="--pre"
```

After installing, restart Copilot Console for the changes to take effect.

## Verify Installation

```bash
copilot-console --version
```

## Running

```bash
copilot-console
```

This starts the server and opens the UI in your default browser. Press `Ctrl+C` to stop.

Common options:

```bash
copilot-console                      # Start with defaults
copilot-console --no-sleep           # Prevent system from sleeping
copilot-console --port 8787          # Use a specific port
copilot-console --expose --no-sleep  # Mobile access + prevent sleep
```

Run `copilot-console --help` for all options.

## Optional: CLI Session Notifications

Get notified on your phone when any Copilot CLI terminal session finishes — even sessions started from the terminal outside Console.

Enable from the command line:
```shell
cli-notify on
```

Or toggle it in **Console Settings** (gear icon → CLI Notifications).

To disable:
```shell
cli-notify off
```

## Optional: Agentic Web Browsing (Playwright MCP)

Enable autonomous web navigation by adding the [Playwright MCP server](https://github.com/microsoft/playwright-mcp). It uses your system browser (Edge or Chrome) — no extra browser install needed.

### Add to MCP config

Add the following to `~/.copilot-console/mcp-config.json` (create it if it doesn't exist). If the file already has content, add `playwright` inside the existing `mcpServers` object:

```json
{
  "mcpServers": {
    "playwright": {
      "type": "local",
      "command": "npx",
      "tools": ["*"],
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

Once configured, enable the Playwright MCP server in any session's settings to use web browsing.

## Using the Installed Copilot CLI (instead of Bundled)

Copilot Console ships with a bundled Copilot CLI binary inside the SDK package. This bundled version may lag behind the latest installed CLI — for example, newer models may only be available in the latest CLI.

To use your system-installed Copilot CLI instead of the bundled one, set the `COPILOT_CLI_PATH` environment variable:

**PowerShell (current session):**
```powershell
$env:COPILOT_CLI_PATH = "copilot"
```

**PowerShell (persistent):**
```powershell
[System.Environment]::SetEnvironmentVariable("COPILOT_CLI_PATH", "copilot", "User")
```

**macOS / Linux:**
```bash
export COPILOT_CLI_PATH=copilot
# To persist, add to ~/.bashrc or ~/.zshrc
```

Then restart Copilot Console. You can verify which CLI is in use from **Settings → General** — the version info at the bottom shows the Copilot SDK version, CLI version, and whether the CLI source is **Bundled** or **Installed**.

> ⚠️ **Compatibility Warning:** The bundled CLI is tested with the SDK version shipped in Copilot Console. When using an installed CLI, there is a risk of compatibility issues if the installed CLI version is significantly ahead of the bundled one — the SDK protocol or RPC methods may have changed, which can cause unexpected errors or features to stop working. If you experience issues, remove the `COPILOT_CLI_PATH` environment variable to revert to the bundled CLI.

## Updating

When a new version is available, the app shows a banner with the install command. To update manually:

```shell
pipx install --force https://github.com/sanchar10/copilot-console/releases/download/<VERSION>/copilot_console-<VERSION>-py3-none-any.whl
```

## Uninstalling

```shell
# Disable CLI notifications (if enabled)
cli-notify off

# Remove Copilot Console
python -m pip uninstall copilot-console       # Windows
python3 -m pip uninstall copilot-console      # macOS/Linux
```

> **Note:** If you installed with `pipx`, use `python -m pipx uninstall copilot-console` instead to also clean up the isolated environment.

This removes the application but keeps session data and settings in `~/.copilot-console/`. To remove everything:

**Windows (PowerShell):**
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.copilot-console"
```

**macOS / Linux:**
```bash
rm -rf ~/.copilot-console
```
