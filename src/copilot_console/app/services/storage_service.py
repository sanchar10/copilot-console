"""Storage service for filesystem operations.

Only stores session name mappings and user settings - SDK handles all message history.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from copilot_console.app.config import DEFAULT_CWD, DEFAULT_MODEL, DEFAULT_WORKFLOW_STEP_TIMEOUT, METADATA_FILE, SESSIONS_DIR, SETTINGS_FILE, ensure_directories
from copilot_console.app.models.session import Session


def atomic_write(path: Path, content: str, encoding: str = "utf-8") -> None:
    """Write *content* to *path* atomically via a temp file + os.replace().

    This prevents data corruption if the process crashes mid-write.
    The temp file is placed next to the target so os.replace() is same-filesystem.
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding=encoding)
    os.replace(str(tmp), str(path))


class StorageService:
    """Handles session name storage and user settings - SDK handles messages."""

    def __init__(self) -> None:
        ensure_directories()
        self._init_metadata()
        self._init_settings()

    def _init_metadata(self) -> None:
        """Initialize metadata file if it doesn't exist."""
        if not METADATA_FILE.exists():
            metadata = {
                "version": "1.0",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            atomic_write(METADATA_FILE, json.dumps(metadata, indent=2))

    def _init_settings(self) -> None:
        """Initialize settings file if it doesn't exist."""
        if not SETTINGS_FILE.exists():
            settings = {
                "default_model": DEFAULT_MODEL,
                "default_cwd": DEFAULT_CWD,
            }
            atomic_write(SETTINGS_FILE, json.dumps(settings, indent=2))

    def _session_dir(self, session_id: str) -> Path:
        """Get directory for a session."""
        return SESSIONS_DIR / session_id

    def _session_file(self, session_id: str) -> Path:
        """Get session metadata file path."""
        return self._session_dir(session_id) / "session.json"

    def save_session(self, session: Session) -> None:
        """Save session metadata (name, cwd, model, mcp_servers, tools) to disk.
        
        Note: Timestamps are NOT saved - they come from the SDK at runtime.
        """
        session_dir = self._session_dir(session.session_id)
        session_dir.mkdir(parents=True, exist_ok=True)

        # Only save the fields we manage, not timestamps (SDK provides those)
        session_data = {
            "session_id": session.session_id,
            "session_name": session.session_name,
            "model": session.model,
            "reasoning_effort": session.reasoning_effort,
            "cwd": session.cwd,
            "mcp_servers": session.mcp_servers,
            "tools": session.tools.model_dump() if hasattr(session.tools, 'model_dump') else session.tools,
            "system_message": session.system_message,
            "name_set": session.name_set,
            "agent_id": session.agent_id,
            "trigger": session.trigger,
            "sub_agents": session.sub_agents,
        }
        atomic_write(
            self._session_file(session.session_id),
            json.dumps(session_data, indent=2, default=str),
        )

    def load_session(self, session_id: str) -> dict | None:
        """Load session metadata from disk (without timestamps)."""
        session_file = self._session_file(session_id)
        if not session_file.exists():
            return None

        return json.loads(session_file.read_text(encoding="utf-8"))

    def save_session_raw(self, session_id: str, data: dict) -> None:
        """Save raw session metadata dict to disk (for direct updates)."""
        session_dir = self._session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        atomic_write(
            self._session_file(session_id),
            json.dumps(data, indent=2, default=str),
        )

    def list_all_sessions(self) -> list[dict]:
        """List all stored session metadata (without timestamps)."""
        sessions = []
        if SESSIONS_DIR.exists():
            for session_dir in SESSIONS_DIR.iterdir():
                if session_dir.is_dir():
                    session_file = session_dir / "session.json"
                    if session_file.exists():
                        try:
                            data = json.loads(session_file.read_text(encoding="utf-8"))
                            sessions.append(data)
                        except (json.JSONDecodeError, IOError):
                            pass
        return sessions

    def delete_session(self, session_id: str) -> bool:
        """Delete session metadata from disk."""
        import shutil
        session_dir = self._session_dir(session_id)
        if not session_dir.exists():
            return False

        shutil.rmtree(session_dir)
        return True

    def get_settings(self) -> dict:
        """Get user settings."""
        if SETTINGS_FILE.exists():
            settings = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            # Ensure defaults exist (for existing settings files)
            if "default_model" not in settings:
                settings["default_model"] = DEFAULT_MODEL
            if "default_cwd" not in settings:
                settings["default_cwd"] = DEFAULT_CWD
            if "workflow_step_timeout" not in settings:
                settings["workflow_step_timeout"] = DEFAULT_WORKFLOW_STEP_TIMEOUT
            if "cli_notifications" not in settings:
                settings["cli_notifications"] = False
            return settings
        return {"default_model": DEFAULT_MODEL, "default_cwd": DEFAULT_CWD, "workflow_step_timeout": DEFAULT_WORKFLOW_STEP_TIMEOUT, "cli_notifications": False}

    def update_settings(self, settings: dict) -> dict:
        """Update user settings."""
        current = self.get_settings()
        current.update(settings)
        atomic_write(SETTINGS_FILE, json.dumps(current, indent=2))
        return current


# Singleton instance
storage_service = StorageService()
