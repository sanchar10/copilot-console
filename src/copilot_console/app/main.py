"""FastAPI application entry point."""

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from copilot_console.app.config import API_PREFIX, ensure_directories
from copilot_console.app.routers import agents, filesystem, logs, mcp, models, automations, projects, sessions, settings, tools, task_runs, viewed, push, workflows
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


def _set_sleep_prevention(enable: bool) -> None:
    """Enable or disable Windows sleep prevention via SetThreadExecutionState."""
    if sys.platform != "win32":
        return
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
    version="0.4.0",
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

# Token-based auth for non-localhost API access (mobile companion via tunnel)
app.add_middleware(TokenAuthMiddleware)

# Include routers
app.include_router(agents.router, prefix=API_PREFIX)
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
app.include_router(workflows.router, prefix=API_PREFIX)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


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
