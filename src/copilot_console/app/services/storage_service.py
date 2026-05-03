"""Storage service for filesystem operations.

Only stores session name mappings and user settings - SDK handles all message history.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from copilot_console.app.config import DEFAULT_CWD, DEFAULT_MODEL, DEFAULT_WORKFLOW_STEP_TIMEOUT, METADATA_FILE, SESSIONS_DIR, SETTINGS_FILE, ensure_directories
from copilot_console.app.models.session import Session


def atomic_write(path: Path, content: str, encoding: str = "utf-8") -> None:
    """Write *content* to *path* atomically via a temp file + os.replace().

    This prevents data corruption if the process crashes mid-write.
    The temp file is placed next to the target so os.replace() is same-filesystem.
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text(content, encoding=encoding)
    os.replace(str(tmp), str(path))


def atomic_write_json(path: Path, data: Any, *, indent: int = 2) -> None:
    """Serialize *data* to JSON and write atomically. Convenience wrapper around atomic_write.

    Ensures consistent indent + newline-terminated output for diff-friendly storage.
    """
    payload = json.dumps(data, indent=indent, ensure_ascii=False)
    if not payload.endswith("\n"):
        payload += "\n"
    atomic_write(path, payload)


def deep_merge(base: dict, patch: dict) -> dict:
    """Return a new dict combining *base* and *patch*, recursively merging nested dicts.

    Rules:
    - Keys present only in base are kept.
    - Keys present only in patch are added.
    - Keys present in both: if both values are dicts, recursively merge; otherwise patch wins.
    - Lists, scalars, and None are replaced wholesale (NOT concatenated/merged).

    Does not mutate either input. Used by patch_settings() to apply partial updates
    without losing sibling keys (e.g., updating mcp_auto_enable[name] preserves other entries).
    """
    result = dict(base)
    for key, patch_value in patch.items():
        base_value = result.get(key)
        if isinstance(base_value, dict) and isinstance(patch_value, dict):
            result[key] = deep_merge(base_value, patch_value)
        else:
            result[key] = patch_value
    return result


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
            "selected_agent": session.selected_agent,
            "agent_mode": session.agent_mode,
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
            if "mcp_auto_enable" not in settings or not isinstance(settings.get("mcp_auto_enable"), dict):
                settings["mcp_auto_enable"] = {}
            return settings
        return {
            "default_model": DEFAULT_MODEL,
            "default_cwd": DEFAULT_CWD,
            "workflow_step_timeout": DEFAULT_WORKFLOW_STEP_TIMEOUT,
            "cli_notifications": False,
            "mcp_auto_enable": {},
        }

    def update_settings(self, settings: dict) -> dict:
        """Update user settings (shallow merge — top-level keys only).

        For partial updates to nested dicts (e.g., a single key inside
        mcp_auto_enable), use patch_settings() which deep-merges and
        re-reads from disk to avoid lost updates.
        """
        current = self.get_settings()
        current.update(settings)
        atomic_write_json(SETTINGS_FILE, current)
        return current

    def patch_settings(self, patch: dict) -> dict:
        """Apply *patch* to settings via re-read + deep merge + atomic write.

        Reads the current settings.json fresh from disk inside this call,
        deep-merges the patch (so nested dicts like mcp_auto_enable preserve
        sibling keys), then atomically writes the result back. Returns the
        merged settings.

        Use this for any partial update where the caller only knows a subset
        of keys it wants to change. Concurrent callers patching different
        keys will both succeed because each call re-reads before merging.
        (Single FastAPI worker + sync I/O serializes naturally on the event
        loop; no explicit lock needed for in-process writes.)
        """
        current = self.get_settings()
        merged = deep_merge(current, patch)
        atomic_write_json(SETTINGS_FILE, merged)
        return merged

    def get_mcp_auto_enable(self) -> dict[str, bool]:
        """Return the current per-server auto-enable map (server name -> bool).

        Always returns a dict (defaulting to {}). Servers not in the map should
        be treated as NOT auto-enabled by callers.
        """
        raw = self.get_settings().get("mcp_auto_enable", {}) or {}
        # Coerce values to bool defensively in case settings.json was hand-edited.
        return {str(name): bool(value) for name, value in raw.items() if isinstance(name, str)}

    def set_mcp_auto_enable(self, name: str, enabled: bool) -> dict[str, bool]:
        """Set the auto-enable flag for a single server, preserving other entries.

        Uses patch_settings() so concurrent updates to different server names
        do not lose each other's writes.
        """
        if not isinstance(name, str) or not name:
            raise ValueError("name must be a non-empty string")
        merged = self.patch_settings({"mcp_auto_enable": {name: bool(enabled)}})
        return merged.get("mcp_auto_enable", {})

    def remove_mcp_auto_enable(self, name: str) -> dict[str, bool]:
        """Drop a server entry from the auto-enable map (used when a server is deleted).

        Re-reads, removes the key, atomic-writes. Idempotent — missing key is a no-op.
        """
        current = self.get_settings()
        auto = dict(current.get("mcp_auto_enable") or {})
        if name in auto:
            auto.pop(name)
            current["mcp_auto_enable"] = auto
            atomic_write_json(SETTINGS_FILE, current)
        return current.get("mcp_auto_enable", {})


# Singleton instance
storage_service = StorageService()
