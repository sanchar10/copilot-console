# FAQ — Copilot Console

> **Purpose.** This FAQ captures cross-cutting "how do I X?" and "why does Y look broken?" questions that span multiple features, plus non-obvious UI states. The per-feature guides under `docs/guides/` cover the depth — this file fills the gaps between them.
>
> **Used by `/help`.** The in-app help assistant reads this file first, then falls back to the per-feature guides. Keep entries short — short answer, then a `→ See:` deep-link to the relevant guide.

---

## Getting started

### How do I know if I'm signed in to Copilot?
Look at the Settings button at the bottom of the sidebar — the icon at the right side of it is `⏳` while the auth check is in flight, `🔒` when signed in, `🔐` when not signed in. Hover the button to see "Authenticated via {provider}", "Checking auth...", or "No auth configured". To sign in, click Settings — if you're not signed in, the modal opens straight to the **Authentication** tab where the **Sign in** button starts the device-code flow without leaving the app.
→ See: [INSTALL.md](INSTALL.md)

### Why does Settings open straight to "Authentication" sometimes?
That happens automatically when the auth check has returned `authenticated === false`. Once you're signed in, opens land on **General** (unless something deep-linked you to a specific tab).

### What's the fastest way to find an old session?
Press **Ctrl+K** (Windows/Linux) or **⌘K** (macOS) anywhere in the app, or click the magnifier in the sidebar header, to open cross-session search.

### Where does my data live on disk?
Everything is under `~/.copilot-console/`:
- `sessions/` — chat history and session metadata
- `agents/` — your custom agents
- `workflows/` and `workflow-runs/` — workflow YAMLs and their run history
- `automations/` and `task-runs/` — automations and their scheduled-run history (grouped by date)
- `mcp-servers/`, `tools/` — MCP definitions and custom Python tools
- `settings.json`, `metadata.json`, `projects.json` — top-level config
- `docs/` — bundled documentation (overwritten on every app version bump)
- `logs/` — runtime logs

You can override the root path with the `COPILOT_CONSOLE_HOME` environment variable.

---

## Sessions

### What's the difference between **New**, **Resumed**, and **Active** sessions?
- **New** — you clicked "New Session" but haven't sent a message. No backend session exists yet; settings (model, mode, etc.) are stored locally and applied with the first send.
- **Resumed** — you opened an existing session tab. The backend record is loaded but no SDK subprocess is running yet.
- **Active** — at least one message has been sent; the SDK subprocess is live. Runtime setting changes fire RPC calls immediately.

If a setting change on a Resumed session doesn't appear to do anything yet, that's expected — it's stored locally and applied when the next message activates the SDK.
→ See: [slash-command-architecture.md](../slash-command-architecture.md), [SESSIONS.md](SESSIONS.md)

### Why does the chat header say "session is activating…" and disable some controls?
Whenever a message is being sent on a New or Resumed session, the SDK subprocess is being spun up. The CWD selector and a few other controls are disabled until activation finishes ("Please wait, session is activating…"). It usually clears in a few seconds. If it doesn't, close the tab and reopen the session, or restart the app.

### Why does changing CWD, MCP servers, tools, system prompt, or sub-agents look like it "resets" the session?
Those five settings can't be changed inside a live SDK session, so the Console destroys the current client when any of them changes; the next message recreates it with the new config. Conversation history on disk is preserved — only the in-memory subprocess is recycled.
→ See: [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md)

### Can I change the system prompt mid-session?
No — the system prompt is fixed at session creation. The model *can* be changed mid-session via the model selector. To use a different system prompt, start a new session.
→ See: [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) (System Prompt Cannot Be Changed After Session Creation)

### Why does the New Session tab appear at the far right?
It's rendered after all existing tabs so you can keep working in your current session while you configure the next one. Closing the New Session tab cancels new-session mode.

### What does the "Active Agents" counter in the sidebar mean?
It's the number of sessions currently streaming a response (the SDK subprocess is generating output), not the number of open tabs. The count comes from a live SSE stream of buffered responses.

### Where are projects/folders defined and how do they filter the sidebar?
Each session has a CWD; the sidebar derives a project name from each unique CWD. The project filter dropdown only appears once you have sessions across **2 or more** distinct folders. Selecting a project also defaults the CWD for the next New Session.

---

## Agents & Sub-Agents

### I only see "Copilot (default)" in the `/agent` picker — how do I add more?
The `/agent` picker only lists agents you've enabled as **sub-agents** in this session. To enable some, click the **Sub-Agents** button (👥) in the chat header and check the agents you want. They'll then appear in the `/agent` submenu.
→ See: [AGENT-LIBRARY.md](AGENT-LIBRARY.md), [AGENT-TEAMS.md](AGENT-TEAMS.md)

