# Workflows

**Workflows** are multi-step pipelines defined in YAML. Each step runs an agent, and each step can pass outputs to the next.

## Run a Workflow

1. Open **Workflows** in the sidebar
2. Select a workflow (e.g., **Emoji Poem**, **Codebase Health Check**)
3. Click **▶ Run**
4. Provide any requested input

You’ll see events stream live while the workflow runs, and a full trace is saved for later review.

## Where Workflows and Runs Are Stored

- Workflows: `C:\Users\<username>\.copilot-console\workflows\`
- Workflow runs (history + working dirs): `C:\Users\<username>\.copilot-console\workflow-runs\`

## Editing Workflow YAML

Click **+ New Workflow** to create a new workflow in the built-in editor, or open an existing workflow in edit mode to modify its YAML.

## Tips

- Use workflows when you want repeatable multi-agent structure (scan → analyze → report).
- Keep workflow steps small and focused.

## Troubleshooting

- If a workflow fails immediately, check that the referenced agents exist in your Agent Library.
- For known workflow runtime caveats, see [Agent Framework SDK Patches](AF_SDK_PATCHES.md).
