"""Copilot SDK service wrapper with per-session clients.

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
"""

import asyncio
import glob
import os
import re
import time
from typing import AsyncGenerator, TYPE_CHECKING

from copilot import CopilotClient
from copilot.types import Tool
from copilot.generated.rpc import Mode, SessionModeSetParams

# SDK >=0.1.28 requires on_permission_request for create/resume session.
# Import approve_all if available, otherwise provide a fallback for older SDKs.
try:
    from copilot.types import PermissionHandler
    approve_all_permissions = PermissionHandler.approve_all
except (ImportError, AttributeError):
    approve_all_permissions = None

from copilot_console.app.config import DEFAULT_MODELS
from copilot_console.app.services.logging_service import get_logger

if TYPE_CHECKING:
    from copilot_console.app.services.response_buffer import ResponseBuffer

logger = get_logger(__name__)


def _parse_agent_file(filepath: str) -> dict | None:
    """Parse a .agent.md file into a custom agent config dict.
    
    Extracts the YAML frontmatter for description and uses the file body as the prompt.
    Returns None if the file is malformed (missing frontmatter).
    """
    basename = os.path.basename(filepath)
    name = basename.replace(".agent.md", "")
    
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception:
        return None
    
    # Parse YAML frontmatter (---\n...\n---)
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if not match:
        return None
    
    fm = match.group(1)
    description = ""
    for line in fm.split("\n"):
        if line.startswith("description:"):
            description = line[len("description:"):].strip()
            break
    
    body = content[match.end():].strip()
    
    return {
        "name": name,
        "display_name": name,
        "description": description,
        "prompt": body,
    }


def discover_workspace_agents(cwd: str) -> list[dict]:
    """Discover .agent.md files from the workspace and user home .github/agents/ dirs.
    
    Scans two locations (matching CLI behavior):
    1. [cwd]/.github/agents/*.agent.md  (project-level)
    2. ~/.github/agents/*.agent.md      (user-level)
    
    Returns a list of custom agent config dicts ready for the SDK's custom_agents param.
    """
    agents: list[dict] = []
    seen_names: set[str] = set()
    
    dirs_to_scan = [
        os.path.join(cwd, ".github", "agents"),
        os.path.join(os.path.expanduser("~"), ".github", "agents"),
    ]
    
    for agents_dir in dirs_to_scan:
        if not os.path.isdir(agents_dir):
            continue
        for filepath in sorted(glob.glob(os.path.join(agents_dir, "*.agent.md"))):
            agent = _parse_agent_file(filepath)
            if agent and agent["name"] not in seen_names:
                agents.append(agent)
                seen_names.add(agent["name"])
    
    return agents


