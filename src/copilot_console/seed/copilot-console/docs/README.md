# Copilot Console

Orchestrate local GitHub Copilot multi-agent sessions, workflows, and automations from a unified control center with live activity.

![Copilot Console](https://img.shields.io/badge/Copilot-Console-blue?style=flat-square)
![Windows](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square&logo=windows)
![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square)
![License MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

![Main Interface](docs/screenshots/mainscreen-color.jpg)

> 🌐 **[Visit the Copilot Console website →](https://sanchar10.github.io/copilot-console)** for a full feature showcase with screenshots and demos.

A visual management layer on top of [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli). Built with the [Copilot Python SDK](https://github.com/github/copilot-sdk).

> **Platform:** Windows only (tested on Windows 10/11). Releases pending for macOS/Linux.

---

## Features

| | Feature | Description |
|---|---|---|
| 🖥️ | **Visual Session Management** | Multiple sessions in a tabbed interface with per-session context management: system prompt, model, tools, MCP servers, agents, and working directory |
| 🔀 | **Workflows** | Multi-agent YAML pipelines using [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) — chain agents deterministically and watch events stream in real-time |
| ⚡ | **Slash Commands & Fleet** | Type `/` for command palette — `/fleet` fires parallel sub-agents, `/compact` compresses context, `/help` for quick reference. Inline chips with auto-complete |
| ⏰ | **Automations** | Cron-scheduled agent runs with a Runs dashboard and live session access |
| 📂 | **Project Facilitation** | Folder-based session filtering, cross-session search with keyword highlighting, pin responses with notes |
| 🤖 | **Agent Library** | Reusable agent personalities with custom prompts, models, tools, and MCP servers |
| 🤝 | **Agent Teams** | Compose agents into teams with automatic delegation to specialized sub-agents |
| 🌐 | **Agentic Web Browsing** | Autonomous web navigation via bundled Playwright MCP server |
| 🔌 | **MCP Servers** | Global and app-level MCP config with per-session server / tool toggling |
| 🔧 | **Custom Tools** | Drop Python functions into `~/.copilot-console/tools/` to easily create selectable agent tools |
| 📎 | **Files & Images** | Drag-and-drop files and paste images into messages to give agents visual and textual context |
| 🎨 | **Rich Rendering** | Markdown, syntax highlighting, Mermaid diagrams, streaming, reasoning steps |

---

## 📱 Mobile Companion

Access Copilot Console sessions from your phone — get push notifications when agents finish, monitor progress, and reply on the go. No more waiting at a terminal for agent responses. Install as a PWA for a native-like experience.

<img src="docs/screenshots/mobile/mobile-session.jpeg" alt="Mobile Companion" height="350">

Start Copilot Console with `--expose --no-sleep`, scan the QR code from Settings on your phone, and you're set. See [Mobile Companion](docs/guides/MOBILE-COMPANION.md).

---

## 🔔 Copilot CLI Session Notifications

**Works for native CLI sessions.** Get notified on your phone when *any* Copilot CLI terminal session finishes. Continue the conversation from mobile.

<img src="docs/screenshots/cli.jpg" alt="CLI with notifications enabled" height="250">

Enable via `cli-notify on` from the command line, or toggle in Console Settings. A standalone feature for CLI users even without using Console.

---

## Quick Install

One command to install (or upgrade):

```powershell
irm https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.ps1 | iex
```

Then start:
```
copilot-console
```

> For manual setup, upgrading, or uninstalling, see **[Manual Installation](docs/guides/INSTALL.md)**.

### First Things to Try

1. **Start a session** — Click `+` in the sidebar to create a new conversation.
2. **Try Fleet Mode** — Type `/fleet analyze this codebase for security issues` to fire parallel sub-agents.
3. **Pin a response** — Hover over an agent response and click 📌 to save it with an optional note. Browse pins from the drawer.
4. **Search across sessions** — Use the search bar in the sidebar to find anything across all conversations.
5. **Create an agent** — Go to **Agents**, click **+ New Agent**, configure a system prompt, model, and tools.
6. **Build a micro-app** — Go to **Agents** → **Dev Lead** → **New Session**, pick a starter prompt, and watch a 6-agent team build a full-stack app.
7. **Run a workflow** — Go to **Workflows**, open **Emoji Poem** or **Codebase Health Check**, click **▶ Run**.
8. **Go mobile** — Run `copilot-console` with `--expose`, scan the QR code from Settings on your phone, and continue from anywhere.

---

## Command Line Options

```
copilot-console [OPTIONS]

Options:
  --port, -p PORT    Port to run the server on (default: 8765)
  --host HOST        Host to bind to (default: 127.0.0.1)
  --no-browser       Don't automatically open browser on start
  --no-sleep         Prevent Windows from sleeping while running
                     (useful when scheduled tasks need to run overnight)
  --expose           Enable remote access via devtunnel for mobile companion
  --allow-anonymous  Allow anonymous tunnel access (token-secured, no login on phone). Recommended only for testing. Requires --expose.
  --version, -v      Show version and exit
```

### Examples

```powershell
# Run on a custom port
copilot-console --port 9000

# Run without opening browser
copilot-console --no-browser

# Keep PC awake for overnight scheduled tasks
copilot-console --no-sleep

# Enable mobile companion (secure — requires same Microsoft work/school account on phone)
copilot-console --expose

# Enable mobile companion (anonymous — token-secured, no login on phone)
copilot-console --expose --allow-anonymous
```

---

## Configuration

All data is stored in `C:\Users\<username>\.copilot-console\`:

```
.copilot-console\
├── settings.json        # Default model, working directory
├── mcp-config.json      # MCP server configurations (global)
├── sessions\            # Session metadata and settings
├── agents\              # Agent library definitions
├── workflows\           # Workflow YAML definitions
├── workflow-runs\       # Workflow run history and working directories
├── automations\         # Automation definitions
├── task-runs\           # Automation run history
├── tools\               # Custom Python tools (drop .py files here)
├── mcp-servers\         # Drop-in MCP server scripts (stdio / local)
├── logs\                # Application logs
└── viewed.json          # Read/unread tracking
```

---

## More Information

- [Manual Installation](docs/guides/INSTALL.md) — Step-by-step setup, updating, and uninstalling
- [Sessions](docs/guides/SESSIONS.md) — Tabs, modes, attachments, and persistence
- [Agent Library](docs/guides/AGENT-LIBRARY.md) — Creating agents and launching sessions
- [Agent Teams](docs/guides/AGENT-TEAMS.md) — Composing agents with sub-agents
- [Workflows](docs/guides/WORKFLOWS.md) — Multi-agent YAML pipelines
- [Automations](docs/guides/AUTOMATIONS.md) — Cron-driven agent runs
- [MCP Servers](docs/guides/MCP-SERVERS.md) — Configuring and toggling MCP servers
- [Custom Tools](docs/guides/CUSTOM-TOOLS.md) — Creating tools with Tool Builder or manually
- [Mobile Companion](docs/guides/MOBILE-COMPANION.md) — Phone access via secure tunnel
- [Packaged Samples](docs/guides/SAMPLES.md) — Pre-built agents, workflows, and automations
- [Troubleshooting](docs/guides/TROUBLESHOOTING.md) — Common issues and compatibility
- [Known Limitations](docs/guides/KNOWN-LIMITATIONS.md) — Current limitations and workarounds
- [Contributing](docs/guides/CONTRIBUTING.md) — Development setup, building, and testing

---

## License

MIT
