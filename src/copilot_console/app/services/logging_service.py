"""Session-aware logging service.

Provides file-based logging organized by session, with both console
and persistent file output.

Log structure:
    ~/.copilot-console/logs/
    ├── server.log              # Global server events
    └── sessions/
        └── {session_id}.log    # Per-session logs
"""

import logging
import os
import sys
from contextvars import ContextVar
from typing import Optional

from copilot_console.app.config import APP_HOME

# Context variable for session-aware logging
_current_session_id: ContextVar[Optional[str]] = ContextVar("session_id", default=None)

# Log directories
LOGS_DIR = APP_HOME / "logs"
SESSION_LOGS_DIR = LOGS_DIR / "sessions"

# Log format
LOG_FORMAT = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def ensure_log_dirs() -> None:
    """Create log directories if they don't exist."""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    SESSION_LOGS_DIR.mkdir(exist_ok=True)


class SessionFileHandler(logging.Handler):
    """Handler that writes to session-specific log files.

    Uses context variables to determine which session the log belongs to,
    then writes to the appropriate file.
    """

    def __init__(self):
        super().__init__()
        self._file_handlers: dict[str, logging.FileHandler] = {}
        self._server_handler: Optional[logging.FileHandler] = None
        ensure_log_dirs()

    def _get_server_handler(self) -> logging.FileHandler:
        """Get or create the global server log handler."""
        if self._server_handler is None:
            log_file = LOGS_DIR / "server.log"
            self._server_handler = logging.FileHandler(log_file, encoding="utf-8")
            self._server_handler.setFormatter(
                logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT)
            )
        return self._server_handler

    def _get_session_handler(self, session_id: str) -> logging.FileHandler:
        """Get or create a session-specific log handler."""
        key = f"session:{session_id}"
        if key not in self._file_handlers:
            log_file = SESSION_LOGS_DIR / f"{session_id}.log"
            handler = logging.FileHandler(log_file, encoding="utf-8")
            handler.setFormatter(
                logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT)
            )
            self._file_handlers[key] = handler
        return self._file_handlers[key]

    def emit(self, record: logging.LogRecord) -> None:
        """Write log record to appropriate file(s)."""
        try:
            session_id = _current_session_id.get()

            if session_id:
                session_handler = self._get_session_handler(session_id)
                session_handler.emit(record)
                return

            server_handler = self._get_server_handler()
            server_handler.emit(record)
        except Exception:
            self.handleError(record)

    def close(self) -> None:
        """Close all file handlers."""
        if self._server_handler:
            self._server_handler.close()
        for handler in self._file_handlers.values():
            handler.close()
        self._file_handlers.clear()
        super().close()


class SessionLogger:
    """Context manager for session-scoped logging."""

    def __init__(self, session_id: Optional[str] = None):
        self.session_id = session_id
        self._session_token = None

    def __enter__(self) -> "SessionLogger":
        if self.session_id:
            self._session_token = _current_session_id.set(self.session_id)
        return self

    def __exit__(self, *args) -> None:
        if self._session_token:
            _current_session_id.reset(self._session_token)


def set_session_context(session_id: Optional[str]) -> None:
    """Set the current session context for logging."""
    _current_session_id.set(session_id)


def get_session_context() -> Optional[str]:
    """Get the current session ID from context."""
    return _current_session_id.get()


# Global session file handler instance
_session_file_handler: Optional[SessionFileHandler] = None


def setup_logging(level: int = logging.INFO) -> None:
    """Configure logging with both console and session file output.

    Console level defaults to INFO for clean user-facing output.
    File logging always uses the provided level (DEBUG for comprehensive logs).
    Set COPILOT_VERBOSE=1 env var to enable DEBUG output on console too.
    """
    global _session_file_handler

    ensure_log_dirs()

    # Check if verbose console output is requested
    verbose = os.environ.get("COPILOT_VERBOSE", "").strip() == "1"
    console_level = logging.DEBUG if verbose else logging.INFO

    # Get root logger — set to lowest level so file handlers get everything
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    # Remove existing handlers to avoid duplicates
    root_logger.handlers.clear()

    # Console handler — force UTF-8 to avoid cp1252 errors on Windows
    # when agent responses contain Unicode characters (arrows, emoji, etc.)
    utf8_stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', errors='replace', closefd=False)
    console_handler = logging.StreamHandler(utf8_stdout)
    console_handler.setLevel(console_level)
    console_handler.setFormatter(
        logging.Formatter("%(levelname)-7s | %(name)s - %(message)s")
    )
    root_logger.addHandler(console_handler)

    # Session file handler — always uses the full level for comprehensive logs
    _session_file_handler = SessionFileHandler()
    _session_file_handler.setLevel(level)
    root_logger.addHandler(_session_file_handler)

    # Reduce noise from third-party libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sse_starlette.sse").setLevel(logging.WARNING)
    logging.getLogger("tzlocal").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)

    logging.info(f"Logging initialized. Logs dir: {LOGS_DIR}")


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance."""
    return logging.getLogger(name)


def read_session_logs(
    session_id: str,
    tail: Optional[int] = None,
    level: Optional[str] = None
) -> list[str]:
    """Read logs for a specific session."""
    log_file = SESSION_LOGS_DIR / f"{session_id}.log"
    if not log_file.exists():
        return []

    lines = log_file.read_text(encoding="utf-8").splitlines()

    if level:
        level_upper = level.upper()
        lines = [l for l in lines if f"| {level_upper}" in l]

    if tail and tail > 0:
        lines = lines[-tail:]

    return lines


def read_server_logs(tail: Optional[int] = 100) -> list[str]:
    """Read the global server log."""
    log_file = LOGS_DIR / "server.log"
    if not log_file.exists():
        return []

    lines = log_file.read_text(encoding="utf-8").splitlines()

    if tail and tail > 0:
        lines = lines[-tail:]

    return lines
