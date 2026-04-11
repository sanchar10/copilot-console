"""Service for tracking when sessions were last viewed.

Stores timestamps in ~/.copilot-console/viewed.json to track which sessions
have unread content (new messages since last viewed).
"""

import json
from pathlib import Path
from typing import Dict

from copilot_console.app.config import APP_HOME
from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)

# File path for viewed timestamps
VIEWED_FILE = APP_HOME / "viewed.json"


class ViewedService:
    """Manages last-viewed timestamps for sessions.
    
    Timestamps are stored in memory for fast reads and written
    immediately to disk for persistence.
    """

    def __init__(self) -> None:
        self._timestamps: Dict[str, float] = {}
        self._load()

    def _load(self) -> None:
        """Load timestamps from disk."""
        if VIEWED_FILE.exists():
            try:
                with open(VIEWED_FILE, "r") as f:
                    data = json.load(f)
                    # Ensure all values are floats (timestamps)
                    self._timestamps = {
                        k: float(v) for k, v in data.items()
                        if isinstance(v, (int, float))
                    }
                logger.info(f"Loaded {len(self._timestamps)} viewed timestamps")
            except Exception as e:
                logger.warning(f"Failed to load viewed.json: {e}")
                self._timestamps = {}
        else:
            self._timestamps = {}

    def _save(self) -> None:
        """Save timestamps to disk."""
        try:
            APP_HOME.mkdir(parents=True, exist_ok=True)
            with open(VIEWED_FILE, "w") as f:
                json.dump(self._timestamps, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save viewed.json: {e}")

    def get_all(self) -> Dict[str, float]:
        """Get all viewed timestamps.
        
        Returns:
            Dict mapping session_id to Unix timestamp (seconds)
        """
        return self._timestamps.copy()

    def get(self, session_id: str) -> float | None:
        """Get the last-viewed timestamp for a session.
        
        Returns:
            Unix timestamp (seconds) or None if never viewed
        """
        return self._timestamps.get(session_id)

    def mark_viewed(self, session_id: str, timestamp: float | None = None) -> float:
        """Mark a session as viewed at the given timestamp.
        
        Args:
            session_id: Session to mark as viewed
            timestamp: Unix timestamp (seconds). If None, uses current time.
            
        Returns:
            The timestamp that was set
        """
        import time
        ts = timestamp if timestamp is not None else time.time()
        self._timestamps[session_id] = ts
        self._save()
        logger.debug(f"[{session_id}] Marked as viewed at {ts}")
        return ts

    def remove(self, session_id: str) -> bool:
        """Remove a session's viewed timestamp.
        
        Called when a session is deleted.
        
        Returns:
            True if the entry existed and was removed
        """
        if session_id in self._timestamps:
            del self._timestamps[session_id]
            self._save()
            logger.info(f"[{session_id}] Removed viewed timestamp")
            return True
        return False


# Singleton instance
viewed_service = ViewedService()
