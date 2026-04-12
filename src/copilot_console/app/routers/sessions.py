"""Sessions router - CRUD and chat operations."""

import asyncio
import json
import os
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Form, HTTPException, UploadFile, File
from sse_starlette.sse import EventSourceResponse

from copilot_console.app.config import SESSIONS_DIR
from copilot_console.app.models.message import MessageCreate
from copilot_console.app.models.session import Session, SessionCreate, SessionUpdate, SessionWithMessages, ModeSetRequest, RuntimeSettingsRequest
from copilot_console.app.services.copilot_service import copilot_service
from copilot_console.app.services.agent_storage_service import agent_storage_service
from copilot_console.app.services.agent_discovery_service import resolve_selected_agents, validate_selected_agents
from copilot_console.app.services.mcp_service import mcp_service
from copilot_console.app.services.response_buffer import response_buffer_manager, ResponseStatus
from copilot_console.app.services.session_service import session_service
from copilot_console.app.services.storage_service import storage_service
from copilot_console.app.services.tools_service import get_tools_service
from copilot_console.app.services.viewed_service import viewed_service
from copilot_console.app.services.completion_times_service import completion_times_service
from copilot_console.app.services.logging_service import get_logger, set_session_context

logger = get_logger(__name__)

# Get tools service singleton
tools_service = get_tools_service()


def _resolve_sub_agents(sub_agents: list[str], cwd: str, agent_id: str | None = None) -> list[dict]:
    """Resolve prefixed sub-agent IDs to SDK CustomAgentConfig dicts."""
    console_agents = agent_storage_service.get_eligible_sub_agents(exclude_agent_id=agent_id)
    return resolve_selected_agents(sub_agents, cwd, mcp_service=mcp_service, console_agents=console_agents)


def _resolve_session_config(session: Session) -> dict:
    """Extract common MCP/tools/system-message/sub-agents config from a session.

    Returns a dict with keys: cwd, mcp_servers, tools, available_tools,
    excluded_tools, system_message, custom_agents.
    """
    cwd = session.cwd or os.path.expanduser("~")
    mcp_configs = mcp_service.get_servers_for_sdk(session.mcp_servers)
    custom_tools = tools_service.get_sdk_tools(session.tools.custom) if session.tools.custom else []
    available_tools = session.tools.builtin if session.tools.builtin else None
    excluded_tools = session.tools.excluded_builtin if session.tools.excluded_builtin else None

    system_message = None
    if session.system_message and session.system_message.get("content"):
        system_message = {
            "mode": session.system_message.get("mode", "replace"),
            "content": session.system_message["content"],
        }

    custom_agents = None
    if session.sub_agents:
        custom_agents = _resolve_sub_agents(session.sub_agents, cwd, session.agent_id)

    return {
        "cwd": cwd,
        "mcp_servers": mcp_configs,
        "tools": custom_tools if custom_tools else None,
        "available_tools": available_tools,
        "excluded_tools": excluded_tools,
        "system_message": system_message,
        "custom_agents": custom_agents,
    }


router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("/active-agents")
async def get_active_agents() -> dict:
    """Get information about all sessions with active agents.
    
    Returns count and details of sessions where agents are currently
    generating responses (streaming in progress).
    """
    active_sessions = response_buffer_manager.get_all_active()
    return {
        "count": len(active_sessions),
        "sessions": active_sessions,
    }


@router.get("/active-agents/stream")
async def stream_active_agents() -> EventSourceResponse:
    """Stream live updates of all active agent sessions.
    
    SSE endpoint that sends updates every second with:
    - List of all active sessions
    - Content tail (last 500 chars) for each
    - Current step being executed
    - Elapsed time
    
    Events:
    - 'update': Regular update with all active sessions
    - 'done': Sent when a session completes (removed from active list)
    """
    async def generate_events() -> AsyncGenerator[dict, None]:
        previous_session_ids: set[str] = set()
        
        try:
            while True:
                active_sessions = response_buffer_manager.get_all_active(
                    include_content=True, 
                    content_tail_chars=500
                )
                current_session_ids = {s["session_id"] for s in active_sessions}
                
                # Check for completed sessions
                completed = previous_session_ids - current_session_ids
                for session_id in completed:
                    ct = completion_times_service.get(session_id)
                    event_data: dict = {"session_id": session_id}
                    if ct is not None:
                        event_data["updated_at"] = ct
                    yield {
                        "event": "completed",
                        "data": json.dumps(event_data)
                    }
                
                # Send update with all active sessions
                yield {
                    "event": "update",
                    "data": json.dumps({
                        "count": len(active_sessions),
                        "sessions": active_sessions,
                    })
                }
                
                previous_session_ids = current_session_ids
                await asyncio.sleep(1)  # Update every second
                
        except asyncio.CancelledError:
            logger.info("[SSE] Active agents stream client disconnected")
            raise
    
    return EventSourceResponse(generate_events())


