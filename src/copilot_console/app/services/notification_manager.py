"""Notification manager for push notifications.

Handles the delayed notification logic: when an agent completes,
waits a configurable delay, then checks if the session is still
unread before sending a push notification.

Tracks sent notifications in notified.json to prevent duplicates
across server restarts.
"""

import asyncio
import json
import time
from pathlib import Path

from copilot_console.app.config import APP_HOME
from copilot_console.app.services.logging_service import get_logger
from copilot_console.app.services.push_service import push_subscription_service
from copilot_console.app.services.storage_service import storage_service
from copilot_console.app.services.viewed_service import viewed_service

logger = get_logger(__name__)

DEFAULT_NOTIFY_DELAY_SECONDS = 30
NOTIFIED_FILE = APP_HOME / "notified.json"


class NotificationManager:
    """Manages delayed push notifications for agent completions."""
    
    def __init__(self) -> None:
        self._pending_tasks: dict[str, asyncio.Task] = {}
        self._notified: dict[str, float] = {}
        self._load_notified()
    
    def _load_notified(self) -> None:
        """Load notified timestamps from disk."""
        if NOTIFIED_FILE.exists():
            try:
                with open(NOTIFIED_FILE, "r", encoding="utf-8") as f:
                    self._notified = {
                        k: float(v) for k, v in json.load(f).items()
                        if isinstance(v, (int, float))
                    }
            except Exception as e:
                logger.warning(f"Failed to load notified.json: {e}")
                self._notified = {}
    
    def _save_notified(self) -> None:
        """Save notified timestamps to disk."""
        try:
            APP_HOME.mkdir(parents=True, exist_ok=True)
            with open(NOTIFIED_FILE, "w", encoding="utf-8") as f:
                json.dump(self._notified, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save notified.json: {e}")
    
    def _mark_notified(self, session_id: str) -> None:
        """Record that a push was sent for this session."""
        self._notified[session_id] = time.time()
        self._save_notified()
    
    def _get_delay(self) -> int:
        """Get the notification delay from settings."""
        settings = storage_service.get_settings()
        return settings.get("mobile_notify_delay_seconds", DEFAULT_NOTIFY_DELAY_SECONDS)
    
    def on_agent_completed(self, session_id: str, session_name: str, preview: str = "") -> None:
        """Called when an agent finishes responding.
        
        Triggers a delayed check to see if the user has viewed the session.
        If still unread after the delay, sends a push notification.
        """
        if not push_subscription_service.get_all():
            return
        
        # Cancel any existing pending notification for this session
        existing = self._pending_tasks.get(session_id)
        if existing and not existing.done():
            existing.cancel()
        
        completion_time = time.time()
        
        try:
            loop = asyncio.get_event_loop()
            task = loop.create_task(
                self._delayed_notify(session_id, session_name, preview, completion_time)
            )
            self._pending_tasks[session_id] = task
        except RuntimeError:
            logger.warning("No event loop available for push notification scheduling")
    
    async def _delayed_notify(
        self,
        session_id: str,
        session_name: str,
        preview: str,
        completion_time: float,
    ) -> None:
        """Wait for delay, then check if notification should be sent."""
        delay = self._get_delay()
        
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            logger.debug(f"[{session_id}] Push notification cancelled")
            return
        
        # Check if already viewed
        viewed_at = viewed_service.get(session_id)
        if viewed_at is not None and viewed_at >= completion_time:
            logger.info(f"[{session_id}] Already viewed, skipping push")
            return
        
        # Check if already notified for this update
        notified_at = self._notified.get(session_id, 0)
        if notified_at >= completion_time:
            logger.info(f"[{session_id}] Already notified, skipping push")
            return
        
        # Send push
        title = session_name or f"Session {session_id[:8]}"
        body = preview[:120] if preview else "Agent has finished responding"
        
        sent = push_subscription_service.send_to_all(
            title=f"🤖 {title}",
            body=body,
            data={
                "session_id": session_id,
                "url": f"/mobile/chat/{session_id}",
            },
        )
        
        if sent > 0:
            self._mark_notified(session_id)
            logger.info(f"[{session_id}] Push sent to {sent} device(s)")
        
        self._pending_tasks.pop(session_id, None)
    
    async def check_unread_on_startup(self) -> None:
        """Check for unread sessions on server startup.
        
        Sends a summary push for sessions where updated_at > max(viewed_at, notified_at).
        """
        if not push_subscription_service.get_all():
            return
        
        try:
            from copilot_console.app.services.session_service import session_service
            sessions = await session_service.list_sessions()
        except Exception as e:
            logger.warning(f"Failed to load sessions for startup push check: {e}")
            return
        
        viewed_all = viewed_service.get_all()
        unread_names = []
        
        for session in sessions:
            sid = session.session_id
            updated_at = session.updated_at.timestamp()
            viewed_at = viewed_all.get(sid, 0)
            notified_at = self._notified.get(sid, 0)
            
            # Unread AND not yet notified for this update
            if updated_at > viewed_at and updated_at > notified_at:
                unread_names.append(session.session_name or sid[:8])
                self._notified[sid] = time.time()
        
        if unread_names:
            self._save_notified()
            count = len(unread_names)
            body = ", ".join(unread_names[:3])
            if count > 3:
                body += f" and {count - 3} more"
            
            push_subscription_service.send_to_all(
                title=f"📬 {count} unread session{'s' if count > 1 else ''}",
                body=body,
                data={"url": "/mobile"},
            )
            logger.info(f"Startup push: {count} unread sessions")
    
    def cancel_for_session(self, session_id: str) -> None:
        """Cancel pending notification for a session (e.g., when viewed)."""
        task = self._pending_tasks.pop(session_id, None)
        if task and not task.done():
            task.cancel()


# Singleton
notification_manager = NotificationManager()
