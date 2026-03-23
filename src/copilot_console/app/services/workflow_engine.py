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

import logging
from collections.abc import AsyncIterator
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

# --- SDK 0.2.0 compatibility shim for agent_framework_github_copilot ---
# The agent framework was built against SDK 0.1.x which used TypedDicts for
# CopilotClientOptions, SessionConfig, ResumeSessionConfig, MessageOptions.
# SDK 0.2.0 replaced these with keyword-arg APIs. We inject the missing type
# aliases so the AF module loads, then wrap the changed SDK methods so dict-
# based calls from the AF still work.
import copilot.types as _copilot_types
import copilot.session as _copilot_session
import copilot.client as _copilot_client

_SDK_PATCHED = False

def _apply_sdk_compat_shim() -> bool:
    """Patch SDK 0.2.0 to accept 0.1.x dict-style calls. Returns True if patched."""
    global _SDK_PATCHED
    if _SDK_PATCHED:
        return True

    # 1. Add missing TypedDict aliases (AF only uses them as type annotations)
    for name in ("CopilotClientOptions", "SessionConfig", "ResumeSessionConfig", "MessageOptions"):
        if not hasattr(_copilot_types, name):
            setattr(_copilot_types, name, dict)

    # 2. Wrap CopilotClient.__init__ to accept dict options
    _orig_init = _copilot_client.CopilotClient.__init__
    def _patched_init(self, config=None, **kwargs):
        if isinstance(config, dict):
            from copilot.types import SubprocessConfig
            if config:
                config = SubprocessConfig(**{k: v for k, v in config.items()
                                            if k in SubprocessConfig.__dataclass_fields__})
            else:
                config = None
        _orig_init(self, config, **kwargs)
    _copilot_client.CopilotClient.__init__ = _patched_init

    # 3. Wrap create_session to accept dict config
    _orig_create = _copilot_client.CopilotClient.create_session
    async def _patched_create(self, config=None, **kwargs):
        if isinstance(config, dict):
            return await _orig_create(self, **config)
        if config is not None:
            kwargs["config"] = config
        return await _orig_create(self, **kwargs)
    _copilot_client.CopilotClient.create_session = _patched_create

    # 4. Wrap resume_session to accept dict config
    _orig_resume = _copilot_client.CopilotClient.resume_session
    async def _patched_resume(self, session_id, config=None, **kwargs):
        if isinstance(config, dict):
            return await _orig_resume(self, session_id, **config)
        if config is not None:
            kwargs["config"] = config
        return await _orig_resume(self, session_id, **kwargs)
    _copilot_client.CopilotClient.resume_session = _patched_resume

    # 5. Wrap send_and_wait to accept dict message_options
    _orig_send_wait = _copilot_session.CopilotSession.send_and_wait
    async def _patched_send_wait(self, prompt_or_opts, **kwargs):
        if isinstance(prompt_or_opts, dict):
            prompt = prompt_or_opts.get("prompt", "")
            return await _orig_send_wait(self, prompt, **kwargs)
        return await _orig_send_wait(self, prompt_or_opts, **kwargs)
    _copilot_session.CopilotSession.send_and_wait = _patched_send_wait

    # 6. Wrap send to accept dict message_options
    _orig_send = _copilot_session.CopilotSession.send
    async def _patched_send(self, prompt_or_opts, **kwargs):
        if isinstance(prompt_or_opts, dict):
            prompt = prompt_or_opts.pop("prompt", "")
            return await _orig_send(self, prompt, **prompt_or_opts, **kwargs)
        return await _orig_send(self, prompt_or_opts, **kwargs)
    _copilot_session.CopilotSession.send = _patched_send

    _SDK_PATCHED = True
    return True

try:
    _apply_sdk_compat_shim()
    from agent_framework_github_copilot import GitHubCopilotAgent
except ImportError:
    logging.getLogger(__name__).warning(
        "agent_framework_github_copilot not compatible with installed copilot SDK. "
        "Workflow engine will be unavailable."
    )
    class GitHubCopilotAgent:  # type: ignore[no-redef]
        def __init__(self, **kwargs: Any) -> None:
            pass

# SDK >=0.1.28 requires on_permission_request for create/resume session.
try:
    from copilot.types import PermissionHandler
    approve_all_permissions = PermissionHandler.approve_all
except (ImportError, AttributeError):
    approve_all_permissions = None

logger = logging.getLogger(__name__)


class WorkflowCopilotAgent(GitHubCopilotAgent):
    """GitHubCopilotAgent extended with Copilot Console session config fields.

    Native AF constructor params handle: tools, mcp_servers, model, system_message.
    This subclass injects fields AF doesn't pass through to SessionConfig/
    ResumeSessionConfig: available_tools, excluded_tools, custom_agents,
    working_directory.
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
        """
        # Extract message string — AF expects a plain string
        if isinstance(input_params, dict):
            message = input_params.get("message", "start")
        elif isinstance(input_params, str):
            message = input_params
        else:
            message = "start"

        # --- AF SDK monkey-patch: declarative workflow input seeding ---
        # See docs/AF_SDK_PATCHES.md for full context.
        #
        # In hosted environments (Copilot Studio / .NET InProcessExecution),
        # the runtime populates System.LastMessage.Text and Workflow.Inputs
        # before the first agent runs.  The Python SDK lacks this hosting
        # layer, so workflow.run(message=...) loses the input inside the
        # _workflow_entry JoinExecutor.  We patch State.clear() to re-seed
        # the declarative state after the internal reset.
        #
        # Safety guards below will raise immediately if the SDK changes the
        # internals this patch relies on, rather than silently failing.

        # Guard 1: Workflow must expose _state attribute
        if not hasattr(workflow, "_state"):
            raise RuntimeError(
                "AF SDK patch failure: Workflow no longer has '_state' attribute. "
                "The SDK internals have changed — review docs/AF_SDK_PATCHES.md."
            )

        state = workflow._state

        # Guard 2: State must have clear/set/commit methods
        for method_name in ("clear", "set", "commit"):
            if not callable(getattr(state, method_name, None)):
                raise RuntimeError(
                    f"AF SDK patch failure: State.{method_name}() not found or not callable. "
                    "The SDK internals have changed — review docs/AF_SDK_PATCHES.md."
                )

        # Guard 3: clear() must be replaceable (not a frozen/slotted object)
        original_clear = state.clear
        try:
            state.clear = original_clear  # type: ignore[method-assign]
        except (AttributeError, TypeError) as exc:
            raise RuntimeError(
                "AF SDK patch failure: State.clear is not assignable (frozen/slotted?). "
                "The SDK internals have changed — review docs/AF_SDK_PATCHES.md."
            ) from exc

        state_key = "_declarative_workflow_state"

        def _clear_and_seed_inputs() -> None:
            original_clear()
            # Guard 4: verify set/commit still work after clear
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

        state.clear = _clear_and_seed_inputs  # type: ignore[method-assign]

        try:
            async for event in workflow.run(
                message=message,
                stream=True,
                include_status_events=True,
            ):
                yield event
        finally:
            state.clear = original_clear  # type: ignore[method-assign]

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

    def validate_yaml(self, yaml_content: str) -> dict:
        """Validate YAML content by attempting to load it.

        Returns {"valid": True, "mermaid": "..."} or {"valid": False, "error": "..."}.
        """
        try:
            workflow = self.load_from_yaml_string(yaml_content)
            mermaid = self.visualize(workflow)
            return {"valid": True, "mermaid": mermaid}
        except Exception as e:
            return {"valid": False, "error": str(e)}


# Singleton instance
workflow_engine = WorkflowEngine()
