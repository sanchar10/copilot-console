"""Session service for business logic."""

import os
import json
import uuid
from datetime import datetime, timezone
from typing import Any

import aiofiles

from copilot_console.app.config import COPILOT_SESSION_STATE
from copilot_console.app.models.message import Message, MessageAttachment, MessageStep
from copilot_console.app.models.session import Session, SessionCreate, SessionUpdate, SessionWithMessages
from copilot_console.app.models.agent import AgentTools
from copilot_console.app.services.copilot_service import copilot_service
from copilot_console.app.services.mcp_service import mcp_service
from copilot_console.app.services.storage_service import storage_service
from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)


def _migrate_selections(value: Any) -> list[str]:
    """Migrate old dict[str, bool] selection format to list[str].
    
    Old format: {"server-a": true, "server-b": false}  -> ["server-a"]
    New format: ["server-a"]  -> ["server-a"]
    """
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [k for k, v in value.items() if v]
    return []


async def read_raw_events(session_id: str) -> list[dict[str, Any]]:
    """Read raw events from events.jsonl file asynchronously.
    
    The SDK doesn't expose reasoningText in its API, so we need to read
    the raw events file directly to get this information.
    """
    events_file = COPILOT_SESSION_STATE / session_id / "events.jsonl"
    events = []
    
    if not events_file.exists():
        return events
    
    try:
        async with aiofiles.open(events_file, 'r', encoding='utf-8') as f:
            async for line in f:
                line = line.strip()
                if line:
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
    except Exception as e:
        logger.warning(f"Failed to read events.jsonl for session {session_id}: {e}")
    
    return events


def get_session_mtime(session_id: str) -> datetime:
    """Get modification time of SDK session folder (UTC-aware)."""
    session_folder = COPILOT_SESSION_STATE / session_id
    if session_folder.exists():
        mtime = os.path.getmtime(session_folder)
        return datetime.fromtimestamp(mtime, tz=timezone.utc)
    return datetime.now(timezone.utc)


def get_default_mcp_servers() -> list[str]:
    """Get default MCP server selections (all enabled)."""
    config = mcp_service.get_available_servers()
    return [server.name for server in config.servers]


def _migrate_tools(value: Any) -> AgentTools:
    """Migrate old tools formats to new AgentTools model.
    
    Old format 1 (dict[str, bool]): {"greet": true, "calc": false} -> AgentTools(custom=["greet"])
    Old format 2 (list[str]):       ["greet", "calc"]               -> AgentTools(custom=["greet", "calc"])
    Old format 3 (available/custom): {"available": [...], "custom": [...]} -> AgentTools(custom=[...available])
    New format:                     {"custom": [...], "builtin": [...]}   -> AgentTools(...)
    """
    if isinstance(value, dict):
        if "builtin" in value:
            return AgentTools(**value)
        if "available" in value:
            return AgentTools(custom=value.get("available", []))
        # Old dict[str, bool] format
        return AgentTools(custom=[k for k, v in value.items() if v])
    if isinstance(value, list):
        return AgentTools(custom=value)
    return AgentTools()


def get_default_tools() -> AgentTools:
    """Get default tool selections (all custom tools enabled, no builtin filter)."""
    from copilot_console.app.services.tools_service import get_tools_service
    tools_service = get_tools_service()
    config = tools_service.get_tools_config()
    return AgentTools(custom=[tool.name for tool in config.tools])


