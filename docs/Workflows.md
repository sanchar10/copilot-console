# Workflows

Workflows let you chain Copilot agents into deterministic, replayable pipelines defined in YAML. They are built on top of the [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) declarative workflow runtime.

A workflow is just a YAML file in `~/.copilot-console/workflows/`. The Console gives you:

- A YAML editor with live Mermaid preview.
- A run viewer with side-by-side Mermaid diagram + event stream.
- A run history with replay.
- Human-in-the-loop (HITL) prompts that pause runs in the UI.
- Optional Power Fx expressions for richer logic.

> **Optional install.** Workflows depend on the `agent-framework` package, which the Copilot Console installer asks about (Y/N) at setup time. If you skipped it, install later with `python -m pip install agent-framework --pre` (Windows) or `python3 -m pip install agent-framework --pre` (macOS/Linux). With pipx: `pipx inject copilot-console agent-framework --pip-args="--pre"`. Restart Copilot Console after installing. Clicking **Workflows** in the sidebar before installing will show this exact command for your OS.

---

## Anatomy of a workflow

```yaml
kind: Workflow
name: my-workflow
description: One-liner describing what this does
trigger:
  kind: OnConversationStart
  id: start
  actions:
    - kind: SendActivity
      id: greet
      activity: "👋 Hi!"

    - kind: Question
      id: ask_topic
      property: Local.topic
      text: "What should I research?"

    - kind: InvokeAzureAgent
      id: research
      agent:
        name: Researcher

    - kind: SendActivity
      id: done
      activity: "✅ Done."
```

Top-level fields:

| Field | Required | Description |
|---|---|---|
| `kind` | yes | Always `Workflow`. |
| `name` | yes | Display name. Slugified into the workflow ID on save. |
| `description` | no | Free text. |
| `trigger.kind` | yes | Almost always `OnConversationStart`. |
| `trigger.id` | yes | Unique trigger identifier. |
| `trigger.actions` | yes | The list of nodes to execute, in order. |

---

## Supported node kinds

These are the kinds the Console exercises today. Anything supported by the Agent Framework declarative runtime should also work, but only the ones below are covered by Console tests, mermaid overlays, and seeded demos.

### Activity nodes

| Kind | Purpose |
|---|---|
| `SendActivity` | Emit a message into the run trace (display only). |
| `SetValue` | Assign a value to a `Local.*` or `Global.*` property. |
| `InvokeAzureAgent` | Call a Copilot agent. With no `input`, falls back to `Local.userInput`. |

### Branching / looping

| Kind | Notes |
|---|---|
| `If` | `condition:` is a Power Fx expression. `then:` / `else:` are action lists. |
| `Switch` | `value:` (Power Fx) plus `cases:` and optional `default:`. |
| `Foreach` | Iterate over a collection. Renders as a subgraph in the overlay. |
| `RepeatUntil` | Loop until a condition is met. |
| `TryCatch` | Wrap actions in a guarded block. |

### Human-in-the-loop (HITL)

These pause the run and prompt the user in the Console UI. Submit a response from the run view to resume.

| Kind | Required fields | Optional |
|---|---|---|
| `Question` | `id`, `property`, `text` | `choices`, `allowFreeText` |
| `Confirmation` | `id`, `message`, `output_property` | — |

> ⚠️ **Field names matter.** Unknown YAML fields are silently ignored by the runtime, so a typo (e.g. `prompt:` instead of `text:`) will run "successfully" but show an empty prompt. If your HITL card displays no question, double-check the field names against this table.

Example:

```yaml
- kind: Question
  id: pick_mode
  property: Local.mode
  text: "Pick a path"
  choices:
    - quick
    - thorough
    - scenic
```

---

## Power Fx expressions

Any string starting with `=` is treated as a [Power Fx](https://learn.microsoft.com/en-us/power-platform/power-fx/overview) expression by the Agent Framework runtime — for example:

```yaml
- kind: If
  id: branch_quick
  condition: =Local.mode == "quick"
  then:
    - kind: SendActivity
      id: quick_path
      activity: "⚡ Quick path."
```

### Runtime requirements

Power Fx evaluation is implemented in C# and reached from Python through `pythonnet`. To run Power Fx-using workflows you need:

- **Python 3.10–3.13** (the `powerfx` PyPI package only ships wheels for these versions).
- **.NET 6.0+ runtime** (or SDK) installed and on `PATH` — `dotnet --info` should succeed.
- The `powerfx` PyPI package: `pip install powerfx`.

If any of those are missing, evaluation fails at run time with a message like:

```
❌ PowerFx is not available (dotnet runtime not installed).
   Expression '=Local.mode == "quick"' cannot be evaluated.
```

### What the Console does for you

- **Save is never blocked** by missing Power Fx, so you can author workflows on a machine that won't run them and execute them elsewhere.
- **Save toast** — when a Power Fx-using workflow is saved on a machine where Power Fx is unavailable, you get a non-sticky warning toast pointing this out.
- **Run failure toast** — sticky toast surfaces the upstream error from the Agent Framework so you don't have to scroll the trace to spot it.
- **Mermaid overlay** — the YAML overlay diagram is a pure walk and works without Power Fx; the raw Agent Framework diagram (`?raw=true`) needs the workflow to build cleanly and therefore needs Power Fx for `=expression` workflows.

---

## Mermaid diagram

Two views are available:

- **Overlay (default)** — a YAML walk that surfaces declarative semantics: diamonds for `If` / `Switch` / `ConditionGroup`, subgraphs for `Foreach` / `RepeatUntil` / `TryCatch`. Always renders, even when the workflow can't fully build.
- **Raw** (`GET /api/workflows/{id}/visualize?raw=true`) — Agent Framework's own diagram. Useful for debugging drift between the two views.

---

## Run history

Every run is recorded with status, duration, error (if any), and the full event stream. The editor's run table:

- Auto-refreshes every 5s while any visible run is `running` or `paused`.
- Persists across reloads (loaded from disk).
- Clicking a run opens the run view, which replays the stored events and reconnects to SSE if the run is still active.

---

## Seeded examples

Fresh installs land a handful of example workflows in `~/.copilot-console/workflows/`:

| File | What it shows |
|---|---|
| `feature-tour.yaml` | The basics — `Question` with choices, free-text input, an agent invocation. No Power Fx. |
| `feature-tour-advanced.yaml` | Branching + looping — `If`, `Switch`, `Foreach`. **Uses Power Fx.** |
| `backend-engineering-demo.yaml` | A multi-agent backend engineering pipeline. |
| ...and others | Browse the Workflows tab. |

Reset to the seeded set by deleting `~/.copilot-console/workflows/` and restarting Console.

---

## Troubleshooting

### "PowerFx is not available (dotnet runtime not installed)"

You're running a workflow that uses `=expressions` on a machine that lacks .NET. Install the .NET 6+ runtime and the `powerfx` PyPI package, or rewrite the workflow without expressions, or run it on another machine.

### HITL card shows no question (or shows raw `ExternalInputRequest(...)`)

The YAML probably uses field names the Agent Framework runtime doesn't recognise. Common mistakes:

- `prompt:` → use `text:` for `Question`.
- `variable:` → use `property:` for `Question` (or `output_property:` for `Confirmation`).

The runtime silently ignores unknown fields, so the workflow runs but the prompt comes through empty.

### Save fails with "Invalid YAML"

The Console only blocks save on hard YAML/structural errors. A red sticky toast in the editor shows the full message — there's no truncated chip to peek at any more.

### Run fails immediately

A sticky red toast appears in the run view with the error from the Agent Framework. The run row in the editor's history table also shows `failed` with the error in the error column.