class SessionClient:
    """Wrapper for a per-session CopilotClient with CWD."""
    
    def __init__(self, session_id: str, cwd: str):
        self.session_id = session_id
        self.cwd = cwd
        self.client: CopilotClient | None = None
        self.session: object | None = None  # SDK session object
        self.started = False
        self.last_activity = time.time()
    
    async def start(self) -> None:
        """Start the client with CWD."""
        if self.started:
            return
        
        self.client = CopilotClient({
            "cwd": self.cwd,
        })
        await self.client.start()
        self.started = True
        self.last_activity = time.time()
        logger.info(f"[{self.session_id}] Started per-session client with cwd={self.cwd}")
    
    async def stop(self) -> None:
        """Stop the client and destroy session."""
        if not self.started or not self.client:
            return
        
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
        logger.info(f"[{self.session_id}] Stopped per-session client")
    
    def touch(self) -> None:
        """Update last activity timestamp."""
        self.last_activity = time.time()
    
    async def create_session(self, model: str, mcp_servers: dict[str, dict] | None = None, tools: list[Tool] | None = None, available_tools: list[str] | None = None, excluded_tools: list[str] | None = None, system_message: dict | None = None, custom_agents: list[dict] | None = None, reasoning_effort: str | None = None) -> object:
        """Create a new SDK session.
        
        Args:
            model: Model ID for the session
            mcp_servers: Optional dict of MCP servers to load
            tools: Optional list of SDK Tool objects for local/custom tools
            available_tools: Optional list of built-in tool names to whitelist (opt-in)
            excluded_tools: Optional list of built-in tool names to blacklist (opt-out, ignored if available_tools set)
            system_message: Optional system message dict with mode and content
            custom_agents: Optional list of SDK CustomAgentConfig dicts (Agent Teams)
        """
        await self.start()
        assert self.client is not None
        
        session_opts: dict = {
            "session_id": self.session_id,
            "model": model,
            "streaming": True,
        }
        
        if approve_all_permissions:
            session_opts["on_permission_request"] = approve_all_permissions
        
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
        
        # Auto-discover workspace agents from .github/agents/ dirs
        # and merge with any explicitly-provided custom agents
        workspace_agents = discover_workspace_agents(self.cwd)
        if workspace_agents:
            existing = session_opts.get("custom_agents", [])
            existing_names = {a["name"] for a in existing}
            # Add workspace agents that don't conflict with explicit agents
            for wa in workspace_agents:
                if wa["name"] not in existing_names:
                    existing.append(wa)
            session_opts["custom_agents"] = existing
            logger.info(f"[{self.session_id}] Discovered {len(workspace_agents)} workspace agents")
        
        if reasoning_effort:
            session_opts["reasoning_effort"] = reasoning_effort
        
        session_opts["working_directory"] = self.cwd
        
        self.session = await self.client.create_session(session_opts)
        self.touch()
        logger.info(f"[{self.session_id}] Created SDK session with model={model}, working_directory={self.cwd}, mcp_servers={len(mcp_servers or {})}, tools={len(tools or [])}, system_message={'yes' if system_message else 'no'}, custom_agents={len(custom_agents or [])}")
        return self.session
    
    async def resume_session(self, mcp_servers: dict[str, dict] | None = None, tools: list[Tool] | None = None, available_tools: list[str] | None = None, excluded_tools: list[str] | None = None, system_message: dict | None = None, custom_agents: list[dict] | None = None) -> object | None:
        """Resume an existing SDK session."""
        await self.start()
        assert self.client is not None
        
        try:
            resume_opts: dict = {"streaming": True}
            if approve_all_permissions:
                resume_opts["on_permission_request"] = approve_all_permissions
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
            
            # Auto-discover workspace agents and merge
            workspace_agents = discover_workspace_agents(self.cwd)
            if workspace_agents:
                existing = resume_opts.get("custom_agents", [])
                existing_names = {a["name"] for a in existing}
                for wa in workspace_agents:
                    if wa["name"] not in existing_names:
                        existing.append(wa)
                resume_opts["custom_agents"] = existing
            
            resume_opts["working_directory"] = self.cwd
            
            logger.info(f"[{self.session_id}] Resuming SDK session with custom_agents={len(custom_agents or [])}")
            self.session = await self.client.resume_session(self.session_id, resume_opts)
            self.touch()
            logger.info(f"[{self.session_id}] Resumed SDK session with mcp_servers={len(mcp_servers or {})}, tools={len(tools or [])}")
            return self.session
        except Exception as e:
            logger.warning(f"[{self.session_id}] Could not resume session: {e}")
            return None
    
    async def get_or_create_session(self, model: str, mcp_servers: dict[str, dict] | None = None, tools: list[Tool] | None = None, available_tools: list[str] | None = None, excluded_tools: list[str] | None = None, system_message: dict | None = None, is_new_session: bool = False, custom_agents: list[dict] | None = None, reasoning_effort: str | None = None) -> object:
        """Get existing session or create/resume one."""
        if self.session:
            self.touch()
            return self.session
        
        # For new sessions, skip resume attempt - we know it doesn't exist in SDK
        if not is_new_session:
            logger.info(f"[{self.session_id}] Attempting to resume existing session")
            session = await self.resume_session(mcp_servers, tools, available_tools, excluded_tools, system_message, custom_agents)
            if session:
                return session
        else:
            logger.info(f"[{self.session_id}] New session - skipping resume attempt")
        
        # Create new
        return await self.create_session(model, mcp_servers, tools, available_tools, excluded_tools, system_message, custom_agents, reasoning_effort)

    async def set_mode(self, mode: str) -> str:
        """Set the agent mode (interactive/plan/autopilot) on the active session."""
        if not self.session:
            raise RuntimeError(f"[{self.session_id}] No active session to set mode on")
        result = await self.session.rpc.mode.set(SessionModeSetParams(mode=Mode(mode)))
        self.touch()
        logger.info(f"[{self.session_id}] Mode set to {result.mode.value}")
        return result.mode.value


