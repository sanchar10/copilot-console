"""Auth router — multi-source auth detection, login, and logout.

Authentication is checked from multiple sources in priority order:
1. SDK ``get_auth_status()`` (fastest — checks bundled CLI tokens)
2. Functional probe — the main client exists and is started
3. GitHub CLI (``gh auth status``) — catches ``gh auth login`` tokens

If *any* source reports authenticated, the user is authenticated.
"""

import asyncio
import json
import os
import platform
import subprocess
import sys
from typing import AsyncGenerator

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from copilot_console.app.services.copilot_service import copilot_service
from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

_UNAUTHENTICATED = {
    "authenticated": False,
    "provider": None,
    "login": None,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_copilot_binary() -> str | None:
    """Locate the SDK's bundled Copilot CLI binary (cross-platform)."""
    try:
        import copilot as _copilot_pkg

        sdk_dir = os.path.dirname(_copilot_pkg.__file__)
        name = "copilot.exe" if platform.system() == "Windows" else "copilot"
        binary = os.path.join(sdk_dir, "bin", name)
        if os.path.isfile(binary):
            return binary
    except Exception:
        pass
    return None


async def _check_sdk_auth() -> dict | None:
    """Try SDK ``get_auth_status()`` — returns auth dict or *None* on failure."""
    try:
        await copilot_service._start_main_client()
        client = copilot_service._main_client
        if client is None:
            logger.warning("SDK client is None after _start_main_client()")
            return None

        status = await client.get_auth_status()
        is_authed = getattr(status, "isAuthenticated", False) if status else False
        if not is_authed:
            return None

        login = getattr(status, "login", None) or None
        logger.debug(f"SDK auth confirmed — login={login}")
        return {
            "authenticated": True,
            "provider": "github",
            "login": login,
        }
    except Exception as e:
        logger.warning(f"SDK auth check failed: {type(e).__name__}: {e}")
        return None



def _run_gh_auth_status()-> subprocess.CompletedProcess:
    """Synchronous helper — runs ``gh auth status --active``."""
    return subprocess.run(
        ["gh", "auth", "status", "--active"],
        capture_output=True,
        timeout=5,
    )


async def _check_gh_cli_auth() -> dict | None:
    """Run ``gh auth status --active`` to detect GitHub CLI authentication."""
    try:
        result = await asyncio.to_thread(_run_gh_auth_status)
        output = (result.stdout or b"").decode(errors="replace") + (result.stderr or b"").decode(errors="replace")

        if result.returncode == 0:
            # Parse login from output like "Logged in to github.com account username"
            login = None
            for line in output.splitlines():
                low = line.lower()
                if "account" in low:
                    parts = line.strip().split()
                    idx = None
                    for i, p in enumerate(parts):
                        if p.lower() == "account":
                            idx = i
                    if idx is not None and idx + 1 < len(parts):
                        login = parts[idx + 1].strip("() ")
                    break
            return {
                "authenticated": True,
                "provider": "github",
                "login": login or None,
            }
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    except Exception:
        logger.debug("gh CLI auth check failed", exc_info=True)
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
async def get_auth_status():
    """Return current authentication status.

    Checks multiple sources in order — SDK, then GitHub CLI.
    Always returns a valid response, never crashes.
    """
    try:
        # 1. SDK get_auth_status (fastest, most detailed)
        result = await _check_sdk_auth()
        if result:
            return result

        # 2. GitHub CLI fallback
        result = await _check_gh_cli_auth()
        if result:
            return result

    except Exception:
        logger.debug("Auth status check failed — reporting unauthenticated", exc_info=True)

    return _UNAUTHENTICATED


@router.post("/login")
async def login():
    """Start Copilot CLI login flow via SSE.

    Streams the device-code / URL output so the frontend can display it
    while the user authorises in their browser.
    """
    binary = _find_copilot_binary()
    if not binary:
        return EventSourceResponse(
            _error_stream("Copilot CLI binary not found — cannot start login"),
        )

    async def _stream() -> AsyncGenerator[dict, None]:
        try:
            # Use sync Popen in a thread to avoid asyncio subprocess issues
            # on Windows + Python 3.14 (NotImplementedError).
            import queue
            import threading

            line_queue: queue.Queue[str | None] = queue.Queue()

            def _run_login_process():
                try:
                    proc = subprocess.Popen(
                        [binary, "login"],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                    )
                    assert proc.stdout is not None
                    for raw_line in proc.stdout:
                        line_queue.put(raw_line.decode(errors="replace").rstrip("\n\r"))
                    proc.wait(timeout=300)
                    line_queue.put(None)  # sentinel
                    line_queue.put(str(proc.returncode))  # return code
                except subprocess.TimeoutExpired:
                    line_queue.put(None)
                    line_queue.put("timeout")
                except Exception as exc:
                    line_queue.put(None)
                    line_queue.put(f"error:{exc}")

            thread = threading.Thread(target=_run_login_process, daemon=True)
            thread.start()

            # Read lines from the queue, yielding SSE events
            while True:
                line = await asyncio.to_thread(line_queue.get)
                if line is None:
                    break
                if line:
                    yield {"event": "output", "data": json.dumps({"line": line})}

            # Next item is the return code / error indicator
            rc_or_err = await asyncio.to_thread(line_queue.get)
            thread.join(timeout=5)

            if rc_or_err == "timeout":
                yield {"event": "error", "data": json.dumps({"message": "Login timed out after 5 minutes"})}
            elif rc_or_err is not None and rc_or_err.startswith("error:"):
                yield {"event": "error", "data": json.dumps({"message": rc_or_err[6:]})}
            elif rc_or_err == "0":
                status = await get_auth_status()
                yield {"event": "done", "data": json.dumps(status)}
            else:
                yield {
                    "event": "error",
                    "data": json.dumps({"message": f"Login exited with code {rc_or_err}"}),
                }
        except Exception as exc:
            logger.error("Login stream error", exc_info=True)
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(_stream())


@router.post("/logout")
async def logout():
    """Run Copilot CLI logout and return updated auth status."""
    binary = _find_copilot_binary()
    if not binary:
        return {"success": False, "message": "Copilot CLI binary not found", **_UNAUTHENTICATED}

    try:
        def _run_logout():
            return subprocess.run(
                [binary, "logout"],
                capture_output=True,
                timeout=30,
            )

        result = await asyncio.to_thread(_run_logout)
        output = (result.stdout or b"").decode(errors="replace").strip()

        if result.returncode == 0:
            status = await get_auth_status()
            return {"success": True, "message": output or "Logged out", **status}
        else:
            return {"success": False, "message": output or "Logout failed", **_UNAUTHENTICATED}
    except subprocess.TimeoutExpired:
        return {"success": False, "message": "Logout timed out", **_UNAUTHENTICATED}
    except Exception as exc:
        logger.error("Logout failed", exc_info=True)
        return {"success": False, "message": str(exc), **_UNAUTHENTICATED}


async def _error_stream(message: str) -> AsyncGenerator[dict, None]:
    """Yield a single error event for SSE."""
    yield {"event": "error", "data": json.dumps({"message": message})}