@router.post("", response_model=Session)
async def create_session(request: SessionCreate) -> Session:
    """Create a new chat session."""
    return await session_service.create_session(request)


@router.get("")
async def list_sessions() -> dict:
    """List all sessions ordered by last activity."""
    sessions = await session_service.list_sessions()
    return {"sessions": [s.model_dump(mode="json") for s in sessions]}


@router.get("/{session_id}", response_model=SessionWithMessages)
async def get_session(session_id: str) -> SessionWithMessages:
    """Get a session with its message history."""
    session = await session_service.get_session_with_messages(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/{session_id}")
async def delete_session(session_id: str) -> dict:
    """Delete a session permanently."""
    deleted = await session_service.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    # Clean up viewed timestamp and completion timestamp
    viewed_service.remove(session_id)
    completion_times_service.remove(session_id)
    return {"success": True}


@router.patch("/{session_id}", response_model=Session)
async def update_session(session_id: str, request: SessionUpdate) -> Session:
    """Update session metadata (name, cwd)."""
    # Validate CWD if provided
    if request.cwd is not None:
        import os
        if not os.path.isdir(request.cwd):
            raise HTTPException(
                status_code=400,
                detail=f"Directory does not exist: {request.cwd}"
            )
    
    session = await session_service.update_session(session_id, request)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/{session_id}/connect")
async def connect_session(session_id: str) -> dict:
    """Connect to a session (called when tab opens).

    This resumes the SDK session for real-time chat.
    """
    success = await session_service.connect_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}


@router.post("/{session_id}/disconnect")
async def disconnect_session(session_id: str) -> dict:
    """Disconnect from a session (called when tab closes).

    This destroys the SDK session but keeps history for later.
    
    IMPORTANT: If there's an active response being generated (agent still running),
    we DON'T destroy the session - let the agent finish its work.
    """
    # Check if there's an active response - if so, don't kill the session!
    has_active = response_buffer_manager.has_active_response(session_id)
    logger.info(f"[Disconnect] Session {session_id}: has_active_response={has_active}")
    
    if has_active:
        logger.info(f"[Disconnect] Session {session_id} has active response, NOT destroying client")
        return {"success": True, "deferred": True}
    
    await session_service.disconnect_session(session_id)
    return {"success": True}