### Why is the Sub-Agents button missing from the chat header?
It only renders when at least one agent has been discovered. The Console scans four locations on startup:
- `~/.copilot-console/agents/` (your in-app library, labeled **App**)
- `~/.copilot/agents/*.md` (labeled **Copilot Global**)
- `~/.github/agents/*.agent.md` (labeled **GitHub Global**)
- `<cwd>/.github/agents/*.agent.md` (labeled **GitHub CWD**)

If all four are empty the button is hidden. Add at least one agent (Sidebar → Agents → New) to bring it back.
→ See: [AGENT-LIBRARY.md](AGENT-LIBRARY.md)

### What do the source-section labels in the Sub-Agents dropdown mean?
- **App** — agents in `~/.copilot-console/agents/` (Console-managed, JSON format)
- **Copilot Global** — `~/.copilot/agents/*.md` (also visible to the Copilot CLI itself)
- **GitHub Global** — `~/.github/agents/*.agent.md`
- **GitHub CWD** — `.github/agents/*.agent.md` inside the session's working directory

Sections only appear when they actually contain agents. If the same agent name exists in multiple sources, the higher-priority source wins (CWD > App > Copilot Global > GitHub Global).

### Why did selecting a custom tool disable the Sub-Agents button (or vice versa)?
The Copilot CLI silently drops `custom_agents` whenever a session also has `tools` set, so the UI enforces mutual exclusion to prevent silent breakage. Clear all selections in one category to re-enable the other. Sub-agents themselves *can* still have their own tools — the limitation is at the parent session level only.
→ See: [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) (Tools and Sub-Agents Are Mutually Exclusive)

### Why don't excluded built-in tools work the way I'd expect with sub-agents?
They propagate too aggressively. Excluding `create`/`powershell`/`edit` on a parent agent strips those tools from every sub-agent it dispatches to, even if the sub-agent's own whitelist would include them. Don't use `excluded_tools` on agents that have sub-agents — guide delegation through the prompt instead.
→ See: [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) (Excluded Tools Propagate to Sub-Agents)

### Can a sub-agent itself have sub-agents?
No. Only leaf agents (no sub-agents of their own) are eligible for the sub-agent role. This is a Copilot CLI / SDK constraint.
→ See: [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) (Sub-Agents Cannot Be Nested)

### Why isn't my agent showing up in the Sub-Agents dropdown?
A sub-agent must have all of: a non-empty description, a non-empty system prompt, **no** custom tools, **no** excluded built-in tools, **no** sub-agents of its own, and not be the parent agent itself. Ineligible agents are filtered out of the dropdown.
→ See: [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) (Sub-Agent Eligibility Requirements)

### Can each sub-agent run on a different model?
No — all sub-agents inherit the parent session's model. The SDK has no per-sub-agent model override yet.
→ See: [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) (No Per-Agent Model Override for Sub-Agents)

### How do I deselect an agent and go back to plain "Copilot"?
Open `/agent` again — the first option is **Copilot (default)**. Select it to clear the active agent for upcoming turns.

---

## Slash commands

### What slash commands exist and when do I use each?
Type `/` in the chat input (with no spaces yet) to open the palette. The current commands are:
- `/help <question>` — ask the in-app help assistant. Runs locally; doesn't touch the active session.
- `/fleet <prompt>` — fan out the prompt you type after the chip across multiple parallel sub-agent runs.
- `/compact` — compact the active session's context (frees tokens by summarizing earlier turns). Runs immediately on Active sessions; queued on New/Resumed.
- `/agent` — open a submenu to switch the active sub-agent for upcoming turns.

### Why does typing `/` not show the palette sometimes?
The palette only opens when the input starts with `/` **and** contains no space. Once you type a space (or paste text with spaces), the palette closes — either the input becomes a chip for a known prompt-style command (`/fleet <prompt>`, `/help <question>`) or it falls back to a normal message.

### Why did `/compact` say "📦 Compact: queued — will run when session activates"?
Compact requires a live SDK subprocess. If you trigger it on a New or Resumed session, the Console stores it as a pending action and runs it the moment the next message activates the session.
→ See: [slash-command-architecture.md](../slash-command-architecture.md)

### Why does the `/agent` submenu only show "Copilot (default)"?
You haven't enabled any sub-agents in this session. Open the **Sub-Agents** button (👥) in the chat header and select some — they'll then appear in the `/agent` submenu alongside the default.

