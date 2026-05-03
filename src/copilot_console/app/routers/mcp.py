"""MCP servers router - list available MCP servers and manage session selections."""

import json
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from copilot_console.app.models.mcp import MCPServer, MCPServerConfig, MCPServerScope
from copilot_console.app.services.copilot_service import copilot_service
from copilot_console.app.services.mcp_service import (
    MCPInvalidConfigError,
    MCPNameConflictError,
    MCPNotFoundError,
    MCPReadOnlyError,
    mcp_service,
)
from copilot_console.app.services.storage_service import storage_service
from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/mcp", tags=["mcp"])


_MCP_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")
_MAX_AUTO_ENABLE_ENTRIES = 500
_MAX_INNER_CONFIG_BYTES = 64 * 1024  # S7: bound CRUD payload size


class MCPSettingsResponse(BaseModel):
    """Response shape for MCP-specific settings (per-server auto-enable map)."""

    mcp_auto_enable: dict[str, bool] = Field(default_factory=dict)


class MCPSettingsPatch(BaseModel):
    """Patch payload for MCP settings.

    ``mcp_auto_enable`` is a partial map: ``true``/``false`` sets the flag for
    that server, ``null`` removes the entry. Server names not present in the
    patch are left untouched.
    """

    mcp_auto_enable: dict[str, bool | None] | None = Field(default=None)


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


@router.get("/settings", response_model=MCPSettingsResponse)
async def get_mcp_settings() -> MCPSettingsResponse:
    """Return MCP-specific settings overlay (per-server auto-enable map).

    Defaults to ``{"mcp_auto_enable": {}}`` if the user has never toggled
    a server. The map is the source of truth for which MCP servers are
    selected by default when starting a new session.
    """
    return MCPSettingsResponse(mcp_auto_enable=storage_service.get_mcp_auto_enable())


@router.patch("/settings", response_model=MCPSettingsResponse)
async def patch_mcp_settings(patch: MCPSettingsPatch) -> MCPSettingsResponse:
    """Partially update the auto-enable map.

    Body shape::

        {"mcp_auto_enable": {"fs": true, "github": false, "old": null}}

    - ``true``/``false`` set the flag for that server.
    - ``null`` removes the entry (used when a server is deleted).
    - Names omitted from the body are left unchanged.

    Validates each server name against ``^[A-Za-z0-9_.\\-]{1,64}$`` and caps
    the patch at 500 entries to bound write cost. Returns the full updated map.
    """
    if patch.mcp_auto_enable is None:
        # Nothing to change — return current state. PATCH semantics allow no-op bodies.
        return MCPSettingsResponse(mcp_auto_enable=storage_service.get_mcp_auto_enable())

    entries = patch.mcp_auto_enable
    if len(entries) > _MAX_AUTO_ENABLE_ENTRIES:
        raise HTTPException(
            status_code=413,
            detail=f"Too many entries in patch (max {_MAX_AUTO_ENABLE_ENTRIES})",
        )

    # Validate every name before mutating disk so partial writes can't happen.
    for name in entries:
        if not isinstance(name, str) or not _MCP_NAME_PATTERN.match(name):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid MCP server name '{name}': must match {_MCP_NAME_PATTERN.pattern}",
            )

    # Split into sets/removes to use the right storage helper for each.
    sets: dict[str, bool] = {name: bool(value) for name, value in entries.items() if value is not None}
    removes: list[str] = [name for name, value in entries.items() if value is None]

    if sets:
        storage_service.patch_settings({"mcp_auto_enable": sets})
    for name in removes:
        storage_service.remove_mcp_auto_enable(name)

    return MCPSettingsResponse(mcp_auto_enable=storage_service.get_mcp_auto_enable())


# ---------- CRUD endpoints (Slice 5) -------------------------------------------


class MCPCreateRequest(BaseModel):
    """Request body for POST /servers.

    ``scope`` is "global" or "agent-only" (plugin scope is read-only).
    ``config`` is the inner MCP server config (``{command, args, ...}`` or
    ``{type, url, headers, ...}``). When ``autoEnable`` is provided we update
    the settings overlay in the same request (S6) so the UI doesn't have to
    issue two separate calls and risk a half-applied state.
    """

    scope: MCPServerScope
    name: str = Field(..., min_length=1, max_length=64)
    config: dict
    autoEnable: bool | None = None


