# MCP Servers

MCP servers provide external tools (e.g., GitHub, databases, internal APIs) that agents can call.

## Config Files

Copilot Console supports two MCP configs:

- **Global (shared with Copilot CLI):** `C:\Users\<username>\.copilot\mcp-config.json`
- **App-only:** `C:\Users\<username>\.copilot-console\mcp-config.json`

## Enable MCP Servers in the UI

- In **Agent Editor**, select which MCP servers the agent should have.
- In **Session Settings**, you can override per session.

Keep MCP selections minimal — only enable what the session needs.

## OAuth Authentication

MCP servers that require OAuth (e.g., GitHub MCP, hosted SaaS connectors) sign in directly from Copilot Console — no need to drop into a terminal.

**Sign-in flow**

1. Add or enable an OAuth-capable MCP server in the config.
2. Open the **MCP Selector** (in chat or Session Settings). Servers needing sign-in show a yellow status badge.
3. Click the server to start the OAuth flow. Your browser opens to the provider's consent page.
4. After approval, the badge turns green and the server's tools become available in the same session — no restart required.

**Per-server status badges**

Each MCP server in the selector shows a live status indicator:

- 🟢 **Connected** — server is up, tools are callable.
- 🟡 **Sign-in required** — OAuth token missing or expired. Click to (re)authenticate.
- 🔴 **Error** — server failed to start or returned an error. Hover for details.

**Auto-recovery on token expiry**

When an OAuth token expires mid-session, Copilot Console detects the failure, flips the badge to yellow, and shows a sticky banner. Click the badge (or the banner action) to re-sign-in without losing the session — the server reconnects and the next tool call goes through.

## Troubleshooting

- If a server doesn't show up, validate the JSON config and restart Copilot Console.
- If tools appear but calls fail, check the server's own logs and credentials.
- If an OAuth server is stuck on yellow, click it to retry sign-in. If the browser window doesn't open, check that pop-ups are allowed for `localhost`.