class CopilotService:
    """Wrapper around the Copilot SDK with per-session clients.
    
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

    def _get_lock(self) -> asyncio.Lock:
        """Get or create the async lock (must be called in async context)."""
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def _start_main_client(self) -> None:
        """Start the main client (for listing/reading)."""
        if self._main_started:
            return
        
        async with self._get_lock():
            if self._main_started:
                return
            
            try:
                self._main_client = CopilotClient({})
                await self._main_client.start()
                self._main_started = True
                logger.info(f"Main CopilotClient started (CLI: {self._main_client.options.get('cli_path', 'bundled')})")
                
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
            logger.info(f"Listed {len(result)} models from SDK")
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
            logger.info(f"Listed {len(sessions)} sessions from SDK")
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
                session = await self._main_client.resume_session(session_id, resume_config)
                messages = await session.get_messages()
                logger.info(f"Fetched {len(messages)} messages from session {session_id} (temporary resume)")
                try:
                    await session.destroy()
                except Exception:
                    pass  # Best-effort cleanup — session data persists on disk regardless
                return messages
            except Exception as e:
                logger.warning(f"Could not get messages for session {session_id}: {e}")
                return []

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
                    logger.info(f"[{session_id}] CWD changed from {client.cwd} to {cwd}, recreating client")
                    await client.stop()
                    client = SessionClient(session_id, cwd)
                    self._session_clients[session_id] = client
                return client
            
            client = SessionClient(session_id, cwd)
            self._session_clients[session_id] = client
            return client

    async def destroy_session_client(self, session_id: str) -> None:
        """Destroy a per-session client (when tab closes)."""
        async with self._get_lock():
            client = self._session_clients.pop(session_id, None)
        
        if client:
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
            # Session is active - use existing client to destroy
            logger.info(f"[{session_id}] Deleting active session")
            await existing_client.stop()  # This calls session.destroy() and client.stop()
        else:
            # Session not active - use main client to resume temporarily and destroy
            logger.info(f"[{session_id}] Deleting inactive session (temporary resume via main client)")
            await self._start_main_client()
            assert self._main_client is not None
            
            try:
                # Resume the session just to destroy it
                destroy_config: dict = {"streaming": False}
                if approve_all_permissions:
                    destroy_config["on_permission_request"] = approve_all_permissions
                session = await self._main_client.resume_session(session_id, destroy_config)
                await session.destroy()
                logger.info(f"[{session_id}] Session destroyed via main client")
            except Exception as e:
                logger.warning(f"[{session_id}] Error deleting session: {e}")
        
        # Also delete the session data from disk (SDK may not do this)
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
        """Set agent mode on a session, activating it if needed."""
        client = await self.get_session_client(session_id, cwd)
        # Ensure SDK session exists (resume if needed)
        await client.get_or_create_session(
            model="", mcp_servers=mcp_servers, tools=tools,
            available_tools=available_tools, excluded_tools=excluded_tools,
            system_message=system_message, custom_agents=custom_agents,
        )
        return await client.set_mode(mode)

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
    ) -> AsyncGenerator[dict, None]:
        """Send a message and stream the response.

        Uses per-session client with the given CWD.
        """
        logger.info(f"User prompt: {prompt}")

        # Get or create per-session client
        client = await self.get_session_client(session_id, cwd)
        session = await client.get_or_create_session(model, mcp_servers, tools, available_tools, excluded_tools, system_message, is_new_session, custom_agents, reasoning_effort)

        # Set agent mode if explicitly requested (e.g. user changed to plan/autopilot before first message)
        if agent_mode and agent_mode != "interactive":
            try:
                await client.set_mode(agent_mode)
            except Exception as e:
                logger.warning(f"[{session_id}] Failed to set agent mode '{agent_mode}': {e}")

        done = asyncio.Event()
        event_queue: asyncio.Queue[dict | None] = asyncio.Queue()
        full_response: list[str] = []
        reasoning_buffer: list[str] = []
        
        # Helper to log all events
        def _clean_text(text: str) -> str:
            if not text:
                return text
            text = text.replace('\\r\\n', '\n').replace('\\n', '\n').replace('\\r', '')
            text = text.replace('\r\n', '\n').replace('\r', '')
            return text

        def _get_text(data: object) -> str:
            if data is None:
                return ""
            for attr in ("delta_content", "content", "text", "delta"):
                try:
                    value = getattr(data, attr, None)
                except Exception:
                    value = None
                if isinstance(value, str) and value:
                    return value
            if isinstance(data, dict):
                for key in ("delta_content", "content", "text", "delta"):
                    value = data.get(key)
                    if isinstance(value, str) and value:
                        return value
            return ""

        def _format_tool_prompt(data: object) -> str:
            question = getattr(data, "question", None)
            if not isinstance(question, str) or not question.strip():
                question = None

            choices = getattr(data, "choices", None)
            if isinstance(choices, (list, tuple)):
                choice_lines = [f"- {c}" for c in choices if isinstance(c, str) and c]
            else:
                choice_lines = []

            if question and choice_lines:
                return "".join([
                    question.strip(),
                    "\n\nChoices:\n",
                    "\n".join(choice_lines),
                ])
            if question:
                return question.strip()

            tool_requests = getattr(data, "tool_requests", None) or getattr(data, "toolRequests", None)
            if tool_requests:
                return ""
            if isinstance(data, dict) and (data.get("tool_requests") or data.get("toolRequests")):
                return ""

            return ""

        compacting = False  # True while context compaction is in progress

        # Track whether compaction is in progress so we keep the stream open
        compacting = False
        idle_received = False
        last_token_limit: int | None = None

        def _enqueue_step(title: str, detail: str | None = None) -> None:
            payload = {"title": title}
            if detail and detail.strip():
                payload["detail"] = detail
            event_queue.put_nowait({"event": "step", "data": payload})

        def _terminate_stream() -> None:
            """Push sentinel to end the generator loop."""
            event_queue.put_nowait(None)
            done.set()

        def on_event(event):
            nonlocal compacting, idle_received, last_token_limit
            # Keep session alive during long-running operations
            # This prevents the idle cleanup from killing an active agent
            client.touch()
            
            event_type = event.type.value if hasattr(event.type, "value") else str(event.type)
            data = getattr(event, "data", None)

            if event_type == "assistant.message_delta":
                delta = _get_text(data)
                if delta:
                    full_response.append(delta)
                    event_queue.put_nowait({"event": "delta", "data": {"content": delta}})

            elif event_type == "assistant.message":
                if not full_response:
                    content = _get_text(data)
                    if not content.strip():
                        content = _format_tool_prompt(data)
                    if content.strip():
                        full_response.append(content)
                        event_queue.put_nowait({"event": "delta", "data": {"content": content}})

                # assistant.message is the SDK's per-response turn boundary.
                # Always emit turn_done so the frontend can finalize this
                # response — works for both single and enqueued messages.
                if full_response:
                    event_queue.put_nowait({"event": "turn_done", "data": {}})
                full_response.clear()
                logger.debug(f"[{session_id}] assistant.message — turn boundary emitted")

            elif event_type == "assistant.reasoning_delta":
                text = _get_text(data)
                if text:
                    reasoning_buffer.append(text)

            elif event_type == "assistant.reasoning":
                if reasoning_buffer:
                    full_reasoning = "".join(reasoning_buffer)
                    reasoning_buffer.clear()
                else:
                    full_reasoning = _get_text(data)
                if full_reasoning.strip():
                    _enqueue_step("Reasoning", full_reasoning)

            elif event_type == "assistant.intent":
                intent = getattr(data, "intent", None)
                if isinstance(intent, str) and intent.strip():
                    _enqueue_step("Intent", intent)

            elif event_type == "tool.execution_start":
                tool = getattr(data, "tool_name", None) or getattr(data, "name", None)
                tool_call_id = getattr(data, "tool_call_id", None)
                args = getattr(data, "arguments", None) or getattr(data, "input", None)
                title = f"Tool: {tool}" if tool else "Tool"
                detail_parts = []
                if tool_call_id:
                    detail_parts.append(f"id={tool_call_id}")
                if args:
                    try:
                        import json
                        if isinstance(args, str):
                            detail_parts.append(f"Input: {_clean_text(args[:500])}")
                        elif isinstance(args, dict):
                            detail_parts.append(f"Input: {json.dumps(args, indent=2)[:500]}")
                        else:
                            detail_parts.append(f"Input: {_clean_text(str(args)[:500])}")
                    except Exception:
                        detail_parts.append(f"Input: {_clean_text(str(args)[:500])}")
                detail = "\n".join(detail_parts) if detail_parts else None
                _enqueue_step(title, detail)

            elif event_type == "tool.execution_progress":
                msg = getattr(data, "progress_message", None)
                if isinstance(msg, str) and msg.strip():
                    _enqueue_step("Tool progress", _clean_text(msg))

            elif event_type == "tool.execution_partial_result":
                # Skip partial results - they are cumulative and would repeat content
                # The final tool.execution_complete will have the full output
                pass

            elif event_type == "tool.execution_complete":
                tool = getattr(data, "tool_name", None) or getattr(data, "name", None)
                tool_call_id = getattr(data, "tool_call_id", None)
                result = getattr(data, "result", None) or getattr(data, "output", None)
                title = f"Tool done: {tool}" if tool else "Tool done"
                detail_parts = []
                if tool_call_id:
                    detail_parts.append(f"id={tool_call_id}")
                if result:
                    try:
                        result_str = str(result)[:1000]
                        if result_str.startswith("Result(content="):
                            import ast
                            try:
                                inner = result_str[len("Result(content="):-1]
                                parsed = ast.literal_eval(inner)
                                if isinstance(parsed, str):
                                    result_str = parsed[:1000]
                            except Exception:
                                pass
                        detail_parts.append(f"Output: {_clean_text(result_str)}")
                    except Exception:
                        pass
                detail = "\n".join(detail_parts) if detail_parts else None
                _enqueue_step(title, detail)

            elif event_type == "session.compaction_start":
                compacting = True
                _enqueue_step("⟳ Compacting context", "Background compaction started — summarizing older messages to free context space. You can continue chatting.")
                logger.info(f"[{session_id}] Compaction started")

            elif event_type == "session.compaction_complete":
                compacting = False
                success = getattr(data, "success", None)
                tokens_removed = getattr(data, "tokens_removed", None)
                pre_tokens = getattr(data, "pre_compaction_tokens", None)
                post_tokens = getattr(data, "post_compaction_tokens", None)
                msgs_removed = getattr(data, "messages_removed", None)
                checkpoint = getattr(data, "checkpoint_number", None)

                if success:
                    parts = ["Compaction completed successfully."]
                    if tokens_removed is not None and pre_tokens:
                        pct = round((tokens_removed / pre_tokens) * 100)
                        parts.append(f"Freed {int(tokens_removed):,} tokens ({pct}% of context).")
                    if post_tokens is not None:
                        parts.append(f"Context now: {int(post_tokens):,} tokens.")
                    if msgs_removed is not None:
                        parts.append(f"Messages summarized: {int(msgs_removed)}.")
                    if checkpoint is not None:
                        parts.append(f"Checkpoint #{int(checkpoint)} saved.")
                    _enqueue_step("✓ Context compacted", " ".join(parts))
                    # Emit updated token usage so the frontend token viewer refreshes
                    if post_tokens is not None and last_token_limit is not None:
                        event_queue.put_nowait({
                            "event": "usage_info",
                            "data": {
                                "tokenLimit": last_token_limit,
                                "currentTokens": post_tokens,
                                "messagesLength": 0
                            }
                        })
                else:
                    error = getattr(data, "error", None)
                    _enqueue_step("✗ Compaction failed", str(error) if error else "Compaction did not succeed.")
                logger.info(f"[{session_id}] Compaction complete: success={success}, tokens_removed={tokens_removed}")

                # If idle already arrived, now we can terminate
                if idle_received:
                    _terminate_stream()

            elif event_type == "session.error":
                msg = getattr(data, "message", None)
                if msg:
                    _enqueue_step("Session error", str(msg))

            elif event_type == "session.usage_info":
                # Forward token usage info to frontend
                token_limit = getattr(data, "token_limit", None)
                current_tokens = getattr(data, "current_tokens", None)
                messages_length = getattr(data, "messages_length", None)
                if token_limit:
                    last_token_limit = token_limit
                if token_limit and current_tokens is not None:
                    event_queue.put_nowait({
                        "event": "usage_info",
                        "data": {
                            "tokenLimit": token_limit,
                            "currentTokens": current_tokens,
                            "messagesLength": messages_length
                        }
                    })

            elif event_type == "pending_messages.modified":
                # Notify frontend that the pending message queue changed
                event_queue.put_nowait({
                    "event": "pending_messages",
                    "data": {}
                })

            elif event_type == "session.title_changed":
                title = getattr(event.data, "title", None)
                if title and isinstance(title, str) and title.strip():
                    event_queue.put_nowait({
                        "event": "title_changed",
                        "data": {"title": title.strip()}
                    })

            elif event_type == "session.mode_changed":
                new_mode = getattr(data, "new_mode", None)
                previous_mode = getattr(data, "previous_mode", None)
                if new_mode:
                    mode_val = new_mode.value if hasattr(new_mode, "value") else str(new_mode)
                    prev_val = previous_mode.value if hasattr(previous_mode, "value") else str(previous_mode) if previous_mode else None
                    event_queue.put_nowait({
                        "event": "mode_changed",
                        "data": {"mode": mode_val, "previous_mode": prev_val}
                    })
                    logger.info(f"[{session_id}] Mode changed: {prev_val} → {mode_val}")

            elif event_type == "session.idle":
                idle_received = True
                if compacting:
                    # Compaction in progress — keep stream open until it finishes
                    logger.info(f"[{session_id}] session.idle while compacting — waiting for compaction_complete")
                else:
                    # No compaction — terminate immediately
                    _terminate_stream()

        session.on(on_event)

        send_opts: dict = {"prompt": prompt}
        if mode:
            send_opts["mode"] = mode
        if attachments:
            send_opts["attachments"] = attachments
        await session.send(send_opts)

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

        complete_response = "".join(full_response)
        logger.debug(f"[{session_id}] Agent response: {complete_response}")

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
    ) -> None:
        """Send a message in a background task that won't be cancelled.
        
        This method runs independently of the SSE connection, so the agent
        continues running even if the browser disconnects.
        
        Results are written to the buffer, which SSE consumers read from.
        """
        logger.info(f"[{session_id}] Background task started for prompt: {prompt[:100]}...")
        
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
            ):
                event_type = evt.get("event")
                
                if event_type == "delta":
                    content = (evt.get("data") or {}).get("content") or ""
                    if content:
                        buffer.add_chunk(content)
                elif event_type == "step":
                    buffer.add_step(evt.get("data") or {})
                elif event_type == "usage_info":
                    # Forward usage_info events through buffer
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
        except asyncio.CancelledError:
            logger.warning(f"[{session_id}] Background task was cancelled")
            buffer.fail("Task was cancelled")
            raise
        except Exception as e:
            logger.error(f"[{session_id}] Background task error: {e}", exc_info=True)
            buffer.fail(str(e))
            raise
        
        # Note: buffer.complete() is NOT called here.
        # The caller (run_agent) is responsible for calling buffer.complete()
        # after any post-processing (e.g., auto-naming) so the SSE done event
        # includes all computed data.
        logger.info(f"[{session_id}] Background task finished streaming")

    async def enqueue_message(self, session_id: str, prompt: str, attachments: list[dict] | None = None) -> dict:
        """Enqueue a message to an already-active session.

        This sends the message with mode='enqueue' to the existing SDK session.
        The SDK queues the message internally and the running background task
        will process it after the current message completes.

        Returns:
            dict with status info
        """
        client = self._session_clients.get(session_id)
        if not client or not client.session:
            raise ValueError(f"No active session for {session_id}")

        session = client.session
        client.touch()
        send_opts: dict = {"prompt": prompt, "mode": "enqueue"}
        if attachments:
            send_opts["attachments"] = attachments
        message_id = await session.send(send_opts)
        logger.info(f"[{session_id}] Enqueued message: {prompt[:100]}... -> {message_id}")
        return {"status": "enqueued", "message_id": message_id}

    async def abort_session(self, session_id: str) -> dict:
        """Abort the currently processing message in a session.

        The session remains valid and can be used for new messages.

        Returns:
            dict with status info
        """
        client = self._session_clients.get(session_id)
        if not client or not client.session:
            raise ValueError(f"No active session for {session_id}")

        session = client.session
        await session.abort()
        logger.info(f"[{session_id}] Aborted current message")
        return {"status": "aborted"}


# Singleton instance
copilot_service = CopilotService()