### Why does `/fleet` not send anything until I type a prompt?
`/fleet` is a "prompt" command — selecting it shows a chip and waits for you to describe the parallelizable task. Press Enter to dispatch it.

---

## Models & modes

### Why won't the model picker open?
The picker won't open when its models list is empty. That usually means the initial `/api/models` fetch failed — most often because the Copilot CLI isn't authenticated. Sign in via **Settings → Authentication** and reload the app.

### Why does picking a different model also change "reasoning effort"?
Each model carries its own `default_reasoning_effort`. When you select a model, the picker shows that model's default unless you explicitly choose a different effort. Some models (e.g., the GPT-5 family) ship with paired effort tiers, so the displayed effort can change as you switch models.

### What are the **Interactive**, **Plan**, and **Autopilot** modes?
The mode selector (💬 / 📋 / 🚀 in the chat header) sets the SDK's `agent_mode` for the next message. The exact behavior is defined by the Copilot CLI / SDK, not by the Console:
- **Interactive (💬)** — default conversational mode.
- **Plan (📋)** — biases the agent toward producing a plan before acting.
- **Autopilot (🚀)** — biases the agent toward executing without intermediate prompts.

Mode changes follow the same New / Resumed / Active rules: stored locally on New & Resumed, fired immediately as RPC on Active.
→ See: [slash-command-architecture.md](../slash-command-architecture.md)

---

## MCP servers

### How do I add an MCP server?
Open **Settings → MCP Servers → + Add Server**. Pick a scope (Global / Agent-only), give the server a name, paste the inner JSON config (no name wrapper), and Save. It immediately appears in every chat's MCP picker.
→ See: [MCP-SERVERS.md](MCP-SERVERS.md)

### I added an MCP server by editing the JSON file directly — why doesn't it show up?
The Console reads `mcp-config.json` once at startup and only rebuilds its in-memory cache after an in-app CRUD action. External edits made while the app is running are NOT picked up. Either restart the app, or re-add the server through Settings → MCP Servers.
→ See: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

### What do the per-server icons next to the MCP picker mean?
For each enabled server in the active session:
- **● (green)** — Connected.
- **🔐 (amber)** — Sign-in required. Click the row to start the OAuth flow.
- **◌ (blue, pulsing)** — Connecting…
- **⚠ (red)** — Failed. Hover for the error message.
- **○ (gray)** — Disabled by the server.

The aggregate icon next to the MCP button in the chat header follows priority: **🔐 > ⚠ > ◌ > ●**. So a single needs-auth server outranks a failure, which outranks a still-connecting one.
→ See: [MCP-SERVERS.md](MCP-SERVERS.md)

### Why does an MCP server show "connected" in the row but the header still shows ⚠ or 🔐?
The header is an aggregate over *enabled* servers. Another server in the same session is unhealthy. Open the picker to find the one with a non-green icon.

### Why did MCP icons reset when I switched sessions?
The picker subscribes to MCP status events for the active session only. Each session has its own enabled set and its own connection / OAuth state.

### MCP sign-in fails with `EACCES: permission denied 127.0.0.1:<port>`
A reserved Windows port range now overlaps the OAuth callback port the SDK chose during initial registration. Open **Settings → MCP Servers**, find the row, and click **Reset OAuth** — that deletes the cached registration so the next session using this server picks a fresh port and re-authenticates.
→ See: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

### What does the "Auto-enable" toggle do on an MCP server row?
When **Auto-enable** is on, the server is pre-selected in every *new* session's MCP picker. Already-open sessions are unaffected. The setting lives in `~/.copilot-console/settings.json` under `mcp_auto_enable`.
→ See: [MCP-SERVERS.md](MCP-SERVERS.md)

### What is the **Tool Builder** agent?
A seeded agent that scaffolds a Python custom tool from your description, generating the `TOOL_SPECS` file ready to drop into `~/.copilot-console/tools/`. Find it in the Agents tab.
→ See: [CUSTOM-TOOLS.md](CUSTOM-TOOLS.md)

---

## Custom tools

### My custom tool fails to load when it has `import requests` at the top of the file
Tools are loaded via dynamic `importlib` at app startup (`tools_service._load_module`). If a top-level import references a package that isn't installed in the Console's Python environment, the whole file fails to import and the loader silently skips it (see the broad `except` in `tools_service._load_tools_from_file`). Move the import inside the function body so it only resolves when the tool actually runs.
→ See: [CUSTOM-TOOLS.md](CUSTOM-TOOLS.md), [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md)

