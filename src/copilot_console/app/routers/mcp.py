"""MCP servers router - list available MCP servers and manage session selections."""

from fastapi import APIRouter, HTTPException

from copilot_console.app.models.mcp import MCPServer, MCPServerConfig
from copilot_console.app.services.copilot_service import copilot_service
from copilot_console.app.services.mcp_service import mcp_service
from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/mcp", tags=["mcp"])


@router.get("/servers", response_model=MCPServerConfig)
async def list_mcp_servers() -> MCPServerConfig:
    """Get all available MCP server configurations.
    
    Returns servers from:
    - Global config: ~/.copilot/mcp-config.json
    - Plugin configs: ~/.copilot/installed-plugins/copilot-plugins/[plugin]/.mcp.json
    """
    return mcp_service.get_available_servers()


@router.post("/servers/refresh", response_model=MCPServerConfig)
async def refresh_mcp_servers() -> MCPServerConfig:
    """Force refresh the MCP server cache from disk."""
    return mcp_service.refresh()


@router.post("/sessions/{session_id}/{server_name}/oauth-retrigger")
async def retrigger_oauth(session_id: str, server_name: str) -> dict:
    """Cancel any in-flight OAuth task for ``server_name`` and start a fresh one.

    Powers the "Sign in" affordance on a stale ``needs-auth`` badge. Used when
    the user dismissed the original toast or its auth tab expired and they
    want a new auth URL minted right now without waiting for the in-flight
    task's poll budget to expire.

    Returns 202 if the retrigger was accepted, 409 if the session is cold
    (no live SDK session yet — the user must send their first message), or
    404 if the session id is unknown.
    """
    if not copilot_service.is_session_active(session_id):
        raise HTTPException(status_code=404, detail="Session not active")
    coordinator = copilot_service.get_oauth_coordinator(session_id)
    if coordinator is None:
        # Session is registered but no OAuth coordinator exists yet — that
        # means no message has been sent in this session. Cold path will
        # mint a fresh OAuth flow on the first send_message; nothing to
        # retrigger here.
        raise HTTPException(
            status_code=409,
            detail="Session has no active OAuth coordinator (send a message first)",
        )
    await coordinator.retrigger(server_name)
    return {"status": "accepted", "serverName": server_name}
