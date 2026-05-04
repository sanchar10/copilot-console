# Agent Framework SDK Patches

Tracking monkey-patches and workarounds applied to the Microsoft Agent
Framework Python SDK and the GitHub Copilot SDK. Review this list when
upgrading any of:

- `agent-framework`
- `agent-framework-core`
- `agent-framework-declarative`
- `agent-framework-github-copilot` (AF-GHCP)
- `github-copilot-sdk`

Patches may become unnecessary as the upstream SDKs mature.

**Installed versions at time of writing:**

- `agent-framework==1.0.0rc2`
- `agent-framework-core==1.0.0rc2`
- `agent-framework-declarative==1.0.0b260219`
- `agent-framework-github-copilot==1.0.0b260225`
- `github-copilot-sdk==0.3.0`

Both patches live in `src/copilot_console/app/services/workflow_engine.py`
and are applied at module import — without them the app fails to start
or oneshot declarative workflows silently drop user input.

---

## 1. Declarative Workflow Input Seeding — ✅ Active

| | |
|---|---|
| **File** | `src/copilot_console/app/services/workflow_engine.py` |
| **Method** | `WorkflowEngine._declarative_state_seeder()` (used by `run_oneshot()`) |
| **Status** | **Active and required.** Rebuilt in commit `e402f85` against `agent-framework-core>=1.0.0rc2`. Hardened with explicit guards so future SDK changes fail loudly instead of silently dropping input. |
| **SDK gap** | `workflow.run(message=...)` passes the message to `_workflow_entry` (a `JoinExecutor`), which sends `ActionComplete()` downstream — **discarding the user input**. The first real agent never sees it. The .NET SDK has `InProcessExecution.StreamAsync(workflow, input, checkpointManager)` which seeds `System.LastMessage.Text` and `Workflow.Inputs` before executors run. The Python SDK has no equivalent. |
| **What we patch** | A context manager (`_declarative_state_seeder`) wraps `state.clear()` so that whenever the workflow internals reset state, we re-seed the declarative state key (`_declarative_workflow_state`) with `Inputs.input`, `System.LastMessage.Text`, `System.LastMessageText`, etc. |
| **Idempotency** | Only seeds when `_declarative_workflow_state` is absent after `clear()`. Preserves `Local` / `Outputs` / `Agent` across mid-workflow clears (HITL pause/resume, sub-workflow re-entry). On resume via `responses={...}` AF passes `reset_context=False` so `state.clear()` is never called — defensive idempotency still guards against future SDK changes. |
| **Guards (raise loudly on SDK drift)** | (1) `Workflow` must expose `_state`. (2) `state` must have callable `clear`/`set`/`get`/`commit`. (3) `state.clear` must be assignable (not frozen/slotted). Any failure raises `RuntimeError` referencing this doc. |
| **When to remove** | Test a oneshot declarative workflow (e.g. `mood-topic-poem`) without the patch (`with WorkflowEngine._null_seeder():`). If the first agent receives the topic, the AF Python SDK has fixed input seeding natively — remove the patch. Otherwise, if any guard now raises, the SDK internals moved and the patch needs rewriting against the new `Workflow` internals. |

---

## 2. AF-GHCP / Copilot SDK 0.3.0 Compatibility Shim — ✅ Active

