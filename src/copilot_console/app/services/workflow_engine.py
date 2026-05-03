"""Workflow engine — loads YAML via AF, executes, streams events, visualizes.

SDK-first: all workflow execution, edge routing, and visualization use AF's built-in
capabilities. No custom reimplementation of SDK-level functionality.

Uses WorkflowFactory (from agent_framework_declarative) for YAML → Workflow loading.
Agents are pre-registered via sync_agents_from_library() — YAML references them by name,
WorkflowFactory resolves them from the registry.

WorkflowCopilotAgent extends GitHubCopilotAgent to bridge Copilot Console definitions
(custom tools, MCP servers, built-in tool filtering, model, sub-agents) into the AF
workflow. Custom tools are passed as FunctionTool instances via the native tools= param.
System message mode (append/replace) is mapped from agent definition to AF's format.
Fields not natively supported by AF (_create_session / _resume_session) are injected
via overrides: available_tools, excluded_tools, custom_agents.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from agent_framework import (
    FunctionTool,
    Message,
    Workflow,
    WorkflowEvent,
    WorkflowRunResult,
    WorkflowViz,
)
from agent_framework_declarative import WorkflowFactory
from agent_framework_declarative._workflows._executors_external_input import (
    ExternalInputRequest,
    ExternalInputResponse,
)

# --- SDK 0.3.0 compatibility shim for agent_framework_github_copilot ---
# The installed agent_framework_github_copilot (1.0.0b260225) was built against
# SDK 0.1.x and imports `from copilot.types import (...)`. SDK 0.3.0 removed
# `copilot.types` entirely and moved symbols to `copilot.session` and
# `copilot.tools`. We synthesize a `copilot.types` module that re-exports the
# symbols AF-GHCP needs, then wrap the changed SDK methods so AF-GHCP's
# dict-style calls still work against 0.3.0's keyword-arg APIs.
#
# The newer AF-GHCP (1.0.0b260424+) uses kwargs natively but hard-pins
# github-copilot-sdk == 0.2.1, which would force a downgrade of the core SDK
# this app depends on. Until that pin is lifted upstream, this shim is the
# bridge that lets us keep SDK 0.3.0.
import sys
import types as _pytypes

import copilot
import copilot.tools as _copilot_tools
import copilot.session as _copilot_session
import copilot.client as _copilot_client
import copilot.generated.session_events as _copilot_events

_SDK_PATCHED = False
_PATCH_SENTINEL = "_copilot_console_patched"


def _build_copilot_types_module() -> _pytypes.ModuleType:
    """Synthesize a copilot.types module re-exporting symbols AF-GHCP needs.

    AF-GHCP 1.0.0b260225 imports these from copilot.types, but SDK 0.3.0
    removed that module. We register a synthetic one in sys.modules before
    AF-GHCP imports.
    """
    mod = _pytypes.ModuleType("copilot.types")
    mod.__package__ = "copilot"
    # Symbols moved to copilot.session in 0.3.0
    mod.MCPServerConfig = _copilot_session.MCPServerConfig
    mod.PermissionRequest = _copilot_session.PermissionRequest
    mod.PermissionRequestResult = _copilot_session.PermissionRequestResult
    mod.ResumeSessionConfig = _copilot_session.ResumeSessionConfig
    mod.SessionConfig = _copilot_session.SessionConfig
    mod.SystemMessageConfig = _copilot_session.SystemMessageConfig
    # Tool symbols live in copilot.tools
    mod.Tool = _copilot_tools.Tool
    mod.ToolInvocation = _copilot_tools.ToolInvocation
    mod.ToolResult = _copilot_tools.ToolResult
    # CopilotClientOptions was a TypedDict that no longer exists. AF-GHCP only
    # uses it as an annotation for a literal {}, so dict is sufficient.
    mod.CopilotClientOptions = dict
    # MessageOptions was also a TypedDict; included defensively for any
    # AF-GHCP variant that imports it.
    mod.MessageOptions = dict
    return mod


def _apply_sdk_compat_shim() -> bool:
    """Bridge AF-GHCP 1.0.0b260225 calls to SDK 0.3.0. Returns True if patched."""
    global _SDK_PATCHED
    if _SDK_PATCHED:
        return True

    # 1. Register synthetic copilot.types if (and only if) SDK didn't ship one.
    if "copilot.types" not in sys.modules and not hasattr(copilot, "types"):
        types_mod = _build_copilot_types_module()
        sys.modules["copilot.types"] = types_mod
        copilot.types = types_mod  # type: ignore[attr-defined]

    # 2. Wrap CopilotClient.__init__ to accept dict options
    if not getattr(_copilot_client.CopilotClient.__init__, _PATCH_SENTINEL, False):
        _orig_init = _copilot_client.CopilotClient.__init__

        def _patched_init(self, config=None, **kwargs):
            if isinstance(config, dict):
                from copilot import SubprocessConfig
                if config:
                    config = SubprocessConfig(**{
                        k: v for k, v in config.items()
                        if k in SubprocessConfig.__dataclass_fields__
                    })
                else:
                    config = None
            _orig_init(self, config, **kwargs)

        setattr(_patched_init, _PATCH_SENTINEL, True)
        _copilot_client.CopilotClient.__init__ = _patched_init

    # 3. Wrap create_session to accept dict config
    if not getattr(_copilot_client.CopilotClient.create_session, _PATCH_SENTINEL, False):
        _orig_create = _copilot_client.CopilotClient.create_session

        async def _patched_create(self, config=None, **kwargs):
            if isinstance(config, dict):
                return await _orig_create(self, **config)
            if config is not None:
                kwargs["config"] = config
            return await _orig_create(self, **kwargs)

        setattr(_patched_create, _PATCH_SENTINEL, True)
        _copilot_client.CopilotClient.create_session = _patched_create

    # 4. Wrap resume_session to accept dict config
    if not getattr(_copilot_client.CopilotClient.resume_session, _PATCH_SENTINEL, False):
        _orig_resume = _copilot_client.CopilotClient.resume_session

        async def _patched_resume(self, session_id, config=None, **kwargs):
            if isinstance(config, dict):
                return await _orig_resume(self, session_id, **config)
            if config is not None:
                kwargs["config"] = config
            return await _orig_resume(self, session_id, **kwargs)

        setattr(_patched_resume, _PATCH_SENTINEL, True)
        _copilot_client.CopilotClient.resume_session = _patched_resume

    # 5. Wrap send_and_wait to accept dict message_options.
    # Transparent passthrough for non-dict callers (e.g., session_client.py).
    # For dict callers, copy the dict before popping to avoid mutating the
    # caller's data, and forward all extra options as kwargs.
    if not getattr(_copilot_session.CopilotSession.send_and_wait, _PATCH_SENTINEL, False):
        _orig_send_wait = _copilot_session.CopilotSession.send_and_wait

        async def _patched_send_wait(self, prompt_or_opts, **kwargs):
            if isinstance(prompt_or_opts, dict):
                opts = dict(prompt_or_opts)
                prompt = opts.pop("prompt", "")
                return await _orig_send_wait(self, prompt, **opts, **kwargs)
            return await _orig_send_wait(self, prompt_or_opts, **kwargs)

        setattr(_patched_send_wait, _PATCH_SENTINEL, True)
        _copilot_session.CopilotSession.send_and_wait = _patched_send_wait

    # 6. Wrap send similarly. copilot_service.enqueue_message() relies on dict
    # forwarding for prompt + mode + attachments.
    if not getattr(_copilot_session.CopilotSession.send, _PATCH_SENTINEL, False):
        _orig_send = _copilot_session.CopilotSession.send

        async def _patched_send(self, prompt_or_opts, **kwargs):
            if isinstance(prompt_or_opts, dict):
                opts = dict(prompt_or_opts)
                prompt = opts.pop("prompt", "")
                return await _orig_send(self, prompt, **opts, **kwargs)
            return await _orig_send(self, prompt_or_opts, **kwargs)

        setattr(_patched_send, _PATCH_SENTINEL, True)
        _copilot_session.CopilotSession.send = _patched_send

    _SDK_PATCHED = True
    return True


try:
    _apply_sdk_compat_shim()
    from agent_framework_github_copilot import GitHubCopilotAgent
    _AF_GHCP_AVAILABLE = True
except ImportError:
    logging.getLogger(__name__).exception(
        "agent_framework_github_copilot not compatible with installed copilot SDK. "
        "Workflow engine will be unavailable."
    )
    _AF_GHCP_AVAILABLE = False

    class GitHubCopilotAgent:  # type: ignore[no-redef]
        def __init__(self, **kwargs: Any) -> None:
            pass

# SDK requires on_permission_request for create/resume session.
from copilot.session import PermissionHandler
approve_all_permissions = PermissionHandler.approve_all

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# PowerFx availability probe
# ---------------------------------------------------------------------------
# AF's declarative workflow engine evaluates `=expr` strings in YAML through
# Microsoft Power Fx. The `powerfx` Python package wheels are only published
# for CPython 3.10–3.13; Python 3.14 has no wheel and no source build path.
# Importing the package on 3.14 raises ImportError (or, on some envs, the
# import succeeds but `powerfx.Engine()` raises at runtime). When PowerFx
# is unavailable, any YAML containing `=…` strings will fail at execution
# time with an opaque error. Probe once at import so we can guard validation
# with a clear, actionable message.

def _probe_powerfx() -> bool:
    """Return True iff `powerfx` imports AND `powerfx.Engine()` instantiates.

    Logs the result once at INFO so operators can see in startup logs whether
    expression-evaluating workflows are supported on this interpreter.
    """
    try:
        import powerfx  # type: ignore[import-not-found]
    except Exception as exc:  # ImportError or transitive failures
        logger.info("PowerFx unavailable (import failed): %s", exc)
        return False
    try:
        powerfx.Engine()
    except Exception as exc:
        logger.info("PowerFx unavailable (Engine() failed): %s", exc)
        return False
    logger.info("PowerFx available: workflow expressions enabled")
    return True


POWERFX_AVAILABLE: bool = _probe_powerfx()


def _yaml_uses_expressions(yaml_content: str) -> bool:
    """True if any string scalar in the YAML starts with ``=`` after stripping.

    Walks the parsed structure recursively rather than regex-matching the
    source text. This catches all expression placements:
      * top-level string values (``foo: =Sum(1,2)``)
      * quoted strings (``foo: "=Sum(1,2)"``)
      * list items (``- =item``)
      * nested dict values (``cond: { test: =a > 0 }``)
      * lowercased scope keys, etc.

    Returns False on parse failure — an invalid YAML will fail later in
    ``load_from_yaml_string`` with a more specific message; we only want to
    flag the expressions case here.
    """
    import yaml as _yaml  # local import: hot path is rare

    try:
        root = _yaml.safe_load(yaml_content)
    except Exception:
        return False

    def _walk(node: object) -> bool:
        if isinstance(node, str):
            return node.lstrip().startswith("=")
        if isinstance(node, dict):
            return any(_walk(v) for v in node.values())
        if isinstance(node, list):
            return any(_walk(v) for v in node)
        return False

    return _walk(root)


class WorkflowCopilotAgent(GitHubCopilotAgent):
    """GitHubCopilotAgent extended with Copilot Console session config fields.

    Native AF constructor params handle: tools, mcp_servers, model, system_message.
    This subclass injects fields AF doesn't pass through to SessionConfig/
    ResumeSessionConfig: available_tools, excluded_tools, custom_agents,
    working_directory.

    Also overrides _tool_to_copilot_tool to bridge AF-GHCP 1.0.0b260225's
    SDK-0.1.x-shaped tool ABI to SDK 0.3.0:
      - ToolInvocation is a dataclass (no .get); read .arguments directly
      - ToolResult constructor takes snake_case (text_result_for_llm,
        result_type), not camelCase
    """

    def __init__(
        self,
        *,
        available_tools: list[str] | None = None,
        excluded_tools: list[str] | None = None,
        custom_agents: list[dict] | None = None,
        working_directory: str | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._available_tools = available_tools
        self._excluded_tools = excluded_tools
        self._custom_agents = custom_agents
        self._working_directory = working_directory
        self._session_ids: list[str] = []

    def _inject_session_fields(self, config: dict) -> None:
        """Inject available_tools, excluded_tools, custom_agents, working_directory.

        Must be called BEFORE the config is passed to self._client.create_session()
        or self._client.resume_session(), since the SDK consumes the config dict
        and does not store it on the session object.
        """
        if self._available_tools:
            config["available_tools"] = self._available_tools
        elif self._excluded_tools:
            config["excluded_tools"] = self._excluded_tools
        if self._custom_agents:
            config["custom_agents"] = self._custom_agents
        if self._working_directory:
            config["working_directory"] = self._working_directory

    async def _create_session(
        self, streaming: bool, runtime_options: dict[str, Any] | None = None,
    ):
        """Override to add available_tools, excluded_tools, custom_agents.

        Replicates parent's config-building logic, injects our fields,
        then calls self._client.create_session(config) directly.
        """
        if not self._client:
            raise RuntimeError("GitHub Copilot client not initialized. Call start() first.")

        opts = runtime_options or {}
        config: dict[str, Any] = {"streaming": streaming}

        model = opts.get("model") or self._settings["model"]
        if model:
            config["model"] = model

        system_message = opts.get("system_message") or self._default_options.get("system_message")
        if system_message:
            config["system_message"] = system_message

        if self._tools:
            config["tools"] = self._prepare_tools(self._tools)

        permission_handler = opts.get("on_permission_request") or self._permission_handler or approve_all_permissions
        if permission_handler:
            config["on_permission_request"] = permission_handler

        mcp_servers = opts.get("mcp_servers") or self._mcp_servers
        if mcp_servers:
            config["mcp_servers"] = mcp_servers

        # Inject fields AF doesn't pass natively
        self._inject_session_fields(config)

        session = await self._client.create_session(config)
        # Capture session ID incrementally for crash recovery
        if hasattr(session, 'session_id') and session.session_id:
            self._session_ids.append(session.session_id)
        return session

    async def _resume_session(self, session_id: str, streaming: bool):
        """Override to add available_tools, excluded_tools, custom_agents on resume.

        Replicates parent's resume config-building, injects our fields,
        then calls self._client.resume_session() directly.
        """
        if not self._client:
            raise RuntimeError("GitHub Copilot client not initialized. Call start() first.")

        config: dict[str, Any] = {"streaming": streaming}

        if self._tools:
            config["tools"] = self._prepare_tools(self._tools)

        if self._permission_handler:
            config["on_permission_request"] = self._permission_handler
        elif approve_all_permissions:
            config["on_permission_request"] = approve_all_permissions

        if self._mcp_servers:
            config["mcp_servers"] = self._mcp_servers

        # Inject fields AF doesn't pass natively
        self._inject_session_fields(config)

        return await self._client.resume_session(session_id, config)

    def _tool_to_copilot_tool(self, ai_func):  # type: ignore[override]
        """Convert FunctionTool to a Copilot SDK tool, bridging the AF-GHCP
        1.0.0b260225 → SDK 0.3.0 ABI mismatch.

        AF-GHCP's parent implementation calls invocation.get("arguments", {})
        and constructs ToolResult(textResultForLlm=..., resultType=...). In
        SDK 0.3.0, ToolInvocation is a dataclass without .get, and ToolResult
        uses snake_case kwargs (text_result_for_llm, result_type). This
        override reproduces the parent's logic with 0.3.0-correct calls.
        """
        from copilot.tools import Tool as _CopilotTool, ToolResult as _ToolResult

        async def handler(invocation):
            args = getattr(invocation, "arguments", None) or {}
            try:
                if ai_func.input_model:
                    args_instance = ai_func.input_model(**args)
                    result = await ai_func.invoke(arguments=args_instance)
                else:
                    result = await ai_func.invoke(arguments=args)
                return _ToolResult(
                    text_result_for_llm=str(result),
                    result_type="success",
                )
            except Exception as e:
                return _ToolResult(
                    text_result_for_llm=f"Error: {e}",
                    result_type="failure",
                    error=str(e),
                )

        return _CopilotTool(
            name=ai_func.name,
            description=ai_func.description,
            handler=handler,
            parameters=ai_func.parameters(),
        )


# ---------------------------------------------------------------------------
# YAML-overlay Mermaid helpers (Phase 4)
# ---------------------------------------------------------------------------

# Action kinds AF treats as control flow. Anything not in these sets is
# rendered as a plain rectangle.
_DECISION_KINDS = frozenset({"If", "Switch", "ConditionGroup"})
_LOOP_KINDS = frozenset({"Foreach", "RepeatUntil"})
_TRY_KIND = "TryCatch"


class _IdCounter:
    """Allocator for unique mermaid node ids within a single overlay render."""

    __slots__ = ("_n",)

    def __init__(self) -> None:
        self._n = 0

    def next(self, prefix: str = "n") -> str:
        self._n += 1
        return f"{prefix}{self._n}"


def _mermaid_escape(text: str) -> str:
    """Escape characters that break Mermaid node labels.

    Mermaid is sensitive to quotes and brackets inside ``[label]``/``{label}``
    forms. We strip newlines, quote-escape, and elide brackets that would
    otherwise prematurely close the node shape.
    """
    out = str(text).replace("\n", " ").replace("\r", " ")
    out = out.replace('"', "'").replace("[", "(").replace("]", ")")
    out = out.replace("{", "(").replace("}", ")")
    # Truncate very long labels so the diagram stays legible.
    if len(out) > 80:
        out = out[:77] + "..."
    return out


def _action_label(action: dict) -> str:
    """Human-readable label for a leaf action node."""
    kind = action.get("kind") or "Unknown"
    aid = action.get("id")
    if aid:
        return _mermaid_escape(f"{aid} ({kind})")
    return _mermaid_escape(kind)


def _render_actions(
    actions: list,
    prev_id: str,
    lines: list[str],
    counter: _IdCounter,
    indent: str,
) -> str:
    """Walk a list of actions sequentially.

    Returns the id of the last node emitted (or ``prev_id`` if the list was
    empty), so callers can chain to whatever comes after.
    """
    last = prev_id
    if not actions:
        return last

    for action in actions:
        if not isinstance(action, dict):
            continue
        last = _render_action(action, last, lines, counter, indent)
    return last


def _render_action(
    action: dict,
    prev_id: str,
    lines: list[str],
    counter: _IdCounter,
    indent: str,
) -> str:
    """Render a single action node + its sub-tree, return last node id."""
    kind = action.get("kind") or "Unknown"

    if kind in _DECISION_KINDS:
        return _render_decision(action, prev_id, lines, counter, indent)
    if kind in _LOOP_KINDS:
        return _render_loop(action, prev_id, lines, counter, indent)
    if kind == _TRY_KIND:
        return _render_trycatch(action, prev_id, lines, counter, indent)

    # Plain action node — rectangle.
    nid = counter.next()
    lines.append(f'{indent}{nid}["{_action_label(action)}"]')
    lines.append(f"{indent}{prev_id} --> {nid}")
    return nid


def _render_decision(
    action: dict,
    prev_id: str,
    lines: list[str],
    counter: _IdCounter,
    indent: str,
) -> str:
    """If / Switch / ConditionGroup → diamond + labelled outgoing branches.

    All branch sub-trees join at a synthetic merge node so the next sibling
    action only needs one inbound edge.
    """
    kind = action.get("kind")
    aid = action.get("id")
    diamond = counter.next()
    head = f"{aid} ({kind})" if aid else kind
    lines.append(f'{indent}{diamond}{{"{_mermaid_escape(head)}"}}')
    lines.append(f"{indent}{prev_id} --> {diamond}")

    merge = counter.next()
    lines.append(f'{indent}{merge}((" "))')

    # Collect (branch_label, branch_actions) pairs by kind.
    branches: list[tuple[str, list]] = []
    if kind == "If":
        branches.append(("then", action.get("then") or []))
        else_actions = action.get("else") or []
        if else_actions:
            branches.append(("else", else_actions))
    elif kind == "Switch":
        for case in action.get("cases") or []:
            if not isinstance(case, dict):
                continue
            label = str(case.get("match", "case"))
            branches.append((label, case.get("actions") or []))
        default_actions = action.get("default") or []
        if default_actions:
            branches.append(("default", default_actions))
    elif kind == "ConditionGroup":
        for i, cond in enumerate(action.get("conditions") or []):
            if not isinstance(cond, dict):
                continue
            label = str(cond.get("condition") or f"cond{i + 1}")
            branches.append((label, cond.get("actions") or []))
        else_actions = action.get("elseActions") or []
        if else_actions:
            branches.append(("else", else_actions))

    if not branches:
        # Pathological — diamond goes straight to merge so we don't dangle.
        lines.append(f"{indent}{diamond} --> {merge}")
        return merge

    for label, branch_actions in branches:
        if not branch_actions:
            lines.append(
                f"{indent}{diamond} -->|{_mermaid_escape(label)}| {merge}"
            )
            continue
        # First node in the branch needs the labelled edge from the diamond.
        # We render the branch by handing it a labelled-edge prev so the
        # first edge is annotated, then the rest cascade from there.
        first_marker = counter.next()
        lines.append(f'{indent}{first_marker}(("·"))')
        lines.append(
            f"{indent}{diamond} -->|{_mermaid_escape(label)}| {first_marker}"
        )
        last = _render_actions(branch_actions, first_marker, lines, counter, indent)
        lines.append(f"{indent}{last} --> {merge}")
    return merge


def _render_loop(
    action: dict,
    prev_id: str,
    lines: list[str],
    counter: _IdCounter,
    indent: str,
) -> str:
    """Foreach / RepeatUntil → subgraph wrapping the loop body."""
    kind = action.get("kind")
    aid = action.get("id")
    sg_id = counter.next("sg")
    title = f"{aid} ({kind})" if aid else kind
    lines.append(f'{indent}subgraph {sg_id}["{_mermaid_escape(title)}"]')
    inner_indent = indent + "    "
    entry = counter.next()
    lines.append(f'{inner_indent}{entry}(("·"))')
    last_inner = _render_actions(
        action.get("actions") or [], entry, lines, counter, inner_indent
    )
    lines.append(f"{indent}end")
    lines.append(f"{indent}{prev_id} --> {sg_id}")
    # We chain from the subgraph node itself so callers don't need to know
    # about the inner last node. Mermaid handles this fine.
    _ = last_inner
    return sg_id


def _render_trycatch(
    action: dict,
    prev_id: str,
    lines: list[str],
    counter: _IdCounter,
    indent: str,
) -> str:
    """TryCatch → subgraph with try/catch/finally lanes as nested subgraphs."""
    aid = action.get("id")
    sg_id = counter.next("sg")
    title = f"{aid} (TryCatch)" if aid else "TryCatch"
    lines.append(f'{indent}subgraph {sg_id}["{_mermaid_escape(title)}"]')
    inner_indent = indent + "    "

    prev_lane_entry: str | None = None
    for lane_key, lane_label in (("try", "try"), ("catch", "catch"), ("finally", "finally")):
        lane_actions = action.get(lane_key) or []
        if not lane_actions:
            continue
        lane_sg = counter.next("sg")
        lines.append(f'{inner_indent}subgraph {lane_sg}["{lane_label}"]')
        lane_inner_indent = inner_indent + "    "
        lane_entry = counter.next()
        lines.append(f'{lane_inner_indent}{lane_entry}(("·"))')
        _render_actions(lane_actions, lane_entry, lines, counter, lane_inner_indent)
        lines.append(f"{inner_indent}end")
        if prev_lane_entry is not None:
            lines.append(f"{inner_indent}{prev_lane_entry} -.-> {lane_entry}")
        prev_lane_entry = lane_entry

    lines.append(f"{indent}end")
    lines.append(f"{indent}{prev_id} --> {sg_id}")
    return sg_id


class WorkflowEngine:
    """Loads AF-native YAML workflows, executes them, and generates visualizations."""

    def __init__(self) -> None:
        self._registered_agents: set[str] = set()
        self._agents: dict[str, WorkflowCopilotAgent] = {}

    def _create_factory(self) -> WorkflowFactory:
        """Create a fresh WorkflowFactory with all registered agents."""
        factory = WorkflowFactory()
        for name in self._registered_agents:
            factory.register_agent(name, self._agents[name])
        return factory

    def set_working_directory(self, cwd: str) -> None:
        """Set working directory on all registered agents."""
        for agent in self._agents.values():
            agent._working_directory = cwd

    async def stop_agents(self) -> None:
        """Stop all registered agents, destroying sessions and CLI processes.

        Must be called after each workflow run (success or failure) to prevent
        leaked CopilotClient processes. Each agent's stop() destroys its sessions
        and terminates its CLI server process.
        """
        for name, agent in self._agents.items():
            try:
                await agent.stop()
            except Exception as e:
                logger.warning(f"Failed to stop agent '{name}': {e}")

    def collect_session_ids(self) -> list[str]:
        """Collect Copilot session IDs from all agents.

        Uses incrementally captured IDs from _create_session, so this is safe
        to call even after stop_agents() (which clears _client._sessions).
        """
        session_ids: list[str] = []
        for agent in self._agents.values():
            session_ids.extend(agent._session_ids)
        return session_ids

    def sync_agents_from_library(self) -> None:
        """Load all agents from the Agent Library and register them as AF agents.

        Creates a WorkflowCopilotAgent for each agent definition, bridging:
        - System message with mode → default_options["system_message"] (append/replace)
        - Custom tools → FunctionTool instances (via native tools= param)
        - MCP servers → default_options["mcp_servers"] (AF pops from opts)
        - Model → default_options["model"] (AF pops from opts)
        - Built-in tool opt-in/opt-out → available_tools/excluded_tools
          (via _create_session/_resume_session override)
        - Sub-agents → custom_agents as SDK CustomAgentConfig dicts
          (via _create_session/_resume_session override)
        """
        from copilot_console.app.services.agent_storage_service import agent_storage_service
        from copilot_console.app.services.mcp_service import mcp_service
        from copilot_console.app.services.storage_service import storage_service
        from copilot_console.app.services.tools_service import get_tools_service

        settings = storage_service.get_settings()
        step_timeout = settings.get("workflow_step_timeout", 600)

        self._agents: dict[str, WorkflowCopilotAgent] = {}
        self._registered_agents = set()

        agents = agent_storage_service.list_agents()
        for agent in agents:
            # Build default_options — AF pops model, mcp_servers; keeps system_message
            opts: dict[str, Any] = {}
            opts["timeout"] = step_timeout

            # System message with mode (append/replace) — AF reads from opts
            if agent.system_message and agent.system_message.content:
                opts["system_message"] = {
                    "mode": agent.system_message.mode,
                    "content": agent.system_message.content,
                }
            fallback_instructions = agent.description or f"You are {agent.name}."
            if "system_message" not in opts:
                opts["system_message"] = {"mode": "append", "content": fallback_instructions}

            if agent.model:
                opts["model"] = agent.model

            # Resolve MCP servers — AF pops mcp_servers from default_options
            if agent.mcp_servers:
                try:
                    mcp_servers_sdk = mcp_service.get_servers_for_sdk(agent.mcp_servers)
                    if mcp_servers_sdk:
                        opts["mcp_servers"] = mcp_servers_sdk
                except Exception as e:
                    logger.warning(f"Failed to resolve MCP servers for agent '{agent.name}': {e}")

            # Resolve custom tools as FunctionTool instances — via native tools= param
            function_tools: list[FunctionTool] | None = None
            if agent.tools.custom:
                try:
                    ts = get_tools_service()
                    specs = ts.get_tools_for_session(agent.tools.custom)
                    function_tools = [
                        FunctionTool(
                            name=spec.name,
                            description=spec.description,
                            func=spec.handler,
                            input_model=spec.parameters,
                        )
                        for spec in specs
                    ]
                except Exception as e:
                    logger.warning(f"Failed to resolve custom tools for agent '{agent.name}': {e}")

            # Built-in tool filtering — injected via session override
            available_tools = agent.tools.builtin or None
            excluded_tools = agent.tools.excluded_builtin or None

            # Sub-agents — resolved to SDK CustomAgentConfig dicts, injected via override
            custom_agents_sdk = None
            if agent.sub_agents:
                try:
                    custom_agents_sdk = agent_storage_service.convert_to_sdk_custom_agents(
                        agent.sub_agents, mcp_service
                    )
                except Exception as e:
                    logger.warning(f"Failed to resolve sub-agents for agent '{agent.name}': {e}")

            af_agent = WorkflowCopilotAgent(
                name=agent.name,
                description=agent.description,
                tools=function_tools,
                default_options=opts,
                available_tools=available_tools,
                excluded_tools=excluded_tools,
                custom_agents=custom_agents_sdk,
            )
            self._agents[agent.name] = af_agent
            self._registered_agents.add(agent.name)

            logger.debug(
                f"Registered agent '{agent.name}' for workflow use "
                f"(tools={len(function_tools or [])}, "
                f"mcp={len(opts.get('mcp_servers', {}))}, "
                f"model={agent.model}, "
                f"sys_msg_mode={agent.system_message.mode if agent.system_message else 'append'}, "
                f"sub_agents={len(custom_agents_sdk or [])})"
            )

        logger.info(f"Synced {len(agents)} agents from library for workflow use")

    def load_from_yaml_path(self, yaml_path: str) -> Workflow:
        """Load a workflow from an AF-native YAML file.

        Uses WorkflowFactory to parse the declarative YAML — no custom parsing.
        Agents are auto-synced from the Agent Library before loading.
        """
        self.sync_agents_from_library()
        factory = WorkflowFactory(agents=self._agents)
        return factory.create_workflow_from_yaml_path(yaml_path)

    def load_from_yaml_string(self, yaml_content: str) -> Workflow:
        """Load a workflow from a YAML string.

        Syncs agents from library, then creates the workflow.
        """
        self.sync_agents_from_library()
        factory = WorkflowFactory(agents=self._agents)
        return factory.create_workflow_from_yaml(yaml_content)

    @staticmethod
    def extract_executor_to_agent(yaml_content: str) -> dict[str, str]:
        """Walk a workflow YAML and return {executor_id -> agent_name} for every
        InvokeAzureAgent action, including those nested under If/Switch/TryCatch/
        ForEach/While/etc.

        Used by the run loop to attribute Copilot session_ids on
        executor_completed events back to the WorkflowCopilotAgent that created
        them, so the live view can attach an "Open session" button per node.
        Missing or malformed entries are skipped silently — never raises.
        """
        import yaml as _yaml
        try:
            doc = _yaml.safe_load(yaml_content) or {}
        except Exception:
            return {}

        result: dict[str, str] = {}

        def _walk(node: Any) -> None:
            if isinstance(node, dict):
                if node.get("kind") == "InvokeAzureAgent":
                    eid = node.get("id")
                    agent = node.get("agent") or {}
                    aname = agent.get("name") if isinstance(agent, dict) else None
                    if isinstance(eid, str) and isinstance(aname, str):
                        result[eid] = aname
                for v in node.values():
                    _walk(v)
            elif isinstance(node, list):
                for item in node:
                    _walk(item)

        _walk(doc)
        return result

    async def run_as_agent(
        self,
        workflow: Workflow,
        user_message: str,
        session: Any | None = None,
    ) -> AsyncIterator[Any]:
        """Run workflow conversationally via as_agent() — for Agent-start workflows.

        Streams agent response updates. Supports multi-turn via session persistence.
        """
        agent = workflow.as_agent(name=workflow.name if hasattr(workflow, "name") else None)
        if session is None:
            session = await agent.create_session()
        messages = [Message(role="user", contents=[user_message])]
        async for update in agent.run(messages, stream=True, session=session):
            yield update

    async def run_oneshot(
        self,
        workflow: Workflow,
        input_params: dict | str | None = None,
    ) -> AsyncIterator[WorkflowEvent]:
        """Run workflow as one-shot execution — for non-Agent-start workflows.

        Streams workflow events (executor invoked/completed/failed, status updates).
        input_params can be a string message or dict with a "message" key.

        NOTE: this path does not handle HITL request_info events. For workflows
        that may pause for human input, use ``start_run()`` and ``RunHandle``.
        """
        message = self._extract_message(input_params)

        # Apply idempotent State.clear patch for declarative input seeding
        with self._declarative_state_seeder(workflow, message):
            async for event in workflow.run(
                message=message,
                stream=True,
                include_status_events=True,
            ):
                yield event

    @staticmethod
    def _extract_message(input_params: dict | str | None) -> str:
        if isinstance(input_params, dict):
            return input_params.get("message", "start")
        if isinstance(input_params, str):
            return input_params
        return "start"

    def _declarative_state_seeder(self, workflow: Workflow, message: str):
        """Context manager that patches State.clear() to seed declarative inputs.

        See docs/AF_SDK_PATCHES.md for full context.

        Idempotent: only seeds when ``_declarative_workflow_state`` is absent
        from State after ``clear()``. This means:
          * On the first ``clear()`` call (start of run), state has no
            declarative key → we seed Inputs/System.LastMessage.
          * On any later ``clear()`` (e.g. nested/sub-workflow paths), if
            the workflow has already populated state, we do NOT overwrite
            Local/Outputs/Agent.
          * On resume via ``responses={...}``, AF passes ``reset_context=False``
            so ``state.clear()`` is not called at all — defensive idempotency
            still guards against any future SDK change.
        """
        from contextlib import contextmanager

        @contextmanager
        def _seeder():
            # Guard 1: Workflow must expose _state attribute
            if not hasattr(workflow, "_state"):
                raise RuntimeError(
                    "AF SDK patch failure: Workflow no longer has '_state' attribute. "
                    "The SDK internals have changed — review docs/AF_SDK_PATCHES.md."
                )
            state = workflow._state

            # Guard 2: State must have clear/set/get/commit methods
            for method_name in ("clear", "set", "get", "commit"):
                if not callable(getattr(state, method_name, None)):
                    raise RuntimeError(
                        f"AF SDK patch failure: State.{method_name}() not found or not callable. "
                        "The SDK internals have changed — review docs/AF_SDK_PATCHES.md."
                    )

            original_clear = state.clear

            # Guard 3: clear() must be replaceable
            try:
                state.clear = original_clear  # type: ignore[method-assign]
            except (AttributeError, TypeError) as exc:
                raise RuntimeError(
                    "AF SDK patch failure: State.clear is not assignable (frozen/slotted?). "
                    "The SDK internals have changed — review docs/AF_SDK_PATCHES.md."
                ) from exc

            state_key = "_declarative_workflow_state"

            def _clear_and_seed_if_absent() -> None:
                original_clear()
                # Idempotency: only seed if no declarative state exists.
                # Preserves Local/Outputs/Agent across mid-workflow clears
                # (HITL pause/resume, sub-workflow re-entry).
                try:
                    existing = state.get(state_key)
                except Exception:
                    existing = None
                if existing is not None:
                    return
                try:
                    state.set(state_key, {
                        "Inputs": {"input": message},
                        "Outputs": {},
                        "Local": {},
                        "System": {
                            "ConversationId": "default",
                            "LastMessage": {"Text": message, "Id": ""},
                            "LastMessageText": message,
                            "LastMessageId": "",
                        },
                        "Agent": {},
                        "Conversation": {"messages": [], "history": []},
                        "Custom": {},
                    })
                    state.commit()
                except Exception as exc:
                    raise RuntimeError(
                        "AF SDK patch failure: State.set()/commit() raised after clear(). "
                        "The SDK internals have changed — review docs/AF_SDK_PATCHES.md."
                    ) from exc

            state.clear = _clear_and_seed_if_absent  # type: ignore[method-assign]
            try:
                yield state
            finally:
                state.clear = original_clear  # type: ignore[method-assign]

        return _seeder()

    def visualize(self, workflow: Workflow) -> str:
        """Generate Mermaid diagram from AF's built-in visualization.

        Post-processes the output to replace AF's internal _workflow_entry
        node with a clean "Start" circle.
        """
        viz = WorkflowViz(workflow)
        mermaid = viz.to_mermaid()
        # Replace AF's internal entry node with a clean Start circle
        mermaid = mermaid.replace(
            'n__workflow_entry["_workflow_entry (Start)"]',
            'n__workflow_entry(("Start"))',
        )
        return mermaid

    def visualize_overlay(self, yaml_content: str) -> str:
        """YAML-driven Mermaid overlay that surfaces declarative semantics.

        AF's built-in mermaid is structurally accurate but loses kind metadata
        for control flow — `If`/`Switch`/`Foreach`/`TryCatch` all render as
        plain rectangles, making branching workflows hard to read at a glance.

        This walks the parsed YAML directly and emits a richer diagram:
          * `If` / `Switch` / `ConditionGroup` → diamond decision nodes with
            branch labels on outgoing edges.
          * `Foreach` / `RepeatUntil` → ``subgraph`` wrapping the loop body.
          * `TryCatch` → ``subgraph`` containing try/catch/finally lanes.
          * Anything else → rectangle labelled ``id (Kind)``.

        Pure function: same input string ⇒ same output string. Safe to call
        without instantiating the workflow (no agent resolution required).
        """
        import yaml as _yaml

        try:
            doc = _yaml.safe_load(yaml_content) or {}
        except Exception as exc:
            # Surface the parse error inside a tiny mermaid graph so the
            # frontend always has something renderable.
            return (
                "flowchart TD\n"
                f'    err["YAML parse error: {_mermaid_escape(str(exc))}"]\n'
            )

        trigger = (doc.get("trigger") or {}) if isinstance(doc, dict) else {}
        actions = trigger.get("actions") or []
        if not isinstance(actions, list):
            actions = []

        counter = _IdCounter()
        lines: list[str] = ["flowchart TD"]
        start_id = "n_start"
        lines.append(f'    {start_id}(("Start"))')

        last = _render_actions(actions, start_id, lines, counter, indent="    ")

        # Optional terminal marker so the diagram has a clear endpoint.
        end_id = "n_end"
        lines.append(f'    {end_id}(("End"))')
        lines.append(f"    {last} --> {end_id}")
        return "\n".join(lines) + "\n"

    def validate_yaml(self, yaml_content: str, *, block_powerfx: bool = False) -> dict:
        """Validate YAML content by attempting to load it.

        Returns {"valid": True, "mermaid": "..."} or {"valid": False, "error": "..."}.

        ``block_powerfx`` (default False) controls whether expression-using YAML
        is rejected up-front when the ``powerfx`` package is unavailable. Save
        paths leave it False — the YAML is structurally fine and we want users
        to be able to author Power Fx workflows on machines that can't run
        them. Run paths surface the failure naturally via the workflow_failed
        event. The strict mermaid path (?raw=true) sets it True because AF's
        built-in renderer needs the workflow object to be fully constructed.
        """
        if block_powerfx and not POWERFX_AVAILABLE and _yaml_uses_expressions(yaml_content):
            return {
                "valid": False,
                "error": (
                    "This workflow uses Power Fx expressions (values starting "
                    "with '=') but the 'powerfx' package is not available in "
                    "this Python runtime. Power Fx wheels currently ship for "
                    "Python 3.10–3.13. Switch to a supported interpreter, or "
                    "remove the expression(s) and use literal values."
                ),
            }
        try:
            workflow = self.load_from_yaml_string(yaml_content)
            mermaid = self.visualize(workflow)
            return {"valid": True, "mermaid": mermaid}
        except Exception as e:
            return {"valid": False, "error": str(e)}

    async def start_run(
        self,
        workflow: Workflow,
        input_params: dict | str | None = None,
    ) -> "RunHandle":
        """Start a workflow run that supports HITL pause/resume.

        Returns a RunHandle that yields events and accepts responses to
        request_info events via ``submit_response()``. The handle owns the
        live workflow object across pause boundaries so subsequent calls to
        ``workflow.run(responses=...)`` can resume from the paused state.
        """
        message = self._extract_message(input_params)
        return RunHandle(self, workflow, message)


# ---------------------------------------------------------------------------
# HITL helpers
# ---------------------------------------------------------------------------

def _build_external_input_response(
    pending: ExternalInputRequest | None,
    raw: Any,
) -> dict[str, Any]:
    """Map a router payload to a dict that AF coerces to ExternalInputResponse.

    AF's _send_responses_internal calls try_coerce_to_type(raw, response_type),
    which converts a plain dict {user_input, value} to ExternalInputResponse.

    Bool inputs (the existing approve/reject UI) are mapped per request_type:
        confirmation → {user_input: "yes"|"no", value: bool}
        question/user_input/external → {user_input: str(raw), value: raw}

    Dict inputs are passed through, with user_input/value backfilled if missing.
    """
    request_type = (pending.request_type if pending is not None else "external") or "external"

    if isinstance(raw, dict):
        out = dict(raw)
        if "user_input" not in out:
            value = out.get("value")
            out["user_input"] = json.dumps(value) if value is not None else ""
        if "value" not in out:
            out["value"] = None
        return out

    if isinstance(raw, bool):
        if request_type == "confirmation":
            return {"user_input": "yes" if raw else "no", "value": raw}
        return {"user_input": str(raw).lower(), "value": raw}

    # str / number / other scalars
    if raw is None:
        return {"user_input": "", "value": None}
    return {"user_input": str(raw), "value": raw}


@dataclass
class _PendingRequest:
    request_id: str
    request: ExternalInputRequest | None
    raw_event: WorkflowEvent | None = None


class RunHandle:
    """Live handle to a running workflow with pause/resume support.

    Lifecycle:
        handle = await engine.start_run(workflow, input_params)
        async for event in handle.events():
            ...  # consume events
            if handle.is_paused():
                # paused on RequestInfoEvent — caller submits response
                await handle.submit_response(request_id, {"value": True})
                # continue iterating; events resume

    The handle owns the live ``Workflow`` object and a per-run
    ``asyncio.Queue(maxsize=1)`` for response delivery. Nothing is shared
    across runs.
    """

    def __init__(self, engine: WorkflowEngine, workflow: Workflow, message: str) -> None:
        self._engine = engine
        self._workflow = workflow
        self._message = message
        self._response_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1)
        self._pending: _PendingRequest | None = None
        self._closed = False

    def is_paused(self) -> bool:
        return self._pending is not None

    @property
    def pending_request_id(self) -> str | None:
        return self._pending.request_id if self._pending else None

    @property
    def pending_request(self) -> ExternalInputRequest | None:
        return self._pending.request if self._pending else None

    async def submit_response(self, request_id: str, raw_data: Any) -> None:
        """Submit a response for the pending request_info event.

        Raises ValueError on stale/wrong request_id or if no request is
        pending. The resume happens inside ``events()``.
        """
        if self._pending is None:
            raise ValueError("No pending request to respond to")
        if request_id != self._pending.request_id:
            raise ValueError(
                f"Stale request_id: pending={self._pending.request_id}, got={request_id}"
            )
        if self._response_queue.full():
            raise ValueError("Response already submitted for this request")
        coerced = _build_external_input_response(self._pending.request, raw_data)
        await self._response_queue.put({self._pending.request_id: coerced})

    async def events(self) -> AsyncIterator[WorkflowEvent]:
        """Iterate workflow events. Pauses internally on request_info until
        ``submit_response()`` is called, then resumes via workflow.run(responses=...).
        """
        if self._closed:
            raise RuntimeError("RunHandle already consumed")
        self._closed = True

        responses: dict[str, Any] | None = None

        while True:
            with self._engine._declarative_state_seeder(self._workflow, self._message):
                if responses is not None:
                    # Resume path: workflow.run(responses=...) is mutually
                    # exclusive with message=. AF will not call state.clear()
                    # because reset_context is False on this path.
                    stream = self._workflow.run(
                        responses=responses,
                        stream=True,
                        include_status_events=True,
                    )
                    responses = None
                else:
                    stream = self._workflow.run(
                        message=self._message,
                        stream=True,
                        include_status_events=True,
                    )

                paused = False
                try:
                    async for event in stream:
                        if _is_request_info_event(event):
                            # Set pending BEFORE yielding so callers see it
                            # during the same event tick.
                            self._pending = _PendingRequest(
                                request_id=getattr(event, "request_id", "") or "",
                                request=_extract_request_payload(event),
                                raw_event=event,
                            )
                            yield event
                            # Wait for caller to submit_response()
                            responses = await self._response_queue.get()
                            self._pending = None
                            paused = True
                            break
                        else:
                            yield event
                finally:
                    inner = getattr(stream, "_iterator", None)
                    aclose_target = inner if inner is not None else stream
                    aclose = getattr(aclose_target, "aclose", None)
                    if aclose is not None:
                        try:
                            await aclose()
                        except Exception as exc:
                            import logging as _logging
                            _logging.getLogger(__name__).debug(
                                "RunHandle stream aclose raised: %s", exc
                            )
                    cleanup = getattr(stream, "_run_cleanup_hooks", None)
                    if cleanup is not None:
                        try:
                            await cleanup()
                        except Exception:
                            pass
                    # Defensive: AF's runner.run_until_convergence sets a
                    # private _running flag in a try/finally block that only
                    # fires when the generator is exhausted or closed. The
                    # outer aclose() chain SHOULD propagate GeneratorExit
                    # down to it, but if the runner is still flagged after
                    # cleanup we forcibly clear the flags so the resume
                    # call can succeed. (This is the documented escape
                    # hatch we depend on; tracked in docs/AF_SDK_PATCHES.md.)
                    runner = getattr(self._workflow, "_runner", None)
                    if runner is not None and getattr(runner, "_running", False):
                        runner._running = False  # type: ignore[attr-defined]
                    if getattr(self._workflow, "_is_running", False):
                        self._workflow._is_running = False  # type: ignore[attr-defined]

                if not paused:
                    # Stream exhausted naturally; workflow finished.
                    return


def _is_request_info_event(event: Any) -> bool:
    try:
        return getattr(event, "type", None) == "request_info"
    except Exception:
        return False


def _extract_request_payload(event: Any) -> ExternalInputRequest | None:
    """Pull the ExternalInputRequest off a request_info event, if present."""
    data = getattr(event, "data", None)
    if isinstance(data, ExternalInputRequest):
        return data
    return None


# Singleton instance
workflow_engine = WorkflowEngine()
