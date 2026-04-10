# Sessions

A **session** is one chat conversation (with its own context, model, tools/sub-agents, and working directory). Sessions are shown as tabs and persist across restarts.

## Create a Session

- Click **+** in the sidebar to start a new session.
- Or start from an agent: **Agents → (pick an agent) → New Session**.

## Session Settings (Model, Tools, Working Directory)

In the session header, open **Session Settings** to configure:

- **System prompt**: replace or append to the agent's default prompt.
- **Model**: choose a model for this session, or leave it empty to use your default model.
- **MCP servers / tools**: enable only what you need.
- **Sub-agents**: enable a team when you want the main agent to delegate.
- **Working directory**: sets the folder the agent operates in for tools like file browsing and commands.

> Note: **tools** and **sub-agents** can’t be enabled together in the same session (CLI limitation). See [Agent Teams](AGENT-TEAMS.md) for details.

## Tabs and Unread Indicators

- Each session appears as a tab.
- A **blue dot** indicates an unread response in that session.
- Opening the session clears the unread indicator.

## Attach Files

Use the paperclip or drag-and-drop to attach files to a message. Attachments are uploaded to the session and can be referenced by the agent.

## Where Sessions Are Stored

Session conversation history is stored by the Copilot CLI in its own data folder (`~/.copilot/`). Copilot Console stores session metadata (settings, model, tools, working directory) under:

- `C:\Users\<username>\.copilot-console\sessions\`

To delete a session, use the delete option in Copilot CLI or Copilot Console.
