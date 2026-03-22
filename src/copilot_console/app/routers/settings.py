"""Settings router - user preferences and update checks."""

import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from copilot_console.app.middleware.auth import (
    _is_localhost,
    generate_api_token,
    get_or_create_api_token,
)
from copilot_console.app.services.storage_service import storage_service

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    default_model: str | None = None
    default_cwd: str | None = None
    workflow_step_timeout: int | None = None
    cli_notifications: bool | None = None


@router.get("")
async def get_settings() -> dict:
    """Get user settings."""
    return storage_service.get_settings()


@router.patch("")
async def update_settings(request: SettingsUpdate) -> dict:
    """Update user settings."""
    updates = {}
    if request.default_model is not None:
        updates["default_model"] = request.default_model
    if request.default_cwd is not None:
        # Validate CWD path exists
        if not os.path.isdir(request.default_cwd):
            raise HTTPException(
                status_code=400,
                detail=f"Directory does not exist: {request.default_cwd}"
            )
        updates["default_cwd"] = request.default_cwd
    if request.workflow_step_timeout is not None:
        if request.workflow_step_timeout < 30:
            raise HTTPException(
                status_code=400,
                detail="workflow_step_timeout must be at least 30 seconds"
            )
        updates["workflow_step_timeout"] = request.workflow_step_timeout
    if request.cli_notifications is not None:
        updates["cli_notifications"] = request.cli_notifications
        _sync_hook_config(request.cli_notifications)
    return storage_service.update_settings(updates)


def _sync_hook_config(enabled: bool) -> None:
    """Create or remove the CLI agentStop hook config to match the setting."""
    import json
    from pathlib import Path
    hooks_dir = Path.home() / ".copilot" / "hooks"
    hook_file = hooks_dir / "console-notifications.json"

    if enabled:
        hooks_dir.mkdir(parents=True, exist_ok=True)
        config = {
            "version": 1,
            "hooks": {
                "agentStop": [{
                    "type": "command",
                    "bash": "cli-notify hook agent-stop",
                    "powershell": "cli-notify hook agent-stop",
                    "timeoutSec": 10,
                }],
            },
        }
        hook_file.write_text(json.dumps(config, indent=2), encoding="utf-8")
    else:
        if hook_file.exists():
            hook_file.unlink()


@router.get("/update-check")
async def check_for_update() -> dict:
    """Check GitHub releases for a newer version."""
    import httpx
    from copilot_console import __version__

    repo = "sanchar10/copilot-agent-console"
    url = f"https://api.github.com/repos/{repo}/releases/latest"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url, headers={"Accept": "application/vnd.github.v3+json"})
            if resp.status_code == 404:
                return {"update_available": False, "current_version": __version__}
            resp.raise_for_status()
            data = resp.json()

        latest_tag = data.get("tag_name", "")
        latest_version = latest_tag.lstrip("v")

        # Find the wheel asset URL
        wheel_url = None
        for asset in data.get("assets", []):
            if asset["name"].endswith(".whl"):
                wheel_url = asset["browser_download_url"]
                break

        update_available = latest_version != __version__ and latest_version > __version__

        return {
            "update_available": update_available,
            "current_version": __version__,
            "latest_version": latest_version,
            "wheel_url": wheel_url,
            "release_url": data.get("html_url", ""),
        }
    except Exception:
        return {"update_available": False, "current_version": __version__}


@router.get("/api-token")
async def get_api_token(request: Request) -> dict:
    """Get the current API token. Only accessible from localhost."""
    if not _is_localhost(request):
        raise HTTPException(status_code=403, detail="Token retrieval only allowed from localhost")
    token = get_or_create_api_token()
    return {"api_token": token}


@router.post("/api-token/regenerate")
async def regenerate_api_token(request: Request) -> dict:
    """Regenerate the API token. Only accessible from localhost."""
    if not _is_localhost(request):
        raise HTTPException(status_code=403, detail="Token regeneration only allowed from localhost")
    new_token = generate_api_token()
    storage_service.update_settings({"api_token": new_token})
    return {"api_token": new_token}


@router.get("/mobile-companion")
async def get_mobile_companion_info(request: Request) -> dict:
    """Get mobile companion connection info (tunnel URL, expose mode, token).
    
    Only accessible from localhost.
    """
    if not _is_localhost(request):
        raise HTTPException(status_code=403, detail="Only accessible from localhost")
    settings = storage_service.get_settings()
    expose = os.environ.get("COPILOT_EXPOSE") == "1"
    return {
        "expose": expose,
        "tunnel_url": settings.get("tunnel_url", ""),
        "api_token": get_or_create_api_token(),
    }


@router.post("/mobile-companion/tunnel-url")
async def set_tunnel_url(request: Request) -> dict:
    """Set the tunnel URL (called by dev script when devtunnel starts).
    
    Only accessible from localhost.
    """
    if not _is_localhost(request):
        raise HTTPException(status_code=403, detail="Only accessible from localhost")
    body = await request.json()
    url = body.get("tunnel_url", "")
    storage_service.update_settings({"tunnel_url": url})
    return {"tunnel_url": url}
