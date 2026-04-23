"""FastAPI application entry point."""

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from copilot_console.app.middleware.selective_gzip import SelectiveGZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from copilot_console.app.config import API_PREFIX, ensure_directories
from copilot_console.app.routers import agents, auth, filesystem, logs, mcp, models, automations, projects, sessions, settings, tools, task_runs, viewed, push, pins, cli_hooks, search
try:
    from copilot_console.app.routers import workflows
    _has_workflows = True
except ImportError:
    _has_workflows = False
from copilot_console.app.services.copilot_service import copilot_service
from copilot_console.app.services.response_buffer import response_buffer_manager
from copilot_console.app.services.task_runner_service import TaskRunnerService
from copilot_console.app.services.automation_service import AutomationService
from copilot_console.app.services.logging_service import setup_logging, get_logger
from copilot_console.app.middleware.auth import TokenAuthMiddleware

# Configure logging with session-aware file logging (DEBUG level for comprehensive event logging)
setup_logging(level=logging.DEBUG)
logger = get_logger(__name__)

# Static files directory (bundled frontend)
STATIC_DIR = Path(__file__).parent.parent / "static"

# Dev fallback: when running from source (pip install -e .),
# static/ doesn't exist — use frontend/dist/ instead
if not STATIC_DIR.exists():
    _dev_dist = Path(__file__).parent.parent.parent.parent / "frontend" / "dist"
    if _dev_dist.exists():
        STATIC_DIR = _dev_dist
        logger.info("Using dev fallback: serving frontend from %s", _dev_dist)

# macOS caffeinate process
_caffeinate_proc: Optional["subprocess.Popen[bytes]"] = None


def _set_sleep_prevention(enable: bool) -> None:
    """Enable or disable sleep prevention (Windows via SetThreadExecutionState, macOS via caffeinate)."""
    global _caffeinate_proc
    
    if sys.platform == "win32":
        try:
            import ctypes
            ES_CONTINUOUS = 0x80000000
            ES_SYSTEM_REQUIRED = 0x00000001
            if enable:
                ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
                logger.info("Sleep prevention enabled — Windows will not idle-sleep")
            else:
                ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
                logger.info("Sleep prevention cleared — normal sleep behavior restored")
        except Exception as e:
            logger.warning(f"Failed to set sleep prevention: {e}")
    elif sys.platform == "darwin":
        try:
            if enable:
                import subprocess
                _caffeinate_proc = subprocess.Popen(
                    ["caffeinate", "-i", "-w", str(os.getpid())],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
                logger.info("Sleep prevention enabled — caffeinate running")
            else:
                if _caffeinate_proc:
                    _caffeinate_proc.terminate()
                    _caffeinate_proc = None
                logger.info("Sleep prevention cleared")
        except Exception as e:
            logger.warning(f"Failed to set sleep prevention: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - startup and shutdown."""
    # Startup
    logger.info("Starting Copilot Console...")
    ensure_directories()
    # Pre-start main SDK client for reliable operation
    await copilot_service._start_main_client()
    # Start buffer cleanup task
    response_buffer_manager.start_cleanup_task()
    # Start task runner and automation service
    task_runner = TaskRunnerService(copilot_service, response_buffer_manager)
    automation_svc = AutomationService(task_runner)
    automation_svc.start()
    # Store on app state for access from routers
    app.state.task_runner = task_runner
    app.state.automation_service = automation_svc
    # Enable sleep prevention if --no-sleep flag was passed
    no_sleep = os.environ.get("COPILOT_NO_SLEEP") == "1"
    if no_sleep:
        _set_sleep_prevention(True)
    # Check for unread sessions and send push notifications
    from copilot_console.app.services.notification_manager import notification_manager
    await notification_manager.check_unread_on_startup()
    logger.info("Copilot Console started successfully")
    yield
    # Shutdown
    logger.info("Shutting down Copilot Console...")
    if no_sleep:
        _set_sleep_prevention(False)
    automation_svc.shutdown()
    await copilot_service.stop()


app = FastAPI(
    title="Copilot Console API",
    description="Backend API for Copilot Console - A feature-rich console for GitHub Copilot agents",
    version=__import__("copilot_console").__version__,
    lifespan=lifespan,
)

# CORS configuration — allow tunnel origins when running in expose mode
_cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
if os.environ.get("COPILOT_EXPOSE") == "1":
    # In expose mode, allow any origin (tunnel URLs are unpredictable)
    # Auth middleware protects API routes via bearer token
    _cors_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Compress responses >1KB, but skip SSE streams so they flow in real-time
app.add_middleware(SelectiveGZipMiddleware, minimum_size=1000)

# Token-based auth for non-localhost API access (mobile companion via tunnel)
app.add_middleware(TokenAuthMiddleware)

# Include routers
app.include_router(agents.router, prefix=API_PREFIX)
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(filesystem.router, prefix=API_PREFIX)
app.include_router(logs.router, prefix=API_PREFIX)
app.include_router(mcp.router, prefix=API_PREFIX)
app.include_router(models.router, prefix=API_PREFIX)
app.include_router(automations.router, prefix=API_PREFIX)
app.include_router(projects.router, prefix=API_PREFIX)
app.include_router(sessions.router, prefix=API_PREFIX)
app.include_router(settings.router, prefix=API_PREFIX)
app.include_router(tools.router, prefix=API_PREFIX)
app.include_router(task_runs.router, prefix=API_PREFIX)
app.include_router(viewed.router, prefix=API_PREFIX)
app.include_router(push.router, prefix=API_PREFIX)
if _has_workflows:
    app.include_router(workflows.router, prefix=API_PREFIX)
app.include_router(pins.router, prefix=API_PREFIX)
app.include_router(cli_hooks.router, prefix=API_PREFIX)
app.include_router(search.router, prefix=API_PREFIX)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get(f"{API_PREFIX}/features")
async def get_features():
    """Check which optional features are available."""
    install_cmd = "python -m pip install agent-framework --pre"
    if sys.platform != "win32":
        install_cmd = "python3 -m pip install agent-framework --pre"
    return {
        "agent_framework": _has_workflows,
        "install_command": install_cmd,
    }


# Serve static files (built frontend) if available
if STATIC_DIR.exists():
    # Serve index.html for SPA routes
    @app.get("/")
    async def serve_root():
        return FileResponse(STATIC_DIR / "index.html")
    
    # Serve static assets
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")
    
    # Catch-all for SPA routing (must be last)
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # If it's an API route, let it 404 naturally
        if full_path.startswith("api/"):
            return {"error": "Not found"}
        # Otherwise serve index.html for SPA routing
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")
