# Known Limitations

This document lists known limitations of Copilot Console and the underlying GitHub Copilot SDK and Agent Framework.

## Tools and Sub-Agents Are Mutually Exclusive

**Affected area:** Session configuration, Agent definitions

When a session uses a working directory (`cwd`), GitHub Copilot CLI silently drops `custom_agents` if any `tools` or `available_tools` are also present in the session options. This is a CLI-level bug, not a Copilot Console issue.

**Workaround:** The UI enforces mutual exclusion — selecting any tools (custom or built-in include/exclude) disables the sub-agents selector, and vice versa. Clear all selections in one category to re-enable the other.

**Note:** Sub-agents themselves _can_ have their own tools, MCP servers, and built-in tool whitelists. The limitation only applies at the parent session level.

## Excluded Tools Propagate to Sub-Agents

**Affected area:** Agent definitions, Sub-agent tool availability

When a parent session uses `excluded_tools` to remove tools (e.g., `create`, `powershell`, `edit`), those exclusions propagate to **all sub-agents** in the session. Sub-agents lose access to the excluded tools even though they have their own separate configurations.

This means an orchestrator agent cannot exclude its own tools while keeping sub-agents fully capable. For example, excluding file/shell tools from a "team lead" agent to force delegation also strips those tools from the specialist agents it delegates to — making them unable to create files or run commands.

**How it interacts with sub-agent tool whitelists:**

A sub-agent's built-in tool whitelist (the "Only" mode) IS honored — the sub-agent only gets the tools it whitelists. However, the parent's exclusions are applied on top. The sub-agent's effective tool set is:

```
effective tools = sub-agent's whitelist MINUS parent's exclusions
```

**Example:** A parent agent excludes `create`. A sub-agent whitelists `['create', 'view', 'powershell']`. The sub-agent gets only `view` and `powershell` — `create` is removed because the parent excluded it.

**Workaround:** Do not use `excluded_tools` on agents that have sub-agents. Instead, use prompt instructions to guide the parent agent to delegate rather execute directly.

## Sub-Agents Cannot Be Nested

An agent that has sub-agents cannot itself be used as a sub-agent. Only leaf agents (no sub-agents of their own) are eligible for the sub-agent role. This is a GitHub Copilot constraint. 

## Sub-Agent Eligibility Requirements

To be used as a sub-agent, an agent must:

1. Have a non-empty **description** (used for auto-dispatch routing)
2. Have a non-empty **system message/prompt** (used as the sub-agent's instructions)
3. Have **no custom tools** (SDK limitation)
4. Have **no excluded built-in tools** (SDK limitation)
5. Have **no sub-agents** of its own (no nesting)
6. Not be the parent agent itself (no self-reference)

## No Per-Agent Model Override for Sub-Agents

Sub-agents inherit the model of the parent session. There is no way to specify a different model per sub-agent in the current SDK.

## Custom Tools Cannot Have Top-Level Imports

Custom tools (Python files in `~/.copilot-console/tools/`) run in a sandboxed environment. Top-level imports of third-party packages are not supported — use inline imports within the function body instead.

## System Prompt Cannot Be Changed After Session Creation

The system prompt is set when a session is created and cannot be changed afterwards. This is a Copilot SDK limitation. To use a different system prompt, create a new session.

**Note:** The model _can_ be changed mid-session — use the model selector in the session header to switch models on the fly.

## Workflows Support Sequential Execution Only

Workflow orchestration currently supports sequential agent chains only. Parallel execution patterns (fan-out / fan-in) are supported by the underlying Agent Framework programmatically but are not yet exposed in the declarative YAML format used by workflows. This will be added in a future update.