| | |
|---|---|
| **File** | `src/copilot_console/app/services/workflow_engine.py` |
| **Function** | `_apply_sdk_compat_shim()` (auto-invoked at import via the `try` block at module top) |
| **Status** | **Active and required.** Without it, `from agent_framework_github_copilot import GitHubCopilotAgent` raises `ImportError` and `_AF_GHCP_AVAILABLE` becomes `False`, disabling all Agent Framework features. |
| **SDK gap** | `agent-framework-github-copilot==1.0.0b260225` was built against `github-copilot-sdk` 0.1.x dict-style options. SDK 0.3.0 (1) **removed the `copilot.types` module entirely** and (2) reshaped the constructor / session APIs from `dict` config to dataclasses (`SubprocessConfig`) and keyword args. AF-GHCP imports/calls that no longer resolve. |
| **What we patch (7 things)** | (1) **Synthetic `copilot.types` module** built by `_build_copilot_types_module()` and registered in `sys.modules` before AF-GHCP imports. Re-exports symbols from their new homes — `MCPServerConfig`, `PermissionRequest`, `PermissionRequestResult`, `ResumeSessionConfig`, `SessionConfig`, `SystemMessageConfig` (now in `copilot.session`), `Tool`, `ToolInvocation`, `ToolResult` (now in `copilot.tools`), plus `CopilotClientOptions` and `MessageOptions` aliased to plain `dict` (TypedDicts that no longer exist; AF-GHCP only uses them as annotations). (2) Wrap `CopilotClient.__init__` to convert dict options → `SubprocessConfig`. (3) Wrap `CopilotClient.create_session` to unpack dict config as `**kwargs`. (4) Wrap `CopilotClient.resume_session` similarly. (5) Wrap `CopilotSession.send_and_wait` to extract `prompt` from dict. (6) Wrap `CopilotSession.send` similarly. (7) Each wrap is marked with a `_PATCH_SENTINEL` attribute so re-imports / hot-reload don't double-wrap. |
| **Scope / overhead** | All wraps are transparent for non-dict callers — they `isinstance(config, dict)` and fall through to the original method when our own code passes the native 0.3.0 kwargs/dataclass API (which `copilot_service.py` and `session_client.py` do). Overhead per call: one `isinstance` check (~50 ns). |
| **Guards** | `_SDK_PATCHED` global prevents whole-shim re-entry; per-method `_PATCH_SENTINEL` prevents per-method double-wrap; the synthetic types module is only registered when neither `sys.modules["copilot.types"]` nor `copilot.types` already exists. |
| **When to remove** | When AF-GHCP releases a build targeting `github-copilot-sdk>=0.3.0`. At that point the `from copilot.types import …` lines in AF-GHCP will resolve natively and the wrap-around APIs will use kwargs natively too — the shim becomes a no-op (`isinstance` always `False`) and is safe to delete. Quick test: comment out the `_apply_sdk_compat_shim()` call and run `python -c "from agent_framework_github_copilot import GitHubCopilotAgent"`. If it succeeds, you can also delete `_build_copilot_types_module()` and the six wrappers. |

---

## How to verify a patch is still needed after upgrading

### Patch 1 (Input Seeding)

1. Pin a known-good oneshot declarative workflow (`mood-topic-poem` lives in the
   bundled seed content).
2. Run it with a topic via the workflows UI.
3. If the first agent receives the topic verbatim — the AF Python SDK now
   seeds inputs natively. Remove `_declarative_state_seeder` and switch
   `run_oneshot` back to `workflow.run(message=...)` directly.
4. If any of the three guards in `_declarative_state_seeder` raise
   `RuntimeError`, the SDK internals moved. Inspect `Workflow.__dict__`
   and the AF source to find the new state-management API and rewrite
   the seeder against it.

### Patch 2 (SDK 0.3.0 Compat Shim)

1. Check the AF-GHCP release notes or `pyproject.toml` for a version
   that requires `github-copilot-sdk>=0.3.0`.
2. If yes, upgrade the AF package, then comment out `_apply_sdk_compat_shim()`
   and try `python -c "from agent_framework_github_copilot import GitHubCopilotAgent"`.
3. If the import succeeds **and** workflow runs still complete end-to-end
   (`pytest tests/test_workflows.py`), delete `_apply_sdk_compat_shim()`,
   `_build_copilot_types_module()`, and the `_PATCH_SENTINEL` /
   `_SDK_PATCHED` globals.
4. If the import still fails or runs error out, keep the shim — it's
   transparent (single `isinstance` check per call) for native callers.
