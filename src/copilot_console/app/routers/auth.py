"""Auth router — non-blocking auth status check."""

from fastapi import APIRouter

from copilot_console.app.services.copilot_service import copilot_service
from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

_UNAUTHENTICATED = {
    "authenticated": False,
    "provider": None,
    "login": None,
}


@router.get("/status")
async def get_auth_status():
    """Return current GitHub Copilot authentication status.

    Always returns a valid response — never crashes. If the SDK
    isn't ready or the check fails, reports unauthenticated.
    """
    try:
        await copilot_service._start_main_client()
        client = copilot_service._main_client
        if client is None:
            return _UNAUTHENTICATED

        status = await client.get_auth_status()
        is_authed = getattr(status, "isAuthenticated", False) if status else False
        login = getattr(status, "login", None) if status else None

        return {
            "authenticated": bool(is_authed),
            "provider": "github" if is_authed else None,
            "login": login or None,
        }
    except Exception:
        logger.debug("Auth status check failed — reporting unauthenticated", exc_info=True)
        return _UNAUTHENTICATED