### Where do custom tools live and how do I add one?
Drop a `.py` file in `~/.copilot-console/tools/` that exports a top-level `TOOL_SPECS` list — each entry is a dict with `name`, `description`, `parameters` (JSON schema), and `handler` (the callable). Files starting with `_` are ignored. The **Tool Builder** agent (Agents tab) can scaffold one for you from a description.
→ See: [CUSTOM-TOOLS.md](CUSTOM-TOOLS.md)

---

## Workflows & runs

### Where do I find workflow runs vs the workflow library?
**Workflows** in the sidebar = library/editor. **Runs** in the sidebar = execution history (workflows + automations together). Clicking a run opens the run viewer with replay.
→ See: [WORKFLOWS.md](WORKFLOWS.md)

### Why does clicking Workflows show me an install command?
Workflows depend on the optional `agent-framework` Python package. The Console detects whether it's installed and either opens the Workflows tab or shows the install command for your OS. Run the command, restart Copilot Console, click Workflows again.
→ See: [WORKFLOWS.md](WORKFLOWS.md)

### Why did my workflow run pause with a question card?
That's a HITL (`Question` or `Confirmation`) node in the workflow YAML. Answer it in the run viewer to resume the run.
→ See: [WORKFLOWS.md](WORKFLOWS.md)

### My HITL card shows no question text — what's wrong?
Almost always a typo in the YAML field name (e.g., `prompt:` instead of `text:`, or `variable:` instead of `property:`). The Agent Framework runtime silently ignores unknown fields, so the run "succeeds" but renders empty.
→ See: [WORKFLOWS.md](WORKFLOWS.md)

### Deleting a workflow run also deleted my session — is that intended?
Yes. Each workflow run owns the agent sessions it spawned, and deleting the run cleans up its `sessions_removed` so you don't accumulate orphaned tabs. The delete confirm dialog spells this out.

### Can I see the workflow as a diagram?
Yes — every workflow has a Mermaid diagram view. The default "overlay" diagram is rendered from the YAML walk and always works; the "raw" view (`?raw=true` on the visualize endpoint) renders Agent Framework's own diagram and needs the workflow to fully build.
→ See: [WORKFLOWS.md](WORKFLOWS.md)

### Can workflows run agents in parallel (fan-out)?
Not via the YAML format yet. The Agent Framework supports it programmatically; declarative parallelism is on the roadmap.
→ See: [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md)

---

## Automations

### What's the difference between Automations and Workflows?
- **Workflows** are declarative agent pipelines defined in YAML — for chaining work together.
- **Automations** are scheduled triggers that run a session, agent, or workflow on a cron-style schedule. An automation *can* invoke a workflow.
→ See: [AUTOMATIONS.md](AUTOMATIONS.md)

### How do I run an automation right now without waiting for the schedule?
Each automation row has a **🚀 Run Now** button — it triggers the same payload immediately, separate from the schedule.
→ See: [AUTOMATIONS.md](AUTOMATIONS.md)

### Toggling an automation off — does that cancel the run that's already going?
No. The toggle only affects future scheduled runs. An in-flight run continues until completion or you cancel it from the run viewer.

### My scheduled automation didn't run while my PC was sleeping
Launch with `copilot-console --no-sleep`. The flag prevents idle sleep on both Windows (via `SetThreadExecutionState`) and macOS (via `caffeinate`, spawned with `-i -w <pid>` so it dies with the app). Manual sleep / lid-close still puts the machine to sleep on either platform — `--no-sleep` only blocks *idle* sleep.
→ See: [AUTOMATIONS.md](AUTOMATIONS.md)
→ See: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## Mobile companion

### How do I get the mobile app talking to my desktop?
On desktop: **Settings → Mobile** generates a QR with a token + base URL. Scan it with your phone (any QR app); the link opens the mobile UI and stores the token. After that, the mobile app reconnects automatically.
→ See: [MOBILE-COMPANION.md](MOBILE-COMPANION.md)

### Mobile shows "Session Expired" — what now?
The desktop's mobile API token no longer matches what the phone has. That happens when you click **Regenerate token** in Settings → Mobile, or when the desktop is reinstalled. Re-scan the QR from Settings → Mobile.
→ See: [MOBILE-COMPANION.md](MOBILE-COMPANION.md)

### Mobile shows "Connection Lost" / "Disconnected" — is my account broken?
No — that's a network state, not an auth state. The phone can't reach the desktop right now (laptop asleep, on a different network, behind a firewall). It re-probes every ~30s and on app foreground.
→ See: [MOBILE-COMPANION.md](MOBILE-COMPANION.md)