class SessionService:
    """Business logic for session management - uses SDK for session lifecycle."""

    def __init__(self) -> None:
        # Sessions that need auto-naming after first agent response.
        # Populated by create_session() when name_set=False, consumed by
        # should_auto_name() after first response, then cleared.
        self._pending_auto_name: set[str] = set()

    async def create_session(self, request: SessionCreate) -> Session:
        """Create a new session.
        
        Note: We don't create the SDK session here - that happens lazily
        when the user sends their first message (with CWD).
        """
        session_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        # Get default CWD from settings
        settings = storage_service.get_settings()
        default_cwd = settings.get("default_cwd", str(os.path.expanduser("~")))
        
        # MCP servers and tools default to none selected — user opts in explicitly
        mcp_servers = request.mcp_servers if request.mcp_servers is not None else []
        tools = request.tools if request.tools is not None else AgentTools()

        session = Session(
            session_id=session_id,
            session_name=request.name or "New Session",
            model=request.model,
            reasoning_effort=request.reasoning_effort,
            cwd=request.cwd or default_cwd,
            mcp_servers=mcp_servers,
            tools=tools,
            system_message=request.system_message,
            sub_agents=request.sub_agents or [],
            agent_id=request.agent_id,
            trigger=request.trigger,
            # name_set = True only if user provided a custom name (not default)
            name_set=bool(request.name and request.name != "New Session"),
            created_at=now,
            updated_at=now,
        )

        # Save session metadata to our storage
        storage_service.save_session(session)

        # Track for auto-naming after first agent response
        if not session.name_set:
            self._pending_auto_name.add(session_id)

        return session

    async def list_sessions(self) -> list[Session]:
        """List all sessions from SDK, sorted by last update time.
        
        Timestamps: created_at from SDK startTime, updated_at from our
        completion_times.json (falls back to SDK modifiedTime for migration).
        """
        # Get sessions from SDK
        sdk_sessions = await copilot_service.list_sessions()
        
        # Load completion timestamps once for all sessions (single file read)
        from copilot_console.app.services.completion_times_service import completion_times_service
        completion_times = completion_times_service.get_all()
        
        sessions = []
        for sdk_session in sdk_sessions:
            # sdk_session is a SessionMetadata object, access attributes directly
            session_id = getattr(sdk_session, "sessionId", None) or getattr(sdk_session, "session_id", None)
            if not session_id:
                continue
            
            # Get timestamps from SDK session
            # SDK returns: startTime, modifiedTime (ISO format with Z suffix)
            sdk_start = getattr(sdk_session, "startTime", None)
            sdk_modified = getattr(sdk_session, "modifiedTime", None)
            
            # Prefer SDK timestamps; file mtime is last resort
            mtime = get_session_mtime(session_id)
            created_at = mtime
            if sdk_start:
                try:
                    created_at = datetime.fromisoformat(sdk_start.replace('Z', '+00:00'))
                except (ValueError, AttributeError):
                    pass
            
            # updated_at: prefer our completion_times (same clock as viewed.json),
            # fall back to SDK modifiedTime for migration / CLI sessions
            ct = completion_times.get(session_id)
            if ct is not None:
                updated_at = datetime.fromtimestamp(ct, tz=timezone.utc)
            else:
                updated_at = created_at
                if sdk_modified:
                    try:
                        updated_at = datetime.fromisoformat(sdk_modified.replace('Z', '+00:00'))
                    except (ValueError, AttributeError):
                        pass
            
            # Try to get our stored metadata for this session (name, cwd, model)
            stored_meta = storage_service.load_session(session_id)
            
            if stored_meta:
                # Merge stored metadata with SDK timestamps
                # Backward compat: old sessions without name_set field -
                # if name is still default "New Session", treat as not set
                name_set = stored_meta.get("name_set", None)
                if name_set is None:
                    name_set = stored_meta.get("session_name", "New Session") != "New Session"
                session_name = stored_meta.get("session_name", session_id)
                
                # Auto-update name from SDK summary if name not explicitly set
                if not name_set:
                    sdk_summary = getattr(sdk_session, "summary", None)
                    if sdk_summary and isinstance(sdk_summary, str) and sdk_summary.strip():
                        session_name = sdk_summary.strip()
                        # Persist the auto-name to storage so it sticks
                        stored_meta["session_name"] = session_name
                        stored_meta["name_set"] = False
                        try:
                            session_file = storage_service._session_file(session_id)
                            session_file.write_text(
                                json.dumps(stored_meta, indent=2, default=str), encoding="utf-8"
                            )
                        except Exception:
                            pass  # Non-critical, name will be re-fetched next time
                
                session = Session(
                    session_id=session_id,
                    session_name=session_name,
                    model=stored_meta.get("model", ""),
                    cwd=stored_meta.get("cwd"),
                    mcp_servers=_migrate_selections(stored_meta.get("mcp_servers", [])),
                    tools=_migrate_tools(stored_meta.get("tools", {})),
                    system_message=stored_meta.get("system_message"),
                    sub_agents=stored_meta.get("sub_agents", []),
                    name_set=name_set,
                    agent_id=stored_meta.get("agent_id"),
                    trigger=stored_meta.get("trigger"),
                    created_at=created_at,
                    updated_at=updated_at,
                )
                sessions.append(session)
            else:
                # CLI-created session - show minimal info, no CWD yet
                # Adoption happens when user clicks to view
                # Use summary as session name if available
                session_name = getattr(sdk_session, "summary", None) or session_id
                session = Session(
                    session_id=session_id,
                    session_name=session_name,
                    model="",  # SDK doesn't provide model in list_sessions
                    cwd=None,  # Not adopted yet
                    mcp_servers=[],  # No MCP servers yet
                    tools=AgentTools(),  # No tools yet
                    created_at=created_at,
                    updated_at=updated_at,
                )
                sessions.append(session)
        
        # Sort by updated_at descending (most recent first)
        sessions.sort(key=lambda s: s.updated_at, reverse=True)
        return sessions

    async def get_session(self, session_id: str) -> Session | None:
        """Get a session by ID - works for both our sessions and CLI sessions.
        
        Uses SDK metadata cache for timestamps (populated by sidebar list_sessions()).
        Only calls list_sessions() on cache miss during CLI session adoption.
        """
        # First check our storage for web-created sessions
        stored_meta = storage_service.load_session(session_id)
        
        # Try SDK metadata cache first (populated by sidebar refresh)
        sdk_session = copilot_service.get_cached_session_metadata(session_id)
        
        # If we have stored metadata (web-created or adopted CLI session)
        if stored_meta:
            from copilot_console.app.services.completion_times_service import completion_times_service
            ct = completion_times_service.get(session_id)
            
            if sdk_session:
                # Session exists in SDK - use SDK timestamps from cache
                mtime = get_session_mtime(session_id)
                sdk_start = getattr(sdk_session, "startTime", None)
                sdk_modified = getattr(sdk_session, "modifiedTime", None)
                
                created_at = mtime
                if sdk_start:
                    try:
                        created_at = datetime.fromisoformat(sdk_start.replace('Z', '+00:00'))
                    except (ValueError, AttributeError):
                        pass
                # Prefer completion_times, fall back to SDK modifiedTime
                if ct is not None:
                    updated_at = datetime.fromtimestamp(ct, tz=timezone.utc)
                else:
                    updated_at = created_at
                    if sdk_modified:
                        try:
                            updated_at = datetime.fromisoformat(sdk_modified.replace('Z', '+00:00'))
                        except (ValueError, AttributeError):
                            pass
            else:
                # Web-created session not yet in SDK (or cache miss) - use file mtime
                mtime = get_session_mtime(session_id)
                created_at = mtime
                updated_at = datetime.fromtimestamp(ct, tz=timezone.utc) if ct is not None else mtime
            
            return Session(
                session_id=session_id,
                session_name=stored_meta.get("session_name", session_id),
                model=stored_meta.get("model", ""),
                cwd=stored_meta.get("cwd"),
                mcp_servers=_migrate_selections(stored_meta.get("mcp_servers", [])),
                tools=_migrate_tools(stored_meta.get("tools", {})),
                system_message=stored_meta.get("system_message"),
                sub_agents=stored_meta.get("sub_agents", []),
                agent_id=stored_meta.get("agent_id"),
                trigger=stored_meta.get("trigger"),
                created_at=created_at,
                updated_at=updated_at,
            )
        
        # No stored metadata — could be a CLI session needing adoption.
        # Cache miss: fall back to list_sessions() to find it.
        if not sdk_session:
            sdk_sessions = await copilot_service.list_sessions()
            for s in sdk_sessions:
                sid = getattr(s, "sessionId", None) or getattr(s, "session_id", None)
                if sid == session_id:
                    sdk_session = s
                    break
        
        if not sdk_session:
            return None  # Session doesn't exist anywhere
        
        # CLI session - adopt it by creating metadata with defaults
        mtime = get_session_mtime(session_id)
        sdk_start = getattr(sdk_session, "startTime", None)
        sdk_modified = getattr(sdk_session, "modifiedTime", None)
        
        created_at = mtime
        if sdk_start:
            try:
                created_at = datetime.fromisoformat(sdk_start.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                pass
        # updated_at defaults to created_at, not mtime
        updated_at = created_at
        if sdk_modified:
            try:
                updated_at = datetime.fromisoformat(sdk_modified.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                pass
        
        settings = storage_service.get_settings()
        default_cwd = settings.get("default_cwd", str(os.path.expanduser("~")))
        
        # Use CWD from SDK session context if available, otherwise fall back to settings
        sdk_context = getattr(sdk_session, "context", None)
        session_cwd = getattr(sdk_context, "cwd", None) if sdk_context else None
        if not session_cwd:
            session_cwd = default_cwd
        
        # Use summary as session name if available
        session_name = getattr(sdk_session, "summary", None) or session_id
        
        # Adopted CLI sessions start with none selected (matching new-session behavior)
        default_mcp = []
        default_tools = AgentTools()
        
        session = Session(
            session_id=session_id,
            session_name=session_name,
            model="",  # SDK doesn't provide model in list_sessions
            cwd=session_cwd,
            mcp_servers=default_mcp,
            tools=default_tools,
            created_at=created_at,
            updated_at=updated_at,
        )
        # Save metadata so it's adopted
        storage_service.save_session(session)
        return session

    def get_session_local(self, session_id: str) -> Session | None:
        """Get a session from local storage only (no SDK call).
        
        Reads session.json and returns a Session object with file-based timestamps.
        Used by /messages when the session config is needed but list_sessions() is not.
        """
        stored_meta = storage_service.load_session(session_id)
        if not stored_meta:
            return None
        
        mtime = get_session_mtime(session_id)
        
        # Prefer completion_times for updated_at (same clock as viewed.json)
        from copilot_console.app.services.completion_times_service import completion_times_service
        ct = completion_times_service.get(session_id)
        updated_at = datetime.fromtimestamp(ct, tz=timezone.utc) if ct is not None else mtime
        
        return Session(
            session_id=session_id,
            session_name=stored_meta.get("session_name", session_id),
            model=stored_meta.get("model", ""),
            cwd=stored_meta.get("cwd"),
            mcp_servers=_migrate_selections(stored_meta.get("mcp_servers", [])),
            tools=_migrate_tools(stored_meta.get("tools", {})),
            system_message=stored_meta.get("system_message"),
            sub_agents=stored_meta.get("sub_agents", []),
            agent_id=stored_meta.get("agent_id"),
            trigger=stored_meta.get("trigger"),
            created_at=mtime,
            updated_at=updated_at,
        )

    def should_auto_name(self, session_id: str) -> bool:
        """Check if session needs auto-naming (without consuming the flag)."""
        return session_id in self._pending_auto_name

    def consume_auto_name(self, session_id: str) -> bool:
        """Atomically check and remove from pending set. Returns True if was pending."""
        if session_id in self._pending_auto_name:
            self._pending_auto_name.discard(session_id)
            return True
        return False

    async def get_session_with_messages(self, session_id: str) -> SessionWithMessages | None:
        """Get a session with its message history from SDK, including steps."""
        import json
        import logging
        logger = logging.getLogger(__name__)
        
        session = await self.get_session(session_id)
        if not session:
            logger.warning(f"Session {session_id} not found")
            return None

        messages: list[Message] = []
        pending_steps: list[dict] = []  # Steps to attach to next assistant message

        def _format_assistant_content(data: object) -> str | None:
            """Format assistant history for UI."""
            if data is None:
                return None

            content = getattr(data, "content", None)
            if isinstance(content, str) and content.strip():
                return content

            # Tool-style prompts (e.g., ask_user)
            question = getattr(data, "question", None)
            if isinstance(question, str) and question.strip():
                choices = getattr(data, "choices", None)
                if isinstance(choices, (list, tuple)) and choices:
                    choice_lines = [f"- {c}" for c in choices if isinstance(c, str) and c]
                    if choice_lines:
                        return "".join([
                            question.strip(),
                            "\n\nChoices:\n",
                            "\n".join(choice_lines),
                        ])
                return question.strip()

            # Internal tool-call payloads: don't show
            tool_requests = getattr(data, "tool_requests", None) or getattr(data, "toolRequests", None)
            if tool_requests:
                return None
            if isinstance(data, dict) and (data.get("tool_requests") or data.get("toolRequests")):
                return None

            # Extra safety: never render verbose SDK object reprs
            try:
                if str(data).startswith("Data("):
                    return None
            except Exception:
                pass

            return None

        def _clean_text(text: str) -> str:
            """Clean up escape sequences for readable display."""
            if not text:
                return text
            # Replace literal \r\n and \n with actual newlines
            text = text.replace('\\r\\n', '\n').replace('\\n', '\n').replace('\\r', '')
            # Remove actual \r characters
            text = text.replace('\r\n', '\n').replace('\r', '')
            return text

        def _extract_sdk_message_id(data: object) -> str | None:
            msg_id = getattr(data, "message_id", None) or getattr(data, "messageId", None)
            if isinstance(msg_id, str) and msg_id.strip():
                return msg_id
            if isinstance(data, dict):
                msg_id = data.get("messageId") or data.get("message_id")
                if isinstance(msg_id, str) and msg_id.strip():
                    return msg_id
            return None

        def _format_tool_input(data: object) -> str | None:
            """Format tool input/arguments for display."""
            args = getattr(data, "arguments", None) or getattr(data, "input", None)
            if not args:
                return None
            try:
                if isinstance(args, str):
                    return _clean_text(args[:500])
                elif isinstance(args, dict):
                    return json.dumps(args, indent=2)[:500]
                else:
                    return _clean_text(str(args)[:500])
            except Exception:
                return _clean_text(str(args)[:500]) if args else None
            if not text:
                return text
            # Replace literal \r\n and \n with actual newlines
            text = text.replace('\\r\\n', '\n').replace('\\n', '\n').replace('\\r', '')
            # Remove actual \r characters
            text = text.replace('\r\n', '\n').replace('\r', '')
            return text

        def _format_tool_output(data: object) -> str | None:
            """Format tool result for display."""
            # Check for error first
            error = getattr(data, "error", None)
            if error:
                error_str = str(error)[:1000]
                return _clean_text(f"Error: {error_str}")
            result = getattr(data, "result", None) or getattr(data, "output", None)
            if not result:
                return None
            try:
                result_str = str(result)[:1000]
                # Try to extract content from Result(...) wrapper
                if result_str.startswith("Result(content="):
                    # Extract the inner content string
                    import ast
                    try:
                        # Parse the content= part
                        inner = result_str[len("Result(content="):-1]
                        parsed = ast.literal_eval(inner)
                        if isinstance(parsed, str):
                            result_str = parsed[:1000]
                    except Exception:
                        pass
                return _clean_text(result_str)
            except Exception:
                return None

        try:
            sdk_events = await copilot_service.get_session_messages(session_id)
            logger.info(f"Got {len(sdk_events)} events from SDK for session {session_id}")

            for evt in sdk_events:
                evt_type = evt.type.value if hasattr(evt.type, 'value') else str(evt.type)
                data = evt.data

                if evt_type == "user.message":
                    # Flush any pending steps (shouldn't happen, but safety)
                    pending_steps.clear()
                    
                    content = getattr(data, "content", None)
                    if not isinstance(content, str) or not content.strip():
                        if isinstance(data, dict):
                            content = data.get("content")

                    # Extract attachments from SDK event
                    sdk_attachments = getattr(data, "attachments", None)
                    msg_attachments = None
                    if sdk_attachments:
                        msg_attachments = []
                        for att in sdk_attachments:
                            att_type = getattr(att, "type", None)
                            if hasattr(att_type, "value"):
                                att_type = att_type.value
                            msg_attachments.append(MessageAttachment(
                                type=str(att_type or "file"),
                                path=getattr(att, "path", None) or getattr(att, "file_path", None),
                                displayName=getattr(att, "display_name", None),
                            ))

                    if isinstance(content, str) and (content.strip() or msg_attachments):
                        sdk_message_id = _extract_sdk_message_id(data)
                        messages.append(Message(
                            id=sdk_message_id or str(uuid.uuid4()),
                            sdk_message_id=sdk_message_id,
                            role="user",
                            content=content or "",
                            timestamp=datetime.now(timezone.utc),
                            attachments=msg_attachments,
                        ))

                elif evt_type == "assistant.intent":
                    intent = getattr(data, "intent", None)
                    if isinstance(intent, str) and intent.strip():
                        pending_steps.append({"title": "Intent", "detail": intent})

                elif evt_type == "assistant.reasoning":
                    content = getattr(data, "content", None)
                    if isinstance(content, str) and content.strip():
                        pending_steps.append({"title": "Reasoning", "detail": content})

                elif evt_type == "tool.execution_start":
                    tool = getattr(data, "tool_name", None) or getattr(data, "name", None)
                    tool_call_id = getattr(data, "tool_call_id", None)
                    title = f"Tool: {tool}" if tool else "Tool"
                    detail_parts = []
                    if tool_call_id:
                        detail_parts.append(f"id={tool_call_id}")
                    tool_input = _format_tool_input(data)
                    if tool_input:
                        detail_parts.append(f"Input: {tool_input}")
                    detail = "\n".join(detail_parts) if detail_parts else None
                    pending_steps.append({"title": title, "detail": detail})

                elif evt_type == "tool.execution_progress":
                    msg = getattr(data, "progress_message", None)
                    if isinstance(msg, str) and msg.strip():
                        pending_steps.append({"title": "Tool progress", "detail": msg})

                elif evt_type == "tool.execution_partial_result":
                    # Skip partial results - they are cumulative and would repeat content
                    # The final tool.execution_complete will have the full output
                    pass

                elif evt_type == "tool.execution_complete":
                    tool = getattr(data, "tool_name", None) or getattr(data, "name", None)
                    tool_call_id = getattr(data, "tool_call_id", None)
                    title = f"Tool done: {tool}" if tool else "Tool done"
                    # Check for error/failure
                    tool_error = getattr(data, "error", None)
                    result_type = getattr(data, "resultType", None) or getattr(data, "result_type", None)
                    if tool_error or result_type == "failure":
                        title = f"Tool failed: {tool}" if tool else "Tool failed"
                    detail_parts = []
                    if tool_call_id:
                        detail_parts.append(f"id={tool_call_id}")
                    tool_output = _format_tool_output(data)
                    if tool_output:
                        detail_parts.append(f"Output: {tool_output}")
                    detail = "\n".join(detail_parts) if detail_parts else None
                    pending_steps.append({"title": title, "detail": detail})

                elif evt_type == "assistant.message":
                    content = _format_assistant_content(data)
                    if content and content.strip():
                        # Attach pending steps to this message
                        steps = [MessageStep(title=s["title"], detail=s.get("detail")) for s in pending_steps] if pending_steps else None
                        sdk_message_id = _extract_sdk_message_id(data)
                        messages.append(Message(
                            id=sdk_message_id or str(uuid.uuid4()),
                            sdk_message_id=sdk_message_id,
                            role="assistant",
                            content=content,
                            timestamp=datetime.now(timezone.utc),
                            steps=steps,
                        ))
                        pending_steps.clear()

        except Exception as e:
            logger.error(f"Failed to get messages for session {session_id}: {e}")
            messages = []
        
        # SDK doesn't expose reasoningText, so read from raw events.jsonl
        # and merge reasoningText into assistant messages
        try:
            raw_events = await read_raw_events(session_id)
            reasoning_by_message_id: dict[str, str] = {}
            
            for raw_evt in raw_events:
                if raw_evt.get("type") == "assistant.message":
                    data = raw_evt.get("data", {})
                    msg_id = data.get("messageId")
                    reasoning = data.get("reasoningText")
                    if msg_id and reasoning:
                        reasoning_by_message_id[msg_id] = reasoning
            
            # Fallback content mapping (legacy) for cases where SDK IDs aren't available.
            content_to_reasoning: dict[str, str] = {}
            for raw_evt in raw_events:
                if raw_evt.get("type") == "assistant.message":
                    data = raw_evt.get("data", {})
                    content = data.get("content", "")
                    reasoning = data.get("reasoningText")
                    if content and reasoning:
                        content_to_reasoning[content.strip()] = reasoning

            # Add reasoning as a step to matching messages (prefer SDK messageId).
            for msg in messages:
                if msg.role == "assistant":
                    anchor_id = msg.sdk_message_id or msg.id
                    reasoning = reasoning_by_message_id.get(anchor_id)
                    if not reasoning and msg.content:
                        reasoning = content_to_reasoning.get(msg.content.strip())
                    if reasoning:
                        reasoning_step = MessageStep(title="Reasoning", detail=reasoning)
                        if msg.steps:
                            # Add reasoning at the beginning
                            msg.steps = [reasoning_step] + list(msg.steps)
                        else:
                            msg.steps = [reasoning_step]
                        logger.debug(f"Added reasoning step to message_id={anchor_id}")
        
        except Exception as e:
            logger.warning(f"Failed to read raw events for reasoningText: {e}")
        
        logger.info(f"Returning {len(messages)} messages for session {session_id}")

        return SessionWithMessages(
            session_id=session.session_id,
            session_name=session.session_name,
            model=session.model,
            cwd=session.cwd,
            mcp_servers=session.mcp_servers,
            tools=session.tools,
            system_message=session.system_message,
            created_at=session.created_at,
            updated_at=session.updated_at,
            messages=messages,
        )

    async def delete_session(self, session_id: str) -> bool:
        """Delete a session from SDK and our storage."""
        # Delete the SDK session (handles both active and inactive cases)
        await copilot_service.delete_session(session_id)

        # Delete from our storage (may not exist for CLI sessions, that's ok)
        storage_service.delete_session(session_id)
        return True

    async def connect_session(self, session_id: str) -> bool:
        """Mark session as connected (tab opened).
        
        Note: We no longer resume the SDK session here. The session will be
        resumed lazily when the user sends their first message.
        """
        session = await self.get_session(session_id)
        return session is not None

    async def disconnect_session(self, session_id: str) -> None:
        """Disconnect a session when a tab closes."""
        await copilot_service.destroy_session_client(session_id)

    async def update_session(self, session_id: str, request: SessionUpdate) -> Session | None:
        """Update session metadata (name, cwd, mcp_servers).
        
        If CWD changes and session is active, the client will be recreated
        on next message with the new CWD.
        
        If MCP servers change and session is active, the client will be recreated
        on next message with the new MCP servers.
        
        Note: Timestamps not saved - they come from SDK.
        """
        session = await self.get_session(session_id)
        if not session:
            return None
        
        need_recreate = False
        
        # Update fields
        if request.name is not None:
            session.session_name = request.name
            session.name_set = True  # User explicitly set the name
        if request.cwd is not None:
            old_cwd = session.cwd
            session.cwd = request.cwd
            
            if old_cwd != request.cwd and copilot_service.is_session_active(session_id):
                need_recreate = True
        
        if request.mcp_servers is not None:
            old_mcp = session.mcp_servers
            session.mcp_servers = request.mcp_servers
            
            if old_mcp != request.mcp_servers and copilot_service.is_session_active(session_id):
                need_recreate = True
        
        if request.tools is not None:
            old_tools = session.tools
            session.tools = request.tools
            
            if old_tools != request.tools and copilot_service.is_session_active(session_id):
                need_recreate = True
        
        if request.system_message is not None:
            old_sm = session.system_message
            session.system_message = request.system_message
            
            if old_sm != request.system_message and copilot_service.is_session_active(session_id):
                need_recreate = True
        
        if request.sub_agents is not None:
            old_sub = session.sub_agents
            session.sub_agents = request.sub_agents
            
            if old_sub != request.sub_agents and copilot_service.is_session_active(session_id):
                need_recreate = True
        
        # Destroy client so next message resumes with new config
        if need_recreate:
            await copilot_service.destroy_session_client(session_id)
        
        # Save updated metadata (without timestamps)
        storage_service.save_session(session)
        
        return session

    def add_user_message(self, session_id: str, content: str) -> Message:
        """Add a user message - SDK handles this, we just return for response."""
        return Message(
            id=str(uuid.uuid4()),
            role="user",
            content=content,
            timestamp=datetime.now(timezone.utc),
        )

    def add_assistant_message(self, session_id: str, content: str) -> Message:
        """Add an assistant message - SDK handles this, we just return for response."""
        return Message(
            id=str(uuid.uuid4()),
            role="assistant",
            content=content,
            timestamp=datetime.now(timezone.utc),
        )


# Singleton instance
session_service = SessionService()