class MCPUpdateRequest(BaseModel):
    """Request body for PUT /servers/{name}. Replaces the inner config in place."""

    config: dict
    autoEnable: bool | None = None


def _validate_name(name: str) -> None:
    if not _MCP_NAME_PATTERN.match(name):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid MCP server name '{name}': must match {_MCP_NAME_PATTERN.pattern}",
        )


def _validate_config_size(config: dict) -> None:
    """Reject oversized config payloads to bound disk write cost."""
    serialised = json.dumps(config)
    if len(serialised.encode("utf-8")) > _MAX_INNER_CONFIG_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Server config exceeds {_MAX_INNER_CONFIG_BYTES} bytes",
        )


def _crud_to_http(exc: Exception) -> HTTPException:
    """Translate service-layer exceptions to HTTP errors with stable codes."""
    if isinstance(exc, MCPNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, MCPReadOnlyError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, MCPNameConflictError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, MCPInvalidConfigError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@router.post("/servers", response_model=MCPServer, status_code=201)
async def create_mcp_server(request: MCPCreateRequest) -> MCPServer:
    """Create a new MCP server in the chosen scope (global or agent-only).

    Optionally accepts ``autoEnable`` to set the per-server auto-enable flag
    atomically in the same call (S6 — avoids the FE needing two round-trips).
    Plugin scope is rejected by Pydantic enum validation (422).
    """
    _validate_name(request.name)
    _validate_config_size(request.config)

    try:
        server = await mcp_service.add_server(request.scope, request.name, request.config)
    except (
        MCPInvalidConfigError,
        MCPNameConflictError,
        MCPReadOnlyError,
    ) as exc:
        raise _crud_to_http(exc) from exc

    if request.autoEnable is not None:
        try:
            storage_service.set_mcp_auto_enable(request.name, request.autoEnable)
        except Exception as exc:  # don't fail the create; log and continue
            logger.warning(
                f"Created MCP server '{request.name}' but failed to set auto-enable: {exc}"
            )

    return server


@router.put("/servers/{name}", response_model=MCPServer)
async def update_mcp_server(name: str, request: MCPUpdateRequest) -> MCPServer:
    """Replace the inner config of an existing writable MCP server.

    Returns 404 if the server does not exist, 403 if it lives under a plugin
    (read-only), 400 if the config shape is invalid. Scope cannot be changed
    via update — delete + add to move a server between global and agent-only.
    """
    _validate_name(name)
    _validate_config_size(request.config)
    try:
        server = await mcp_service.update_server(name, request.config)
    except (
        MCPNotFoundError,
        MCPReadOnlyError,
        MCPInvalidConfigError,
    ) as exc:
        raise _crud_to_http(exc) from exc

    if request.autoEnable is not None:
        try:
            storage_service.set_mcp_auto_enable(name, request.autoEnable)
        except Exception as exc:
            logger.warning(
                f"Updated MCP server '{name}' but failed to set auto-enable: {exc}"
            )

    return server


@router.delete("/servers/{name}", status_code=204)
async def delete_mcp_server(name: str) -> None:
    """Delete a writable MCP server and clear its auto-enable flag.

    Returns 404 if the server doesn't exist, 403 for plugin servers. The
    service layer also strips the corresponding ``mcp_auto_enable`` entry
    so deleted servers don't linger as ghost selections in new sessions.
    """
    _validate_name(name)
    try:
        await mcp_service.delete_server(name)
    except (MCPNotFoundError, MCPReadOnlyError) as exc:
        raise _crud_to_http(exc) from exc


@router.post("/servers/{name}/reset-oauth")
async def reset_mcp_oauth(name: str) -> dict:
    """Wipe cached OAuth registration + tokens for a remote MCP server.

    Brute-force scans ``~/.copilot/mcp-oauth-config/*.json`` matching by
    ``serverUrl`` and deletes both the registration file and its sibling
    ``.tokens.json``. Use this when an OAuth flow is wedged or the server
    rotated its client config.

    Returns 404 if the server is unknown, 400 if it's a local (non-remote)
    server. Idempotent: calling twice is a no-op the second time.
    """
    _validate_name(name)
    try:
        return await mcp_service.reset_oauth(name)
    except (MCPNotFoundError, MCPInvalidConfigError) as exc:
        raise _crud_to_http(exc) from exc
