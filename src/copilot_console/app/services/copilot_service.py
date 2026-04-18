"""Copilot SDK service — orchestrator for session clients, elicitation, and events.

Architecture:
- Main client (no CWD): Used only for list_sessions() and get_messages() (reading history)
- Per-session clients (with CWD): Each active chat session gets its own CopilotClient
  with the session's working directory

Session lifecycle:
- Tab opened: Nothing (lazy activation)
- First message sent: Create per-session client with CWD, create/resume SDK session
- Tab closed: Destroy the per-session client
- CWD changed while active: Destroy old client, create new client with new CWD
- App shutdown: Destroy all per-session clients and main client

Long-running agent support:
- Messages are processed in background tasks (not tied to SSE connection)
- Responses are buffered so SSE can disconnect/reconnect
- Agent continues running even if browser closes

Module structure (after split):
- session_client.py    — SessionClient class, approve_all_permissions
- elicitation_service.py — ElicitationManager
- event_processor.py   — EventProcessor
- copilot_service.py   — CopilotService coordinator (this file)
"""

import asyncio
import re
import time
from typing import AsyncGenerator, TYPE_CHECKING

from copilot import CopilotClient
from copilot.tools import Tool

from copilot_console.app.config import DEFAULT_MODELS
from copilot_console.app.services.logging_service import get_logger, close_session_log
from copilot_console.app.services.session_client import SessionClient, approve_all_permissions
from copilot_console.app.services.elicitation_service import ElicitationManager
from copilot_console.app.services.event_processor import EventProcessor

if TYPE_CHECKING:
    from copilot_console.app.services.response_buffer import ResponseBuffer

logger = get_logger(__name__)


# Max events buffered per session before backpressure kicks in
_EVENT_QUEUE_MAX = 1000


def _safe_enqueue(queue: asyncio.Queue, item: dict | None) -> None:
    """Put *item* on *queue*, dropping the oldest non-sentinel event if full."""
    try:
        queue.put_nowait(item)
    except asyncio.QueueFull:
        # Drop oldest to make room — but never discard a sentinel (None)
        try:
            dropped = queue.get_nowait()
            if dropped is None:
                # Re-insert sentinel — it must not be lost
                queue.put_nowait(dropped)
        except asyncio.QueueEmpty:
            pass
        try:
            queue.put_nowait(item)
        except asyncio.QueueFull:
            pass  # queue is still full of sentinels — shouldn't happen


