"""Service for tracking when agents last completed in each session.

Stores timestamps in ~/.copilot-console/completion_times.json so that
session updated_at uses our server clock (time.time()) instead of SDK
modifiedTime, which drifts due to post-completion cleanup writes.
"""

import json
import time
from pathlib import Path
from typing import Dict

from copilot_console.app.config import APP_HOME
from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)

COMPLETION_TIMES_FILE = APP_HOME / "completion_times.json"


class CompletionTimesService:
    """Manages agent-completion timestamps for sessions.

    Timestamps are stored in memory for fast reads and written
    immediately to disk for persistence.  Mirrors ViewedService.
    """

    def __init__(self) -> None:
        self._timestamps: Dict[str, float] = {}
        self._load()

    def _load(self) -> None:
        """Load timestamps from disk."""
        if COMPLETION_TIMES_FILE.exists():
            try:
                with open(COMPLETION_TIMES_FILE, "r") as f:
                    data = json.load(f)
                    self._timestamps = {
                        k: float(v) for k, v in data.items()
                        if isinstance(v, (int, float))
                    }
                logger.info(f"Loaded {len(self._timestamps)} completion timestamps")
            except Exception as e:
                logger.warning(f"Failed to load completion_times.json: {e}")
                self._timestamps = {}
        else:
            self._timestamps = {}

    def _save(self) -> None:
        """Save timestamps to disk."""
        try:
            APP_HOME.mkdir(parents=True, exist_ok=True)
            with open(COMPLETION_TIMES_FILE, "w") as f:
                json.dump(self._timestamps, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save completion_times.json: {e}")

    def get_all(self) -> Dict[str, float]:
        """Get all completion timestamps.

        Returns:
            Dict mapping session_id to Unix timestamp (seconds)
        """
        return self._timestamps.copy()

    def get(self, session_id: str) -> float | None:
        """Get the last completion timestamp for a session.

        Returns:
            Unix timestamp (seconds) or None if no completion recorded
        """
        return self._timestamps.get(session_id)

    def mark_completed(self, session_id: str) -> float:
        """Record that an agent just completed in this session.

        Returns:
            The timestamp that was set
        """
        ts = time.time()
        self._timestamps[session_id] = ts
        self._save()
        return ts

    def remove(self, session_id: str) -> bool:
        """Remove a session's completion timestamp.

        Called when a session is deleted.

        Returns:
            True if the entry existed and was removed
        """
        if session_id in self._timestamps:
            del self._timestamps[session_id]
            self._save()
            return True
        return False


# Singleton instance
completion_times_service = CompletionTimesService()