@router.post("/{session_id}/mode")
async def set_session_mode(session_id: str, request: ModeSetRequest) -> dict:
    """Set the agent mode (interactive/plan/autopilot) for a session.
    
    Deprecated: Use PATCH /{session_id}/runtime-settings instead.
    Activates the session if it is not already active.
    """
    valid_modes = {"interactive", "plan", "autopilot"}
    if request.mode not in valid_modes:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {request.mode}. Must be one of {valid_modes}")
    
    # Load session config for activation (CWD, MCP, tools, etc.)
    session = session_service.get_session_local(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    cfg = _resolve_session_config(session)
    
    try:
        confirmed_mode = await copilot_service.set_session_mode(
            session_id, request.mode, cfg["cwd"],
            mcp_servers=cfg["mcp_servers"],
            tools=cfg["tools"],
            available_tools=cfg["available_tools"],
            excluded_tools=cfg["excluded_tools"],
            system_message=cfg["system_message"],
            custom_agents=cfg["custom_agents"],
        )
        return {"mode": confirmed_mode}
    except Exception as e:
        logger.error(f"[{session_id}] Failed to set mode: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to set mode: {e}")


@router.patch("/{session_id}/runtime-settings")
async def update_runtime_settings(session_id: str, request: RuntimeSettingsRequest) -> dict:
    """Update runtime settings (mode, model) for a session.
    
    Runtime settings are RPC-based and can be changed anytime, independent of
    agent response status. Only provided fields are applied.
    Activates the session if it is not already active.
    """
    if request.mode is None and request.model is None:
        raise HTTPException(status_code=400, detail="At least one setting (mode, model) must be provided")
    
    valid_modes = {"interactive", "plan", "autopilot"}
    if request.mode is not None and request.mode not in valid_modes:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {request.mode}. Must be one of {valid_modes}")
    
    session = session_service.get_session_local(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    cfg = _resolve_session_config(session)
    
    try:
        result = await copilot_service.update_runtime_settings(
            session_id, cfg["cwd"],
            mode=request.mode,
            model=request.model,
            reasoning_effort=request.reasoning_effort,
            mcp_servers=cfg["mcp_servers"],
            tools=cfg["tools"],
            available_tools=cfg["available_tools"],
            excluded_tools=cfg["excluded_tools"],
            system_message=cfg["system_message"],
            custom_agents=cfg["custom_agents"],
        )
        
        # Persist model/reasoning_effort changes to session.json
        if request.model is not None:
            update_fields = SessionUpdate(
                model=result.get("model", request.model),
                reasoning_effort=request.reasoning_effort,
            )
            await session_service.update_session(session_id, update_fields)
        
        return result
    except Exception as e:
        logger.error(f"[{session_id}] Failed to update runtime settings: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update runtime settings: {e}")


@router.post("/{session_id}/compact")
async def compact_session(session_id: str) -> dict:
    """Compact session context to free tokens.
    
    Removes old messages and frees token budget. Activates the session if
    not already active.
    """
    set_session_context(session_id)
    session = session_service.get_session_local(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    cfg = _resolve_session_config(session)

    try:
        result = await copilot_service.compact_session(
            session_id, cfg["cwd"],
            mcp_servers=cfg["mcp_servers"],
            tools=cfg["tools"],
            available_tools=cfg["available_tools"],
            excluded_tools=cfg["excluded_tools"],
            system_message=cfg["system_message"],
            custom_agents=cfg["custom_agents"],
        )
        return result
    except Exception as e:
        logger.error(f"[{session_id}] Failed to compact session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to compact session: {e}")


@router.post("/{session_id}/enqueue")
async def enqueue_message(session_id: str, request: MessageCreate) -> dict:
    """Enqueue a follow-up message while the agent is already running.

    Unlike /messages, this does NOT create a new background task or SSE stream.
    It sends the message with mode='enqueue' to the existing SDK session.
    The running agent will process it after the current response completes.
    """
    set_session_context(session_id)
    logger.info(f"Enqueue request: {request.content[:100]}")

    # Verify session is active (enqueue requires an active SDK session — zero I/O)
    if not copilot_service.is_session_active(session_id):
        raise HTTPException(status_code=404, detail="Session not found")

    # Must have an active response for enqueue to make sense
    if not response_buffer_manager.has_active_response(session_id):
        raise HTTPException(status_code=409, detail="No active agent to enqueue to")

    # Add user message to history
    session_service.add_user_message(session_id, request.content)

    try:
        result = await copilot_service.enqueue_message(
            session_id,
            request.content,
            attachments=[{"type": a.type, "path": a.path, **({"displayName": a.displayName} if a.displayName else {})} for a in request.attachments] if request.attachments else None,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        error_msg = str(e)
        if "Session not found" in error_msg:
            logger.warning(f"[Enqueue] SDK session gone for {session_id}, cleaning up buffer")
            await response_buffer_manager.remove_buffer(session_id)
            raise HTTPException(status_code=410, detail="Session expired, please send a new message")
        raise HTTPException(status_code=500, detail=error_msg)


@router.post("/{session_id}/abort")
async def abort_session(session_id: str) -> dict:
    """Abort the currently processing message in a session.

    The session remains valid and can continue to receive new messages.
    """
    set_session_context(session_id)
    logger.info(f"Abort request for session {session_id}")

    try:
        result = await copilot_service.abort_session(session_id)
        return result
    except ValueError as e:
        # No active SDK session — clean up the buffer if it's stuck
        logger.warning(f"[Abort] No SDK session for {session_id}, cleaning up buffer")
        await response_buffer_manager.remove_buffer(session_id)
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        error_msg = str(e)
        if "Session not found" in error_msg:
            logger.warning(f"[Abort] SDK session gone for {session_id}, cleaning up buffer")
            await response_buffer_manager.remove_buffer(session_id)
            return {"status": "aborted", "detail": "Session expired, buffer cleaned up"}
        raise HTTPException(status_code=500, detail=error_msg)


@router.post("/{session_id}/elicitation-response")
async def elicitation_response(session_id: str, request: dict) -> dict:
    """Respond to a pending elicitation request.
    
    Body: { request_id: str, action: "accept"|"decline"|"cancel", content?: {...} }
    """
    set_session_context(session_id)
    request_id = request.get("request_id")
    action = request.get("action", "cancel")
    content = request.get("content", {})

    if not request_id:
        raise HTTPException(status_code=400, detail="request_id is required")
    if action not in ("accept", "decline", "cancel"):
        raise HTTPException(status_code=400, detail="action must be accept, decline, or cancel")

    result = {"action": action}
    if action == "accept" and content:
        result["content"] = content

    resolved = copilot_service.resolve_elicitation(session_id, request_id, result)
    if not resolved:
        raise HTTPException(status_code=404, detail="Elicitation request not found or already resolved")

    logger.debug(f"[{session_id}] Elicitation {request_id} resolved with action={action}")
    return {"status": "resolved", "action": action}


@router.post("/{session_id}/user-input-response")
async def user_input_response(session_id: str, request: dict) -> dict:
    """Respond to a pending ask_user request.
    
    Body: { request_id: str, answer: str, wasFreeform: bool }
    Or to cancel: { request_id: str, cancelled: true }
    """
    set_session_context(session_id)
    request_id = request.get("request_id")

    if not request_id:
        raise HTTPException(status_code=400, detail="request_id is required")

    if request.get("cancelled"):
        if not copilot_service.cancel_elicitation(session_id, request_id):
            raise HTTPException(status_code=404, detail="User input request not found or already resolved")
        logger.debug(f"[{session_id}] User input {request_id} cancelled by user")
        return {"status": "cancelled"}

    answer = request.get("answer", "")
    was_freeform = request.get("wasFreeform", True)
    result = {"answer": answer, "wasFreeform": was_freeform}

    resolved = copilot_service.resolve_elicitation(session_id, request_id, result)
    if not resolved:
        raise HTTPException(status_code=404, detail="User input request not found or already resolved")

    logger.debug(f"[{session_id}] User input {request_id} resolved: answer={answer[:50]}")
    return {"status": "resolved"}


@router.post("/{session_id}/test-elicitation")
async def test_elicitation(session_id: str) -> dict:
    """DEV ONLY: Simulate an elicitation event for UI testing.
    
    Pushes a fake elicitation event through both the event queue (if streaming)
    and the ResponseBuffer (for reconnect), so it works regardless of stream state.

    Requires COPILOT_DEBUG=1 environment variable.
    """
    if os.environ.get("COPILOT_DEBUG", "").strip() != "1":
        raise HTTPException(status_code=404, detail="Not found")

    import uuid as _uuid
    client = copilot_service._session_clients.get(session_id)
    if not client:
        raise HTTPException(status_code=404, detail="No active session client")

    request_id = str(_uuid.uuid4())
    elicitation_data = {
        "request_id": request_id,
        "message": "Please configure your project settings:",
        "schema": {
            "type": "object",
            "properties": {
                "database": {
                    "type": "string",
                    "title": "Database",
                    "enum": ["PostgreSQL", "MySQL", "SQLite"],
                    "description": "Which database engine to use"
                },
                "projectName": {
                    "type": "string",
                    "title": "Project Name",
                    "description": "Name of your project"
                },
                "port": {
                    "type": "integer",
                    "title": "Port",
                    "default": 5432,
                    "minimum": 1024,
                    "maximum": 65535
                },
                "enableCaching": {
                    "type": "boolean",
                    "title": "Enable Caching",
                    "default": True
                },
                "features": {
                    "type": "array",
                    "title": "Features",
                    "items": {
                        "enum": ["auth", "logging", "metrics", "rate-limiting"]
                    }
                }
            },
            "required": ["database", "projectName"]
        },
        "source": "test-endpoint",
    }

    # Store a future so the response endpoint works
    loop = asyncio.get_event_loop()
    future = loop.create_future()
    copilot_service._pending_elicitations[(session_id, request_id)] = future

    evt = {"event": "elicitation", "data": elicitation_data}

    # Push to active event queue if streaming
    if client.event_queue:
        from copilot_console.app.services.copilot_service import _safe_enqueue
        _safe_enqueue(client.event_queue, evt)

    # Also push to ResponseBuffer so reconnect/SSE consumer picks it up
    buffer = await response_buffer_manager.get_buffer(session_id)
    if not buffer:
        # Create a buffer that stays open for the elicitation
        buffer = await response_buffer_manager.create_buffer(session_id)
    buffer.add_notification("elicitation", elicitation_data)

    logger.debug(f"[{session_id}] Test elicitation pushed: {request_id}")
    return {"status": "pushed", "request_id": request_id}


@router.post("/{session_id}/messages")
async def send_message(session_id: str, request: MessageCreate) -> EventSourceResponse:
    """Send a message and stream the assistant's response via SSE.
    
    Three paths based on session state:
    1. New session (is_new_session=True): read session.json for config, create SDK session
    2. Active session: send directly, zero I/O (SDK has everything cached)
    3. Inactive session: read session.json for config, re-activate SDK session
    
    The agent runs in a background task that continues even if the browser
    disconnects. The SSE stream reads from a buffer, so reconnecting will
    resume from where you left off.
    """
    # Set session context for logging
    set_session_context(session_id)
    
    logger.info(f"Received message request: {request.content[:100]}{'...' if len(request.content) > 100 else ''}, is_new_session={request.is_new_session}")
    
    # Determine which path to take
    session_active = copilot_service.is_session_active(session_id)
    
    if session_active and not request.is_new_session:
        # Path 2: Active session — SDK already has all config cached.
        # No need to read session.json or call list_sessions().
        logger.info(f"[SSE] Active session path for {session_id}")
        session = None  # Not needed — SDK handles everything
        # Preserve the existing client's CWD to avoid destroying/recreating it
        cwd = copilot_service.get_session_cwd(session_id)
        model = None
        reasoning_effort = None
        mcp_servers_sdk = None
        tools_sdk = None
        builtin_tools = None
        excluded_tools = None
        system_message = None
        custom_agents_sdk = None
    else:
        # Path 1 (new) or Path 3 (inactive): Read session.json for config
        session = session_service.get_session_local(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"[SSE] {'New' if request.is_new_session else 'Inactive'} session path for {session_id}")
        
        model = session.model
        reasoning_effort = session.reasoning_effort

        # Validate sub-agents before resolving config
        if session.sub_agents:
            console_agents = agent_storage_service.get_eligible_sub_agents(exclude_agent_id=session.agent_id)
            errors = validate_selected_agents(
                session.sub_agents, session.cwd or os.path.expanduser("~"),
                console_agents=console_agents,
                exclude_agent_id=session.agent_id,
            )
            if errors:
                raise HTTPException(
                    status_code=400,
                    detail=f"Sub-agent validation failed: {'; '.join(errors)}"
                )

        cfg = _resolve_session_config(session)
        cwd = cfg["cwd"]
        mcp_servers_sdk = cfg["mcp_servers"]
        tools_sdk = cfg["tools"]
        builtin_tools = cfg["available_tools"]
        excluded_tools = cfg["excluded_tools"]
        system_message = cfg["system_message"]
        custom_agents_sdk = cfg["custom_agents"]

        logger.info(f"[SSE] Loading {len(mcp_servers_sdk)} MCP servers for session {session_id}")
        if tools_sdk:
            logger.info(f"[SSE] Loading {len(tools_sdk)} custom tools for session {session_id}")
        if custom_agents_sdk:
            logger.info(f"[SSE] Resolved {len(custom_agents_sdk)} sub-agents for session {session_id}")

    # Add user message to history
    session_service.add_user_message(session_id, request.content)
    
    # Create response buffer
    buffer = await response_buffer_manager.create_buffer(session_id)
    
    # Create the background coroutine
    async def run_agent():
        """Wrapper to ensure exceptions are logged and don't propagate."""
        try:
            logger.info(f"[Background] Starting agent for session {session_id}")
            await copilot_service.send_message_background(
                session_id=session_id,
                model=model or "",
                cwd=cwd or os.path.expanduser("~"),
                prompt=request.content,
                buffer=buffer,
                mcp_servers=mcp_servers_sdk,
                tools=tools_sdk,
                available_tools=builtin_tools,
                excluded_tools=excluded_tools,
                system_message=system_message,
                is_new_session=request.is_new_session,
                mode=request.mode,
                attachments=[{"type": a.type, "path": a.path, **({"displayName": a.displayName} if a.displayName else {})} for a in request.attachments] if request.attachments else None,
                custom_agents=custom_agents_sdk,
                reasoning_effort=reasoning_effort,
                agent_mode=request.agent_mode,
                fleet=request.fleet,
            )
            logger.info(f"[Background] Agent completed for session {session_id}")
            
            # Auto-name: try title_changed event first, fall back to list_sessions()
            stored_meta = None
            try:
                if session_service.consume_auto_name(session_id):
                    new_name = buffer.updated_session_name  # set by title_changed event
                    if not new_name:
                        # Fallback: SDK doesn't always fire title_changed,
                        # so query list_sessions() for the summary
                        sdk_sessions = await copilot_service.list_sessions()
                        for sdk_s in sdk_sessions:
                            sid = getattr(sdk_s, "sessionId", None) or getattr(sdk_s, "session_id", None)
                            if sid == session_id:
                                summary = getattr(sdk_s, "summary", None)
                                if summary and isinstance(summary, str) and summary.strip():
                                    new_name = summary.strip()
                                break
                    if new_name:
                        stored_meta = storage_service.load_session(session_id)
                        if stored_meta:
                            stored_meta["session_name"] = new_name
                            storage_service.save_session_raw(session_id, stored_meta)
                        buffer.updated_session_name = new_name
                        logger.info(f"[Background] Auto-named session {session_id}: {new_name}")
            except Exception as e:
                logger.warning(f"[Background] Failed to auto-name session {session_id}: {e}")
            
            # NOW mark the buffer complete - SSE done event will include the name
            buffer.complete()
            
            # Record server-side completion timestamp (fixes blue dot)
            completion_times_service.mark_completed(session_id)
            
            # Trigger delayed push notification check
            from copilot_console.app.services.notification_manager import notification_manager
            preview = buffer.get_full_content()[:120] if buffer.chunks else ""
            if not stored_meta:
                stored_meta = storage_service.load_session(session_id)
            session_name = (buffer.updated_session_name 
                          or (stored_meta.get("session_name") if stored_meta else None) 
                          or session_id[:8])
            notification_manager.on_agent_completed(session_id, session_name, preview)
        except asyncio.CancelledError:
            logger.warning(f"[Background] Agent task cancelled for session {session_id}")
            buffer.fail("Task was cancelled")
        except Exception as e:
            logger.error(f"[Background] Agent error for session {session_id}: {e}", exc_info=True)
            buffer.fail(str(e))
    
    # Start as a fire-and-forget task using the event loop directly
    loop = asyncio.get_running_loop()
    task = loop.create_task(run_agent())
    # Add a done callback to log completion
    task.add_done_callback(
        lambda t: logger.info(f"[Background] Task done for {session_id}: cancelled={t.cancelled()}, exception={t.exception() if not t.cancelled() else None}")
    )
    response_buffer_manager.register_task(session_id, task)
    logger.info(f"[SSE] Started background task for session {session_id}")

    async def generate_events() -> AsyncGenerator[dict, None]:
        """Stream events from the buffer to SSE client."""
        events_sent = 0

        try:
            while True:
                # Send all new events in order (chunks, steps, notifications interleaved)
                while events_sent < len(buffer.ordered_events):
                    evt = buffer.ordered_events[events_sent]
                    yield {
                        "event": evt["event"],
                        "data": json.dumps(evt["data"])
                    }
                    events_sent += 1
                
                # Check if done
                if buffer.status == ResponseStatus.COMPLETED:
                    content = buffer.get_full_content()
                    if content.strip():
                        done_data: dict = {"content_length": len(content)}
                        # Include auto-generated session name if available
                        if buffer.updated_session_name:
                            done_data["session_name"] = buffer.updated_session_name
                        ct = completion_times_service.get(session_id)
                        if ct is not None:
                            done_data["updated_at"] = ct
                        yield {"event": "done", "data": json.dumps(done_data)}
                    else:
                        yield {"event": "error", "data": json.dumps({"error": "No response content"})}
                    break
                elif buffer.status == ResponseStatus.ERROR:
                    yield {"event": "error", "data": json.dumps({"error": buffer.error})}
                    break
                
                # Wait for new data (no polling - uses async event!)
                await buffer.wait_for_update(timeout=30.0)
                    
        except asyncio.CancelledError:
            # Client disconnected - that's OK, background task should continue!
            logger.info(f"[SSE] Client disconnected for session {session_id}")
            # DON'T re-raise - let the request end cleanly without affecting background task

    return EventSourceResponse(generate_events())


@router.get("/{session_id}/response-status")
async def get_response_status(session_id: str) -> dict:
    """Check if there's an active response being generated.
    
    Frontend can call this on reconnect to check if it should resume streaming.
    Also includes any pending ask_user/elicitation data so the client can
    restore the card without SSE replay.
    """
    status = response_buffer_manager.get_status(session_id)
    
    # Check for pending ask_user/elicitation Futures
    pending_keys = [k for k in copilot_service._pending_elicitations if k[0] == session_id]
    if pending_keys:
        # Find the matching event data from the buffer
        buffer = response_buffer_manager._buffers.get(session_id)
        if buffer:
            for evt in reversed(buffer.ordered_events):
                if evt["event"] in ("ask_user", "elicitation"):
                    status["pending_input"] = evt
                    break
    
    return status


@router.get("/{session_id}/response-stream")
async def resume_response_stream(
    session_id: str, 
    from_chunk: int = 0, 
    from_step: int = 0
) -> EventSourceResponse:
    """Resume streaming an in-progress response.
    
    Used when frontend reconnects and wants to continue receiving updates.
    Pass from_chunk and from_step to skip already-received data.
    """
    buffer = await response_buffer_manager.get_buffer(session_id)
    
    if not buffer:
        raise HTTPException(status_code=404, detail="No active response for this session")
    
    async def generate_events() -> AsyncGenerator[dict, None]:
        # For resume, skip events that were already sent.
        # from_chunk/from_step are approximate — use ordered_events count.
        events_sent = from_chunk + from_step
        
        try:
            while True:
                # Send all new events in order
                while events_sent < len(buffer.ordered_events):
                    evt = buffer.ordered_events[events_sent]
                    events_sent += 1
                    # Skip ask_user/elicitation events in replay
                    if evt["event"] in ("ask_user", "elicitation"):
                        continue
                    yield {
                        "event": evt["event"],
                        "data": json.dumps(evt["data"])
                    }
                
                # Check if done
                if buffer.status == ResponseStatus.COMPLETED:
                    content = buffer.get_full_content()
                    if content.strip():
                        yield {"event": "done", "data": json.dumps({"content_length": len(content)})}
                    else:
                        yield {"event": "error", "data": json.dumps({"error": "No response content"})}
                    break
                elif buffer.status == ResponseStatus.ERROR:
                    yield {"event": "error", "data": json.dumps({"error": buffer.error})}
                    break
                
                # Wait for new data
                await buffer.wait_for_update(timeout=30.0)
                    
        except asyncio.CancelledError:
            logger.info(f"[SSE] Resume stream client disconnected for session {session_id}")
            raise
    
    return EventSourceResponse(generate_events())


# Upload destination: per-session files directory under app home
# Files are stored at ~/.copilot-console/sessions/{session_id}/files/


@router.post("/upload")
async def upload_file(file: UploadFile = File(...), session_id: str = Form(...)):
    """Upload a file for attachment. Stores in the session's files directory."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Store in session-specific files directory
    upload_dir = SESSIONS_DIR / session_id / "files"
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Create unique filename to avoid collisions
    ext = os.path.splitext(file.filename)[1]
    unique_name = f"{uuid.uuid4().hex[:12]}{ext}"
    file_path = upload_dir / unique_name

    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    logger.info(f"[Upload] Saved {file.filename} ({len(content)} bytes) to {file_path}")
    return {
        "path": str(file_path),
        "originalName": file.filename,
        "size": len(content),
    }