class CopilotService:
    """Orchestrates main client, session client pool, and message flow.

    Main client: Used for listing sessions and reading history (no CWD)
    Per-session clients: Each active session gets its own client with CWD
    """

    def __init__(self) -> None:
        # Main client for listing/reading (no CWD)
        self._main_client: CopilotClient | None = None
        self._main_started = False

        # Per-session clients with CWD
        self._session_clients: dict[str, SessionClient] = {}

        # SDK metadata cache: populated by list_sessions(), used by get_session()
        # to avoid redundant list_sessions() calls on individual session lookups
        self._sdk_metadata_cache: dict[str, object] = {}

        self._lock: asyncio.Lock | None = None  # Created lazily in async context
        self._session_msg_locks: dict[str, asyncio.Lock] = {}  # Per-session read locks
        self._cleanup_task: asyncio.Task | None = None
        self._idle_timeout_seconds = 600  # 10 minutes
        self._models_cache: list[dict] | None = None
        self._models_cache_time: float = 0.0

        # Elicitation manager (owns pending futures)
        self._elicitation_mgr = ElicitationManager()

    def _get_lock(self) -> asyncio.Lock:
        """Get or create the async lock (must be called in async context)."""
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    # -------------------------------------------------------------------------
    # Elicitation delegation
    # -------------------------------------------------------------------------

    def resolve_elicitation(self, session_id: str, request_id: str, result: dict) -> bool:
        """Resolve a pending elicitation with the user's response."""
        return self._elicitation_mgr.resolve(session_id, request_id, result)

    def cancel_elicitation(self, session_id: str, request_id: str) -> bool:
        """Cancel a specific pending elicitation/ask_user Future."""
        return self._elicitation_mgr.cancel(session_id, request_id)

    def cancel_pending_elicitations(self, session_id: str) -> int:
        """Cancel all pending elicitations for a session (on disconnect/destroy)."""
        return self._elicitation_mgr.cancel_all(session_id)

    # -------------------------------------------------------------------------
    # Main client lifecycle
    # -------------------------------------------------------------------------

    async def _start_main_client(self) -> None:
        """Start the main client (for listing/reading)."""
        if self._main_started:
            return

        async with self._get_lock():
            if self._main_started:
                return

            try:
                self._main_client = CopilotClient()
                await self._main_client.start()
                self._main_started = True
                logger.info("Main CopilotClient started")

                # Start background cleanup task
                self._cleanup_task = asyncio.create_task(self._idle_cleanup_loop())
            except Exception as e:
                logger.error(f"Failed to start main CopilotClient: {e}")
                raise

    async def _idle_cleanup_loop(self) -> None:
        """Background task to destroy idle per-session clients."""
        while self._main_started:
            await asyncio.sleep(60)  # Check every minute
            await self._cleanup_idle_sessions()

    async def _cleanup_idle_sessions(self) -> None:
        """Destroy per-session clients idle for too long."""
        now = time.time()
        to_destroy = []

        async with self._get_lock():
            for session_id, client in list(self._session_clients.items()):
                if now - client.last_activity > self._idle_timeout_seconds:
                    to_destroy.append(session_id)

        for session_id in to_destroy:
            logger.info(f"Destroying idle session client {session_id} (idle > {self._idle_timeout_seconds}s)")
            await self.destroy_session_client(session_id)

    async def stop(self) -> None:
        """Stop all clients (called on app shutdown)."""
        # Cancel cleanup task
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None

        # Destroy all per-session clients
        async with self._get_lock():
            for session_id, client in list(self._session_clients.items()):
                try:
                    await client.stop()
                    logger.info(f"Destroyed session client {session_id}")
                except Exception as e:
                    logger.warning(f"Error destroying session client {session_id}: {e}")
            self._session_clients.clear()

        # Stop main client
        if self._main_client and self._main_started:
            try:
                await self._main_client.stop()
            except Exception as e:
                logger.warning(f"Error stopping main client: {e}")
            self._main_client = None
            self._main_started = False
            logger.info("Main CopilotClient stopped")

    # -------------------------------------------------------------------------
    # Main client operations (listing, reading history)
    # -------------------------------------------------------------------------

    async def get_models(self) -> list[dict]:
        """Get list of available LLM models from SDK (cached for 10 minutes)."""
        now = time.time()
        if self._models_cache and now - self._models_cache_time < 600:
            return self._models_cache

        await self._start_main_client()
        assert self._main_client is not None

        try:
            models = await self._main_client.list_models()
            result = []
            for m in models:
                entry: dict = {"id": m.id, "name": m.name}
                if getattr(m, "supported_reasoning_efforts", None):
                    entry["supported_reasoning_efforts"] = m.supported_reasoning_efforts
                if getattr(m, "default_reasoning_effort", None):
                    entry["default_reasoning_effort"] = m.default_reasoning_effort
                result.append(entry)
            self._models_cache = result
            self._models_cache_time = now
            logger.debug(f"Listed {len(result)} models from SDK")
            return result
        except Exception as e:
            logger.warning(f"Failed to list models from SDK: {e}, using defaults")
            return [{"id": m, "name": m} for m in DEFAULT_MODELS]

    async def list_sessions(self) -> list[dict]:
        """List all sessions from the SDK. Also populates SDK metadata cache."""
        await self._start_main_client()
        assert self._main_client is not None

        try:
            sessions = await self._main_client.list_sessions()
            logger.debug(f"Listed {len(sessions)} sessions from SDK")
            # Populate metadata cache
            self._sdk_metadata_cache = {}
            for s in sessions:
                sid = getattr(s, "sessionId", None) or getattr(s, "session_id", None)
                if sid:
                    self._sdk_metadata_cache[sid] = s
            return sessions
        except Exception as e:
            logger.error(f"Failed to list sessions: {e}", exc_info=True)
            return []

    def get_cached_session_metadata(self, session_id: str) -> object | None:
        """Get cached SDK metadata for a session (populated by list_sessions)."""
        return self._sdk_metadata_cache.get(session_id)

    async def get_session_messages(self, session_id: str) -> list:
        """Get messages from a session WITHOUT keeping it active.

        Uses main client to resume temporarily, fetch messages, then destroy
        to release the session from the main client. Per-session lock prevents
        concurrent resume/destroy races from multiple HTTP requests.
        """
        await self._start_main_client()
        assert self._main_client is not None

        # If session has an active client, get messages from it
        async with self._get_lock():
            if session_id in self._session_clients:
                client = self._session_clients[session_id]
                if client.session:
                    try:
                        return await client.session.get_messages()
                    except Exception as e:
                        logger.warning(f"Failed to get messages from active session {session_id}: {e}")
                        return []

        # Per-session lock to prevent concurrent resume/destroy races
        if session_id not in self._session_msg_locks:
            self._session_msg_locks[session_id] = asyncio.Lock()

        async with self._session_msg_locks[session_id]:
            # Resume temporarily with main client, get messages, destroy to release
            try:
                resume_config: dict = {"streaming": False}
                if approve_all_permissions:
                    resume_config["on_permission_request"] = approve_all_permissions
                session = await self._main_client.resume_session(session_id, **resume_config)
                messages = await session.get_messages()
                try:
                    await session.destroy()
                except Exception:
                    pass  # Best-effort cleanup — session data persists on disk regardless
                return messages
            except Exception as e:
                # CLI bug: writes event types (e.g. system.notification) that its
                # own session.resume RPC rejects as "Unknown event type".
                # Fix: strip the offending events from events.jsonl and retry.
                error_msg = str(e)
                if "Unknown event type" in error_msg:
                    stripped = await self._sanitize_events_jsonl(session_id, error_msg)
                    if stripped:
                        try:
                            session = await self._main_client.resume_session(session_id, **resume_config)
                            messages = await session.get_messages()
                            logger.debug(f"Session {session_id} resumed successfully after sanitization")
                            try:
                                await session.destroy()
                            except Exception:
                                pass
                            return messages
                        except Exception as retry_err:
                            logger.warning(f"Session {session_id} resume failed even after sanitization: {retry_err}")
                            return []
                logger.warning(f"Could not get messages for session {session_id}: {e}")
                return []

    async def _sanitize_events_jsonl(self, session_id: str, error_msg: str) -> bool:
        """Strip unsupported event types from events.jsonl so session.resume can succeed.

        The CLI writes event types (e.g. system.notification) that its own
        JSON-RPC session.resume handler rejects. This extracts the offending
        type from the error message, removes those events, and re-links the
        parentId chain so remaining events stay connected.

        Returns True if events were removed, False otherwise.
        """
        import json as _json
        from copilot_console.app.config import COPILOT_SESSION_STATE

        # Extract the event type from error like: Unknown event type: "system.notification"
        match = re.search(r'Unknown event type:\s*"([^"]+)"', error_msg)
        if not match:
            logger.warning(f"Session {session_id} has unsupported event type but could not parse type from: {error_msg}")
            return False

        bad_type = match.group(1)
        logger.warning(f"Session {session_id} has unsupported event type '{bad_type}' — sanitizing events.jsonl")

        events_file = COPILOT_SESSION_STATE / session_id / "events.jsonl"
        if not events_file.exists():
            return False

        try:
            raw_lines = events_file.read_text(encoding="utf-8").splitlines()
            events = []
            for ln in raw_lines:
                ln = ln.strip()
                if ln:
                    try:
                        events.append(_json.loads(ln))
                    except _json.JSONDecodeError:
                        events.append(ln)  # preserve malformed lines as-is

            removed_redirect: dict[str, str | None] = {}
            kept = []
            for evt in events:
                if isinstance(evt, dict) and evt.get("type") == bad_type:
                    removed_redirect[evt["id"]] = evt.get("parentId")
                else:
                    kept.append(evt)

            if not removed_redirect:
                return False

            for evt in kept:
                if not isinstance(evt, dict):
                    continue
                pid = evt.get("parentId")
                while pid in removed_redirect:
                    pid = removed_redirect[pid]
                if pid != evt.get("parentId"):
                    evt["parentId"] = pid

            out_lines = []
            for evt in kept:
                if isinstance(evt, dict):
                    out_lines.append(_json.dumps(evt, ensure_ascii=False))
                else:
                    out_lines.append(evt)

            tmp = events_file.with_suffix(".jsonl.tmp")
            tmp.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
            tmp.replace(events_file)
            removed_count = len(removed_redirect)
            logger.debug(f"Sanitized events.jsonl for session {session_id}: removed {removed_count} '{bad_type}' event(s), retrying resume")
            return True
        except Exception as e:
            logger.warning(f"Failed to sanitize events.jsonl for session {session_id}: {e}")
            return False

    # -------------------------------------------------------------------------
    # Per-session client operations
    # -------------------------------------------------------------------------

    async def get_session_client(self, session_id: str, cwd: str) -> SessionClient:
        """Get or create a per-session client with the given CWD."""
        async with self._get_lock():
            if session_id in self._session_clients:
                client = self._session_clients[session_id]
                # If CWD changed, need to recreate client
                if client.cwd != cwd:
                    logger.debug(f"[{session_id}] CWD changed from {client.cwd} to {cwd}, recreating client")
                    await client.stop()
                    client = SessionClient(session_id, cwd)
                    self._session_clients[session_id] = client
                return client

            client = SessionClient(session_id, cwd)
            self._session_clients[session_id] = client
            return client

    async def destroy_session_client(self, session_id: str) -> None:
        """Destroy a per-session client (when tab closes)."""
        self.cancel_pending_elicitations(session_id)
        self._session_msg_locks.pop(session_id, None)
        close_session_log(session_id)
        async with self._get_lock():
            client = self._session_clients.pop(session_id, None)

        if client:
            client.event_queue = None
            await client.stop()

    async def delete_session(self, session_id: str) -> None:
        """Delete a session permanently using SDK's session.destroy().

        If the session is already active (has a SessionClient), use that client
        to destroy the session, then stop the client.

        If the session is not active, use main client to resume temporarily and destroy.

        Also deletes the session data from disk (~/.copilot/session-state/).
        """
        # Check if session is already active
        async with self._get_lock():
            existing_client = self._session_clients.pop(session_id, None)

        if existing_client:
            logger.info(f"[{session_id}] Deleting active session")
            await existing_client.stop()
        else:
            logger.info(f"[{session_id}] Deleting inactive session (temporary resume via main client)")
            await self._start_main_client()
            assert self._main_client is not None

            try:
                destroy_config: dict = {"streaming": False}
                if approve_all_permissions:
                    destroy_config["on_permission_request"] = approve_all_permissions
                session = await self._main_client.resume_session(session_id, **destroy_config)
                await session.destroy()
                logger.info(f"[{session_id}] Session destroyed via main client")
            except Exception as e:
                logger.warning(f"[{session_id}] Error deleting session: {e}")

        self._delete_session_from_disk(session_id)

    def _delete_session_from_disk(self, session_id: str) -> None:
        """Delete session data from disk (~/.copilot/session-state/)."""
        import shutil
        from copilot_console.app.config import COPILOT_SESSION_STATE

        session_folder = COPILOT_SESSION_STATE / session_id
        if session_folder.exists():
            try:
                shutil.rmtree(session_folder)
                logger.info(f"[{session_id}] Deleted session folder from disk: {session_folder}")
            except Exception as e:
                logger.warning(f"[{session_id}] Error deleting session folder: {e}")

    def is_session_active(self, session_id: str) -> bool:
        """Check if a session has an active client."""
        return session_id in self._session_clients

    def get_session_cwd(self, session_id: str) -> str | None:
        """Get the CWD of an active session's client."""
        client = self._session_clients.get(session_id)
        return client.cwd if client else None

    async def set_session_mode(self, session_id: str, mode: str, cwd: str,
                                mcp_servers: dict[str, dict] | None = None,
                                tools: list[Tool] | None = None,
                                available_tools: list[str] | None = None,
                                excluded_tools: list[str] | None = None,
                                system_message: dict | None = None,
                                custom_agents: list[dict] | None = None) -> str:
        """Set agent mode on a session, activating it if needed.

        Deprecated: Use update_runtime_settings() instead.
        """
        result = await self.update_runtime_settings(
            session_id, cwd, mode=mode,
            mcp_servers=mcp_servers, tools=tools,
            available_tools=available_tools, excluded_tools=excluded_tools,
            system_message=system_message, custom_agents=custom_agents,
        )
        return result.get("mode", mode)

    async def update_runtime_settings(self, session_id: str, cwd: str, *,
                                       mode: str | None = None,
                                       model: str | None = None,
                                       reasoning_effort: str | None = None,
                                       mcp_servers: dict[str, dict] | None = None,
                                       tools: list[Tool] | None = None,
                                       available_tools: list[str] | None = None,
                                       excluded_tools: list[str] | None = None,
                                       system_message: dict | None = None,
                                       custom_agents: list[dict] | None = None) -> dict:
        """Update runtime settings (mode, model) on a session, activating it if needed."""
        client = await self.get_session_client(session_id, cwd)
        await client.get_or_create_session(
            model="", mcp_servers=mcp_servers, tools=tools,
            available_tools=available_tools, excluded_tools=excluded_tools,
            system_message=system_message, custom_agents=custom_agents,
        )

        result: dict = {}
        if mode is not None:
            confirmed_mode = await client.set_mode(mode)
            result["mode"] = confirmed_mode
        if model is not None:
            confirmed_model = await client.set_model(model, reasoning_effort)
            result["model"] = confirmed_model
            result["reasoning_effort"] = reasoning_effort
        return result

    async def start_fleet(self, session_id: str, cwd: str, prompt: str | None = None,
                          mcp_servers: dict[str, dict] | None = None,
                          tools: list[Tool] | None = None,
                          available_tools: list[str] | None = None,
                          excluded_tools: list[str] | None = None,
                          system_message: dict | None = None,
                          custom_agents: list[dict] | None = None) -> dict:
        """Start fleet mode on a session, activating it if needed."""
        client = await self.get_session_client(session_id, cwd)
        await client.get_or_create_session(
            model="", mcp_servers=mcp_servers, tools=tools,
            available_tools=available_tools, excluded_tools=excluded_tools,
            system_message=system_message, custom_agents=custom_agents,
        )
        return await client.start_fleet(prompt)

    async def compact_session(self, session_id: str, cwd: str,
                              mcp_servers: dict[str, dict] | None = None,
                              tools: list[Tool] | None = None,
                              available_tools: list[str] | None = None,
                              excluded_tools: list[str] | None = None,
                              system_message: dict | None = None,
                              custom_agents: list[dict] | None = None) -> dict:
        """Compact session context, activating the session if needed."""
        client = await self.get_session_client(session_id, cwd)
        await client.get_or_create_session(
            model="", mcp_servers=mcp_servers, tools=tools,
            available_tools=available_tools, excluded_tools=excluded_tools,
            system_message=system_message, custom_agents=custom_agents,
        )
        return await client.compact()

    async def send_message(
        self,
        session_id: str,
        model: str,
        cwd: str,
        prompt: str,
        mcp_servers: dict[str, dict] | None = None,
        tools: list[Tool] | None = None,
        available_tools: list[str] | None = None,
        excluded_tools: list[str] | None = None,
        system_message: dict | None = None,
        is_new_session: bool = False,
        mode: str | None = None,
        attachments: list[dict] | None = None,
        custom_agents: list[dict] | None = None,
        reasoning_effort: str | None = None,
        agent_mode: str | None = None,
        fleet: bool = False,
        compact: bool = False,
        agent: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Send a message and stream the response.

        Uses per-session client with the given CWD.
        Event processing is delegated to EventProcessor.
        """
        logger.debug(f"User prompt: {prompt}")

        # Get or create per-session client
        client = await self.get_session_client(session_id, cwd)

        # Create elicitation handlers via ElicitationManager
        elicitation_handler = self._elicitation_mgr.make_elicitation_handler(
            session_id, self._session_clients.get,
        )
        user_input_handler = self._elicitation_mgr.make_user_input_handler(
            session_id, self._session_clients.get,
        )
        event_queue: asyncio.Queue[dict | None] = asyncio.Queue(maxsize=_EVENT_QUEUE_MAX)
        client.event_queue = event_queue

        session = await client.get_or_create_session(
            model, mcp_servers, tools, available_tools, excluded_tools,
            system_message, is_new_session, custom_agents, reasoning_effort,
            on_elicitation_request=elicitation_handler,
            on_user_input_request=user_input_handler,
        )

        # Set agent mode if explicitly requested
        if agent_mode and agent_mode != "interactive":
            try:
                await client.set_mode(agent_mode)
            except Exception as e:
                logger.warning(f"[{session_id}] Failed to set agent mode '{agent_mode}': {e}")

        # Run deferred compact if requested (from new/resumed session)
        # NOTE: compact requires an active agent context, which only exists
        # after session.send() completes. We defer it to post-turn below.
        pending_compact = compact

        # Select agent if requested (from new/resumed session)
        if agent:
            try:
                result = await client.set_agent(agent)
                yield {"event": "step", "data": {"title": f"🤖 Agent selected", "detail": result.get("name", agent)}}
            except Exception as e:
                logger.warning(f"[{session_id}] Failed to select agent '{agent}': {e}")
                yield {"event": "step", "data": {"title": "✗ Agent selection failed", "detail": str(e)}}

        done = asyncio.Event()

        # Delegate event processing to EventProcessor
        processor = EventProcessor(
            session_id=session_id,
            event_queue=event_queue,
            done=done,
            touch_callback=client.touch,
        )
        session.on(processor.on_event)

        # Fleet mode: fire fleet.start() as a concurrent task so it doesn't
        # block the generator. Events flow through on_event → queue → yield.
        # session.idle (the last event) terminates the stream.
        if fleet:
            logger.debug(f"[{session_id}] Starting fleet mode")

            async def _run_fleet() -> None:
                try:
                    result = await client.start_fleet(prompt)
                    logger.debug(f"[{session_id}] Fleet RPC returned: started={result.get('started')}")
                except Exception as e:
                    logger.error(f"[{session_id}] Fleet RPC error: {e}", exc_info=True)
                    if not done.is_set():
                        processor.terminate_stream()

            asyncio.create_task(_run_fleet())
        else:
            send_kwargs: dict = {}
            if mode:
                send_kwargs["mode"] = mode
            if attachments:
                send_kwargs["attachments"] = attachments
            await session.send(prompt, **send_kwargs)

        # Main event consumption loop.
        while not done.is_set():
            try:
                item = await asyncio.wait_for(event_queue.get(), timeout=1.0)
                if item is None:
                    break
                yield item
            except asyncio.TimeoutError:
                continue

        # Drain any remaining queued events
        while not event_queue.empty():
            item = event_queue.get_nowait()
            if item is not None:
                yield item

        # Run deferred compact AFTER the turn completes (agent context is now active).
        # The SDK emits its own ⟳/✓ step events through the event listener, which
        # land on event_queue. We drain them after compact completes.
        if pending_compact:
            try:
                result = await client.compact()
                logger.info(
                    f"[{session_id}] Deferred compact: tokens_removed={result.get('tokens_removed', 0)}, "
                    f"messages_removed={result.get('messages_removed', 0)}"
                )
            except Exception as e:
                logger.warning(f"[{session_id}] Deferred compact failed: {e}")
            # Drain compact events from the queue
            await asyncio.sleep(0.1)  # let SDK events propagate
            while not event_queue.empty():
                item = event_queue.get_nowait()
                if item is not None:
                    yield item

        logger.debug(f"[{session_id}] Agent responded")

    async def send_message_background(
        self,
        session_id: str,
        model: str,
        cwd: str,
        prompt: str,
        buffer: "ResponseBuffer",
        mcp_servers: dict[str, dict] | None = None,
        tools: list[Tool] | None = None,
        available_tools: list[str] | None = None,
        excluded_tools: list[str] | None = None,
        system_message: dict | None = None,
        is_new_session: bool = False,
        mode: str | None = None,
        attachments: list[dict] | None = None,
        custom_agents: list[dict] | None = None,
        reasoning_effort: str | None = None,
        agent_mode: str | None = None,
        fleet: bool = False,
        compact: bool = False,
        agent: str | None = None,
    ) -> None:
        """Send a message in a background task that won't be cancelled.

        This method runs independently of the SSE connection, so the agent
        continues running even if the browser disconnects.

        Results are written to the buffer, which SSE consumers read from.
        """
        logger.debug(f"[{session_id}] Background task started for prompt: {prompt[:100]}...")

        try:
            async for evt in self.send_message(
                session_id=session_id,
                model=model,
                cwd=cwd,
                prompt=prompt,
                mcp_servers=mcp_servers,
                tools=tools,
                available_tools=available_tools,
                excluded_tools=excluded_tools,
                system_message=system_message,
                is_new_session=is_new_session,
                mode=mode,
                attachments=attachments,
                custom_agents=custom_agents,
                reasoning_effort=reasoning_effort,
                agent_mode=agent_mode,
                fleet=fleet,
                compact=compact,
                agent=agent,
            ):
                event_type = evt.get("event")

                if event_type == "delta":
                    content = (evt.get("data") or {}).get("content") or ""
                    if content:
                        buffer.add_chunk(content)
                elif event_type == "step":
                    buffer.add_step(evt.get("data") or {})
                elif event_type == "usage_info":
                    buffer.add_usage_info(evt.get("data") or {})
                elif event_type == "pending_messages":
                    buffer.add_notification("pending_messages", evt.get("data") or {})
                elif event_type == "turn_done":
                    buffer.add_notification("turn_done", evt.get("data") or {})
                elif event_type == "title_changed":
                    title = (evt.get("data") or {}).get("title")
                    if title:
                        buffer.updated_session_name = title
                elif event_type == "mode_changed":
                    buffer.add_notification("mode_changed", evt.get("data") or {})
                elif event_type == "elicitation":
                    buffer.add_notification("elicitation", evt.get("data") or {})
                elif event_type == "ask_user":
                    buffer.add_notification("ask_user", evt.get("data") or {})
        except asyncio.CancelledError:
            logger.warning(f"[{session_id}] Background task was cancelled")
            buffer.fail("Task was cancelled")
            raise
        except Exception as e:
            logger.error(f"[{session_id}] Background task error: {e}", exc_info=True)
            buffer.fail(str(e))
            raise

        logger.debug(f"[{session_id}] Background task finished streaming")

    async def enqueue_message(self, session_id: str, prompt: str, attachments: list[dict] | None = None) -> dict:
        """Enqueue a message to an already-active session."""
        client = self._session_clients.get(session_id)
        if not client or not client.session:
            raise ValueError(f"No active session for {session_id}")

        session = client.session
        client.touch()
        send_opts: dict = {"prompt": prompt, "mode": "enqueue"}
        if attachments:
            send_opts["attachments"] = attachments
        message_id = await session.send(send_opts)
        logger.debug(f"[{session_id}] Enqueued message: {prompt[:100]}... -> {message_id}")
        return {"status": "enqueued", "message_id": message_id}

    async def abort_session(self, session_id: str) -> dict:
        """Abort the currently processing message in a session."""
        client = self._session_clients.get(session_id)
        if not client or not client.session:
            raise ValueError(f"No active session for {session_id}")

        session = client.session
        await session.abort()
        logger.debug(f"[{session_id}] Aborted current message")
        return {"status": "aborted"}


# Singleton instance
copilot_service = CopilotService()


