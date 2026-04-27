"""Per-session SDK client wrapper.

Owns one CopilotClient instance per active chat session, managing its
lifecycle (start, stop, create/resume session, RPC calls).
"""

import asyncio
import time

from copilot import CopilotClient, SubprocessConfig
from copilot.tools import Tool
from copilot.generated.rpc import (
    SessionMode,
    ModeSetRequest,
    ModelSwitchToRequest,
    FleetStartRequest,
    AgentSelectRequest,
)

# SDK >=0.1.28 requires on_permission_request for create/resume session.
# Import approve_all if available, otherwise provide a fallback for older SDKs.
try:
    from copilot.session import PermissionHandler
    approve_all_permissions = PermissionHandler.approve_all
except (ImportError, AttributeError):
    approve_all_permissions = None

from copilot_console.app.services.logging_service import get_logger
from copilot_console.app.services.mcp_oauth_coordinator import MCPOAuthCoordinator

logger = get_logger(__name__)


class SessionClient:
    """Wrapper for a per-session CopilotClient with CWD."""

    def __init__(self, session_id: str, cwd: str):
        self.session_id = session_id
        self.cwd = cwd
        self.client: CopilotClient | None = None
        self.session: object | None = None  # SDK session object
        self.started = False
        self.last_activity = time.time()
        # Active event queue for elicitation handler to push events into
        self.event_queue: asyncio.Queue | None = None
        # Per-session OAuth coordinator. Initialized on first access (so the
        # caller can plug in the notification callback) — see
        # ``ensure_oauth_coordinator``.
        self.oauth_coordinator: "MCPOAuthCoordinator | None" = None
        # Phase 5: long-lived bridge listener that translates SDK
        # ``session.compaction_start`` / ``session.compaction_complete`` events
        # into ``session.compaction`` events on the global event_bus. Registered
        # once per session activation, unsubscribed in ``stop()``. Lets compact
        # lifecycle events flow on the always-on /events SSE channel instead of
        # short-lived per-turn streams.
        self._compact_bridge_unsub = None
        # Phase 5: in-flight compact RPC task (at most one per session).
        # Cancelled on ``stop()`` so a tab-close mid-compact doesn't leak the
        # awaitable when the SDK connection drops.
        self._compact_task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start the client with CWD."""
        if self.started:
            return

        self.client = CopilotClient(SubprocessConfig(cwd=self.cwd))
        await self.client.start()
        self.started = True
        self.last_activity = time.time()
        logger.debug(f"[{self.session_id}] Started per-session client with cwd={self.cwd}")

    async def stop(self) -> None:
        """Stop the client and destroy session."""
        if not self.started or not self.client:
            return

        # Phase 5: cancel any in-flight compact RPC before tearing down the
        # SDK connection; otherwise the await would resolve with a transport
        # error after we've already discarded the session.
        if self._compact_task and not self._compact_task.done():
            self._compact_task.cancel()
            try:
                await self._compact_task
            except (asyncio.CancelledError, Exception):
                pass
        self._compact_task = None

        # Phase 5: unsubscribe the global-bus bridge listener.
        if self._compact_bridge_unsub is not None:
            try:
                self._compact_bridge_unsub()
            except Exception as e:
                logger.debug(f"[{self.session_id}] compact bridge unsubscribe failed: {e}")
            self._compact_bridge_unsub = None

        if self.oauth_coordinator is not None:
            try:
                await self.oauth_coordinator.cancel_all()
            except Exception as e:
                logger.debug(f"[{self.session_id}] OAuth coordinator cancel failed: {e}")
            self.oauth_coordinator = None

        try:
            if self.session:
                await self.session.destroy()
                self.session = None
        except Exception as e:
            logger.warning(f"[{self.session_id}] Error destroying session: {e}")

        try:
            await self.client.stop()
        except Exception as e:
            logger.warning(f"[{self.session_id}] Error stopping client: {e}")

        self.client = None
        self.started = False
        logger.debug(f"[{self.session_id}] Stopped per-session client")

    def _register_compact_bridge(self) -> None:
        """Phase 5: bridge SDK compaction + usage_info events to event_bus.

        Registered once per session activation (idempotent — no-op if a
        bridge is already attached). Forwards both manual-RPC and SDK
        auto-compaction events; the SDK's ``_dispatch_event`` fires the
        same events to listeners regardless of trigger.

        ``session.usage_info`` is also bridged so the token bar refreshes
        after SDK-initiated auto-compaction (which has no RPC result for
        ``_run_compact`` to publish). When usage_info also flows through
        an active per-turn stream the frontend just sets the same value
        twice — harmless.
        """
        if self._compact_bridge_unsub is not None or self.session is None:
            return

        # Local import to avoid a cycle (copilot_service imports session_client).
        from copilot_console.app.services.event_bus import event_bus

        sid = self.session_id

        def _on_event(evt) -> None:
            try:
                etype = evt.type.value if hasattr(evt.type, "value") else str(evt.type)
            except Exception:
                return
            if etype == "session.compaction_start":
                event_bus.publish(
                    "session.compaction",
                    {"phase": "start"},
                    session_id=sid,
                )
            elif etype == "session.compaction_complete":
                data = getattr(evt, "data", None)
                event_bus.publish(
                    "session.compaction",
                    {
                        "phase": "complete",
                        "success": getattr(data, "success", True) if data else True,
                        "error": getattr(data, "error", None) if data else None,
                        "tokens_removed": getattr(data, "tokens_removed", None) if data else None,
                        "messages_removed": getattr(data, "messages_removed", None) if data else None,
                        "pre_compaction_tokens": getattr(data, "pre_compaction_tokens", None) if data else None,
                        "post_compaction_tokens": getattr(data, "post_compaction_tokens", None) if data else None,
                        "checkpoint_number": getattr(data, "checkpoint_number", None) if data else None,
                    },
                    session_id=sid,
                )
            elif etype == "session.usage_info":
                data = getattr(evt, "data", None)
                if data is None:
                    return
                token_limit = getattr(data, "token_limit", None)
                current_tokens = getattr(data, "current_tokens", None)
                if token_limit is None or current_tokens is None:
                    return
                event_bus.publish(
                    "session.usage_info",
                    {
                        "tokenLimit": token_limit,
                        "currentTokens": current_tokens,
                        "messagesLength": getattr(data, "messages_length", None),
                    },
                    session_id=sid,
                )

        try:
            self._compact_bridge_unsub = self.session.on(_on_event)
        except Exception as e:
            logger.warning(f"[{sid}] failed to register compact bridge: {e}")

    def ensure_oauth_coordinator(self, notify) -> MCPOAuthCoordinator:
        """Create (or return) the per-session OAuth coordinator.

        ``notify(event_name, data)`` is the sync callback the coordinator uses
        to publish ``mcp_server_status`` / ``mcp_oauth_required`` /
        ``mcp_oauth_completed`` / ``mcp_oauth_failed`` events.
        """
        if self.oauth_coordinator is None:
            self.oauth_coordinator = MCPOAuthCoordinator(
                session_id=self.session_id,
                get_session=lambda: self.session,
                notify=notify,
            )
        return self.oauth_coordinator

    async def list_mcp_servers(self) -> list:
        """Wrapper around ``session.rpc.mcp.list()`` with safety checks.

        Normalizes the SDK 0.3.0 ``MCPServerList`` wrapper into a plain list.
        """
        if self.session is None:
            return []
        try:
            result = await self.session.rpc.mcp.list()
        except Exception as e:
            logger.debug(f"[{self.session_id}] mcp.list() failed: {e}")
            return []
        inner = getattr(result, "servers", None)
        if inner is not None:
            return list(inner)
        if isinstance(result, list):
            return result
        return []

    def touch(self) -> None:
        """Update last activity timestamp."""
        self.last_activity = time.time()

    async def create_session(
        self,
        model: str,
        mcp_servers: dict[str, dict] | None = None,
        tools: list[Tool] | None = None,
        available_tools: list[str] | None = None,
        excluded_tools: list[str] | None = None,
        system_message: dict | None = None,
        custom_agents: list[dict] | None = None,
        reasoning_effort: str | None = None,
        on_elicitation_request=None,
        on_user_input_request=None,
    ) -> object:
        """Create a new SDK session."""
        await self.start()
        assert self.client is not None

        session_opts: dict = {
            "session_id": self.session_id,
            "model": model,
            "streaming": True,
        }

        if approve_all_permissions:
            session_opts["on_permission_request"] = approve_all_permissions

        if on_elicitation_request:
            session_opts["on_elicitation_request"] = on_elicitation_request
            logger.debug(f"[{self.session_id}] Elicitation handler registered for session creation")

        if on_user_input_request:
            session_opts["on_user_input_request"] = on_user_input_request
            logger.debug(f"[{self.session_id}] User input (ask_user) handler registered for session creation")

        if mcp_servers:
            session_opts["mcp_servers"] = mcp_servers

        if tools:
            session_opts["tools"] = tools

        if available_tools:
            session_opts["available_tools"] = available_tools
        elif excluded_tools:
            session_opts["excluded_tools"] = excluded_tools

        if system_message:
            session_opts["system_message"] = system_message

        if custom_agents:
            session_opts["custom_agents"] = custom_agents

        if reasoning_effort:
            session_opts["reasoning_effort"] = reasoning_effort

        session_opts["working_directory"] = self.cwd

        self.session = await asyncio.wait_for(
            self.client.create_session(**session_opts),
            timeout=30,
        )
        self.touch()
        # Phase 5: attach the global-bus compact bridge for this session.
        self._register_compact_bridge()
        # Log capabilities to verify elicitation support
        if hasattr(self.session, 'capabilities'):
            logger.info(f"[{self.session_id}] Session capabilities: {self.session.capabilities}")
        logger.debug(
            f"[{self.session_id}] Created SDK session with model={model}, "
            f"working_directory={self.cwd}, mcp_servers={len(mcp_servers or {})}, "
            f"tools={len(tools or [])}, system_message={'yes' if system_message else 'no'}, "
            f"custom_agents={len(custom_agents or [])}"
        )
        return self.session

    async def resume_session(
        self,
        model: str | None = None,
        mcp_servers: dict[str, dict] | None = None,
        tools: list[Tool] | None = None,
        available_tools: list[str] | None = None,
        excluded_tools: list[str] | None = None,
        system_message: dict | None = None,
        custom_agents: list[dict] | None = None,
        reasoning_effort: str | None = None,
        on_elicitation_request=None,
        on_user_input_request=None,
    ) -> object:
        """Resume an existing SDK session."""
        await self.start()
        assert self.client is not None

        try:
            resume_opts: dict = {"streaming": True}
            if approve_all_permissions:
                resume_opts["on_permission_request"] = approve_all_permissions
            if on_elicitation_request:
                resume_opts["on_elicitation_request"] = on_elicitation_request
            if on_user_input_request:
                resume_opts["on_user_input_request"] = on_user_input_request
            if mcp_servers:
                resume_opts["mcp_servers"] = mcp_servers
            if tools:
                resume_opts["tools"] = tools
            if available_tools:
                resume_opts["available_tools"] = available_tools
            elif excluded_tools:
                resume_opts["excluded_tools"] = excluded_tools
            if system_message:
                resume_opts["system_message"] = system_message
            if custom_agents:
                resume_opts["custom_agents"] = custom_agents
            if model:
                resume_opts["model"] = model
            if reasoning_effort:
                resume_opts["reasoning_effort"] = reasoning_effort

            resume_opts["working_directory"] = self.cwd

            logger.debug(f"[{self.session_id}] Resuming SDK session with custom_agents={len(custom_agents or [])}")
            self.session = await asyncio.wait_for(
                self.client.resume_session(self.session_id, **resume_opts),
                timeout=30,
            )
            self.touch()
            # Phase 5: attach the global-bus compact bridge for this session.
            self._register_compact_bridge()
            logger.debug(f"[{self.session_id}] Resumed SDK session with mcp_servers={len(mcp_servers or {})}, tools={len(tools or [])}")
            return self.session
        except asyncio.TimeoutError:
            logger.error(f"[{self.session_id}] Session resume timed out after 30s (MCP server may be unresponsive)")
            raise RuntimeError(
                f"Session activation timed out after 30s. "
                f"An MCP server may be unresponsive. Try again or remove problematic MCP servers from this session."
            )
        except Exception as e:
            logger.warning(f"[{self.session_id}] Could not resume session: {e}")
            raise RuntimeError(f"Failed to resume session: {e}")

    async def get_or_create_session(
        self,
        model: str,
        mcp_servers: dict[str, dict] | None = None,
        tools: list[Tool] | None = None,
        available_tools: list[str] | None = None,
        excluded_tools: list[str] | None = None,
        system_message: dict | None = None,
        is_new_session: bool = False,
        custom_agents: list[dict] | None = None,
        reasoning_effort: str | None = None,
        on_elicitation_request=None,
        on_user_input_request=None,
    ) -> object:
        """Get existing session or create/resume one."""
        if self.session:
            self.touch()
            return self.session

        if is_new_session:
            logger.debug(f"[{self.session_id}] New session - creating")
            try:
                return await self.create_session(
                    model, mcp_servers, tools, available_tools, excluded_tools,
                    system_message, custom_agents, reasoning_effort,
                    on_elicitation_request, on_user_input_request,
                )
            except asyncio.TimeoutError:
                raise RuntimeError(
                    f"Session creation timed out after 30s. "
                    f"An MCP server may be unresponsive. Try again or remove problematic MCP servers from this session."
                )

        logger.debug(f"[{self.session_id}] Attempting to resume existing session")
        session = await self.resume_session(
            model, mcp_servers, tools, available_tools, excluded_tools,
            system_message, custom_agents, reasoning_effort,
            on_elicitation_request, on_user_input_request,
        )
        if session:
            return session
        raise RuntimeError(
            f"Failed to resume session. The session may be corrupted or an MCP server may be unresponsive. "
            f"Try again or remove problematic MCP servers from this session."
        )

    async def set_mode(self, mode: str) -> str:
        """Set the agent mode (interactive/plan/autopilot) on the active session."""
        if not self.session:
            raise RuntimeError(f"[{self.session_id}] No active session to set mode on")
        result = await self.session.rpc.mode.set(ModeSetRequest(mode=SessionMode(mode)))
        self.touch()
        logger.debug(f"[{self.session_id}] Mode set to {result.mode.value}")
        return result.mode.value

    async def set_model(self, model_id: str, reasoning_effort: str | None = None) -> str:
        """Switch the model on the active session. Takes effect from the next message."""
        if not self.session:
            raise RuntimeError(f"[{self.session_id}] No active session to set model on")
        result = await self.session.rpc.model.switch_to(
            ModelSwitchToRequest(model_id=model_id, reasoning_effort=reasoning_effort)
        )
        self.touch()
        logger.debug(f"[{self.session_id}] Model set to {result.model_id}")
        return result.model_id or model_id

    async def start_fleet(self, prompt: str | None = None) -> dict:
        """Start fleet mode (parallel sub-agents) on the active session."""
        if not self.session:
            raise RuntimeError(f"[{self.session_id}] No active session to start fleet on")
        result = await self.session.rpc.fleet.start(FleetStartRequest(prompt=prompt))
        self.touch()
        logger.debug(f"[{self.session_id}] Fleet started: {result.started}")
        return {"started": result.started}

    async def compact(self) -> dict:
        """Compact the session context (remove old messages to free tokens).

        Returns a graceful no-op if the session is not active or if the SDK
        reports nothing to compact.  Never raises on expected conditions.
        """
        noop = {"success": True, "tokens_removed": 0, "messages_removed": 0}
        if not self.session:
            return noop
        try:
            result = await self.session.rpc.history.compact()
            self.touch()
            logger.debug(
                f"[{self.session_id}] Compact: success={result.success}, "
                f"tokens_removed={result.tokens_removed}, messages_removed={result.messages_removed}"
            )
            return {
                "success": result.success,
                "tokens_removed": result.tokens_removed,
                "messages_removed": result.messages_removed,
            }
        except Exception as e:
            logger.warning(f"[{self.session_id}] Compact error, sending graceful no-op: {e}")
            return noop

    async def set_agent(self, agent_name: str) -> dict:
        """Select a custom agent on the active session."""
        if not self.session:
            raise RuntimeError(f"[{self.session_id}] No active session to select agent on")
        result = await self.session.rpc.agent.select(
            AgentSelectRequest(name=agent_name)
        )
        self.touch()
        agent = result.agent
        logger.debug(f"[{self.session_id}] Agent selected: {agent.name}")
        return {"name": agent.name, "display_name": agent.display_name}

    async def list_agents(self) -> list[dict]:
        """List available custom agents on the active session."""
        if not self.session:
            raise RuntimeError(f"[{self.session_id}] No active session to list agents on")
        result = await self.session.rpc.agent.list()
        self.touch()
        return [{"name": a.name} for a in result.agents]

    async def deselect_agent(self) -> dict:
        """Deselect the current custom agent."""
        if not self.session:
            raise RuntimeError(f"[{self.session_id}] No active session to deselect agent on")
        await self.session.rpc.agent.deselect()
        self.touch()
        return {"deselected": True}