### How do I expose Copilot Console to my phone over the internet?
Use `copilot-console --expose` — the app sets up a devtunnel and prints the QR for that tunnel URL. macOS users may need `brew install --cask devtunnel` first.
→ See: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## Special cards in chat

### Why is the agent asking me a question instead of doing the work?
That's an **AskUser** card (or an MCP **Elicitation** card). The run is paused waiting for your input. Either click a preset choice or type a freeform answer (when allowed) and submit.

### The AskUser card disappeared and now shows "expired" — what now?
The card became stale (typically because the session sat idle long enough for the SDK to drop the request). The toast says: _"This request expired (session was idle too long). Continue in the message box below."_ Continue the conversation normally; the agent will pick up from there.

### What's the difference between AskUser and the big form-style card?
The form-style card is an MCP **Elicitation** request. It renders fields (text, radio, toggles, checkboxes) driven by the schema the MCP server sent. AskUser is the simpler text-or-choice prompt the agent itself raises.

### Why did a resolved AskUser/Elicitation card stay visible afterwards?
Resolved cards become read-only history so you can see what was asked and what you answered. The active prompt slot is separate.

### Why is the chat input disabled while a card is open?
A pending AskUser or Elicitation gates the input. The input footer reads _"Waiting for your input above…"_ — answer the card first.

---

## Settings & UI

### Why is the Save button only on the General tab in Settings?
General persists user preferences (default model, default CWD, theme) — they don't take effect until you click **Save**. The other tabs (Authentication, MCP Servers, Mobile, Notifications) act on changes immediately, so the modal shows only a **Close** button.

### How do I pick a default working directory without typing the path?
Settings → General → Default Working Directory has a folder browser button next to the text field.

### Where do desktop notification settings live?
**Settings → Notifications**. You can grant browser permission and choose what events notify you (long-running task done, automation finished, etc.).
→ See: [AUTOMATIONS.md](AUTOMATIONS.md)

### My MCP Servers tab shows an inline error instead of a toast — why?
Load failures (bad JSON, unreadable file) are rendered inline in the tab so they stay visible while you fix the underlying file. Action errors (delete failed, etc.) toast normally.

### Why do MCP delete and reset use confirm dialogs?
Both are destructive and not recoverable from the UI — the dialog is intentional.

---

## Banners & in-chat error states

### A toast says "Copilot Console server unreachable" — what happened?
The frontend's last network call to the backend threw a `TypeError` (most often the desktop process exited or crashed). The toast is dedup'd under id `server-down` so a burst of failed calls collapses into one. Restart `copilot-console` from the terminal; subsequent successful calls clear the failed state.

### A banner says "⚠ Session history unavailable" — can I recover?
The Copilot CLI's session resume errored out for this session — most often because the JSONL on disk was written by an older CLI build with a different schema. The session is intact on disk and still works in the CLI directly. The banner suggests running `copilot --resume <session_id>` in a terminal to continue it there.

### Why do some errors appear as a sticky toast and others as a transient toast?
Sticky toasts have an explicit `id` (so duplicates collapse) and stay visible until you dismiss them — used for action-required errors (auth failure, save failed). Transient toasts auto-dismiss on a duration (default a few seconds) — used for informational events (settings saved, copy succeeded).

---

## Discoverability quick-reference

| What you want | Where it is |
|---|---|
| Search across sessions | Ctrl/Cmd+K |
| Pair the mobile app | Settings → Mobile |
| Add an MCP server | Settings → MCP Servers → Add Server |
| Make agents available in `/agent` | Sub-Agents picker (chat header) |
| Compact the session | `/compact` slash command |
| Run agents in parallel | `/fleet` slash command |
| Ask a help question | `/help` slash command |
| Switch sub-agent for next turn | `/agent` slash command |
| Schedule a recurring task | Sidebar → Automations → **+ New Automation** |
| See workflow as a diagram | Open the workflow → Mermaid pane |
| Replay a previous run | Sidebar → Runs → click a row |
| Reset to seeded examples | Delete `~/.copilot-console/metadata.json` and the folder you want re-seeded (`workflows/`, `agents/`, etc.), then restart |

---

## When the FAQ doesn't have an answer

If you're reading this as the help assistant and none of the entries match, fall back to the per-feature guides under `docs/guides/` — they're the authoritative source for feature behavior. If those don't cover it either, say so directly and suggest checking GitHub issues at https://github.com/sanchar10/copilot-console.
