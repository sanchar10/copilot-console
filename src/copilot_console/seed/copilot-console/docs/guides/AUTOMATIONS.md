# Automations

**Automations** run agents on a cron schedule. They’re great for recurring tasks like daily summaries, checks, or reports.

## Create an Automation

1. Open **Agents**
2. Pick an agent
3. Click **Automations**
4. Click **+ New Automation**

You’ll configure:

- **Name**
- **Cron schedule**
- **Prompt / input**
- **Enabled/disabled**

## Monitor Runs

Use the **Runs** area to see execution history, inspect logs/output, and jump into a running session.

## Where Automations and Runs Are Stored

- Automations: `C:\Users\<username>\.copilot-console\automations\`
- Run history: `C:\Users\<username>\.copilot-console\task-runs\`

## Tips

- If you schedule automations overnight, consider running Copilot Console with `--no-sleep`.
