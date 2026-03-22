"""CLI hooks router — bridge between Copilot CLI hooks and Console notification pipeline."""

from fastapi import APIRouter
from pydantic import BaseModel

from copilot_console.app.services.logging_service import get_logger
from copilot_console.app.services.notification_manager import notification_manager
from copilot_console.app.services.session_service import session_service
from copilot_console.app.services.storage_service import storage_service

logger = get_logger(__name__)

router = APIRouter(prefix="/cli-hooks", tags=["cli-hooks"])


class AgentStopRequest(BaseModel):
    session_id: str


@router.post("/agent-stop")
async def agent_stop(request: AgentStopRequest) -> dict:
    """Called by the agentStop CLI hook to trigger mobile push notifications.

    Reuses the existing notification pipeline:
    notification_manager.on_agent_completed() → 30s delay → check viewed → push.
    """
    settings = storage_service.get_settings()
    if not settings.get("cli_notifications", False):
        return {"ok": True, "skipped": "cli_notifications disabled"}

    session_id = request.session_id

    # Look up session for name and preview
    session_name = session_id[:8]
    preview = ""
    try:
        session = await session_service.get_session(session_id)
        if session:
            session_name = session.session_name or session_id[:8]
    except Exception as e:
        logger.debug(f"Could not look up CLI session {session_id}: {e}")

    # Get last assistant message as preview
    try:
        result = await session_service.get_session_with_messages(session_id)
        if result:
            for msg in reversed(result.messages):
                if msg.role == "assistant" and msg.content:
                    preview = msg.content[:100]
                    break
    except Exception as e:
        logger.debug(f"Could not get preview for CLI session {session_id}: {e}")

    logger.info(f"CLI agent-stop: session={session_id[:8]}, name={session_name}")
    notification_manager.on_agent_completed(session_id, session_name, preview)

    return {"ok": True, "session_id": session_id}
