# Agent Framework SDK Patches

Tracking monkey-patches and workarounds applied to the Microsoft Agent Framework
Python SDK and GitHub Copilot SDK. Review this list when upgrading
`agent-framework`, `agent-framework-core`, `agent-framework-github-copilot`,
or `github-copilot-sdk` — patches may become unnecessary as the SDKs mature.

**Installed versions at time of writing:**
- `agent-framework==1.0.0rc2`
- `agent-framework-core==1.0.0rc2`
- `agent-framework-declarative==1.0.0b260219`
- `agent-framework-github-copilot==1.0.0b260319`
- `github-copilot-sdk==0.2.0`

---

## 1. Declarative Workflow Input Seeding — ⚠️ NEEDS REVIEW

| | |
|---|---|
| **File** | `src/copilot_console/app/services/workflow_engine.py` |
| **Method** | `WorkflowEngine.run_oneshot()` |
| **Status** | **Broken / needs update.** The patch relies on `workflow._state` which no longer exists in `agent-framework-core>=1.0.0rc2`. The safety guard at line 462 will raise `RuntimeError` if a oneshot workflow is executed. Either the AF fixed input seeding natively (making this patch unnecessary) or the internals moved and the patch needs to be rewritten against the new API. |
| **SDK gap (original)** | `workflow.run(message=...)` passes the message to `_workflow_entry` (a `JoinExecutor`), which sends `ActionComplete()` downstream — **discarding the user input**. The first real agent never sees it. |
| **Root cause** | The .NET SDK has `InProcessExecution.StreamAsync(workflow, input, checkpointManager)` which seeds `System.LastMessage.Text` and `Workflow.Inputs` before executors run. The Python SDK has no equivalent class. |
| **What we patch** | `workflow._state.clear()` is replaced with a wrapper that re-seeds the declarative state (`_declarative_workflow_state`) after the internal reset, populating `Workflow.Inputs.input`, `System.LastMessage.Text`, and `System.LastMessageText`. |
| **When to remove** | Test a oneshot workflow (e.g. `emoji-poem`) with user input. If the first agent receives the topic without the patch, remove it. If not, rewrite the patch against the new `Workflow` internals. |

---

## 2. Copilot SDK 0.2.0 Compatibility Shim

| | |
|---|---|
| **File** | `src/copilot_console/app/services/workflow_engine.py` |
| **Function** | `_apply_sdk_compat_shim()` |
| **SDK gap** | `agent-framework-github-copilot` (≤1.0.0b260319) was built against `github-copilot-sdk` 0.1.x. SDK 0.2.0 introduced breaking changes: removed `CopilotClientOptions`, `SessionConfig`, `ResumeSessionConfig`, `MessageOptions` TypedDicts; changed `CopilotClient.__init__` from dict options to `SubprocessConfig`; changed `create_session()` / `resume_session()` from dict config to keyword args; changed `send()` / `send_and_wait()` from dict to positional `prompt` arg. |
| **What we patch** | Six patches applied to `copilot` SDK modules at import time: (1) Inject 4 missing TypedDict aliases into `copilot.types` as `dict`. (2) Wrap `CopilotClient.__init__` to convert dict options → `SubprocessConfig`. (3-4) Wrap `create_session` / `resume_session` to unpack dict config as `**kwargs`. (5-6) Wrap `send` / `send_and_wait` to extract `prompt` from dict. |
| **Scope** | Patches are global on SDK classes but transparent for non-dict calls. Our own `copilot_service.py` uses the native 0.2.0 kwargs API — the shim's `isinstance(config, dict)` check returns `False` and falls through to the original method. Overhead: ~50ns per call (one `isinstance` check). |
| **Guard** | `_SDK_PATCHED` flag prevents double-patching. Missing types are only added if `not hasattr(copilot.types, name)`. |
| **When to remove** | When `agent-framework-github-copilot` releases a version targeting `github-copilot-sdk>=0.2.0`. At that point the AF will use kwargs natively and the shim becomes a no-op — safe to remove entirely. |

---

## How to check if a patch is still needed

After upgrading the SDK:

### Patch 1 (Input Seeding)
1. **Currently broken** — `workflow._state` no longer exists in `agent-framework-core>=1.0.0rc2`
2. Test without the patch: run a oneshot declarative workflow (e.g., `emoji-poem`) with a user message
3. If the first agent receives the topic → the AF fixed it natively, remove the patch code entirely
4. If input is lost → rewrite the patch against the new `Workflow` internals (inspect `Workflow.__dict__` for state management)

### Patch 2 (SDK 0.2.0 Shim)
1. Check if `agent-framework-github-copilot` has a version requiring `github-copilot-sdk>=0.2.0`
2. If yes, upgrade the AF package, remove `_apply_sdk_compat_shim()` and the try/except block
3. If no, keep the shim — it's harmless and prevents import failures
4. Quick test: comment out `_apply_sdk_compat_shim()`, run `python -c "from agent_framework_github_copilot import GitHubCopilotAgent"` — if it succeeds, the shim is no longer needed
