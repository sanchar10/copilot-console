"""Response buffer for long-running agent support.

When a user sends a message, the SDK interaction runs in a background task
that continues even if the browser disconnects. Responses are buffered here
and streamed to connected SSE clients.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)


class ResponseStatus(Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class ResponseBuffer:
    """Buffer for a single response being generated."""
    session_id: str
    status: ResponseStatus = ResponseStatus.RUNNING
    chunks: list[str] = field(default_factory=list)
    steps: list[dict] = field(default_factory=list)
    usage_info: Optional[dict] = None
    notifications: list[dict] = field(default_factory=list)
    error: Optional[str] = None
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    # Auto-naming: updated session name (set by background task if name was auto-generated)
    updated_session_name: Optional[str] = None
    # Stable SDK messageId for the most recently completed turn (if available)
    last_message_id: Optional[str] = None
    
    # For SSE consumers to wait on new data (no polling!)
    _new_data_event: asyncio.Event = field(default_factory=asyncio.Event)
    
    def add_chunk(self, content: str) -> None:
        """Add a content chunk and signal waiting consumers."""
        self.chunks.append(content)
        self._new_data_event.set()
    
    def add_step(self, step: dict) -> None:
        """Add a step and signal waiting consumers."""
        self.steps.append(step)
        self._new_data_event.set()
    
    def add_usage_info(self, usage: dict) -> None:
        """Add token usage information and signal waiting consumers."""
        self.usage_info = usage
        self._new_data_event.set()
    
    def add_notification(self, event: str, data: dict | None = None) -> None:
        """Add a pass-through notification event and signal waiting consumers."""
        payload = data or {}
        if event == "turn_done":
            msg_id = payload.get("message_id")
            if isinstance(msg_id, str) and msg_id.strip():
                self.last_message_id = msg_id
        self.notifications.append({"event": event, "data": payload})
        self._new_data_event.set()
    
    def complete(self) -> None:
        """Mark response as completed."""
        self.status = ResponseStatus.COMPLETED
        self.completed_at = datetime.now(timezone.utc)
        self._new_data_event.set()
        logger.info(f"[{self.session_id}] Response completed, {len(self.chunks)} chunks")
    
    def fail(self, error: str) -> None:
        """Mark response as failed."""
        self.status = ResponseStatus.ERROR
        self.error = error
        self.completed_at = datetime.now(timezone.utc)
        self._new_data_event.set()
        logger.error(f"[{self.session_id}] Response failed: {error}")
    
    def get_full_content(self) -> str:
        """Get the complete response content."""
        return "".join(self.chunks)
    
    def is_stale(self, max_age_seconds: int = 300) -> bool:
        """Check if buffer is stale (completed/errored and older than max_age)."""
        if self.status == ResponseStatus.RUNNING:
            return False
        if self.completed_at is None:
            return False
        age = (datetime.now(timezone.utc) - self.completed_at).total_seconds()
        return age > max_age_seconds
    
    async def wait_for_update(self, timeout: float = 30.0) -> bool:
        """Wait for new data. Returns True if signaled, False if timeout."""
        self._new_data_event.clear()
        try:
            await asyncio.wait_for(self._new_data_event.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False


class ResponseBufferManager:
    """Manages response buffers for all active sessions."""
    
    def __init__(self):
        self._buffers: dict[str, ResponseBuffer] = {}
        self._lock = asyncio.Lock()
        self._tasks: dict[str, asyncio.Task] = {}
        self._cleanup_task: asyncio.Task | None = None
        self._buffer_ttl_seconds = 300  # 5 minutes after completion
    
    def start_cleanup_task(self) -> None:
        """Start the background cleanup task."""
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            logger.info("Started buffer cleanup task")
    
    async def _cleanup_loop(self) -> None:
        """Periodically clean up stale buffers."""
        while True:
            await asyncio.sleep(60)  # Check every minute
            await self._cleanup_stale_buffers()
    
    async def _cleanup_stale_buffers(self) -> None:
        """Remove buffers that are completed/errored and older than TTL."""
        to_remove = []
        async with self._lock:
            for session_id, buffer in self._buffers.items():
                if buffer.is_stale(self._buffer_ttl_seconds):
                    to_remove.append(session_id)
        
        for session_id in to_remove:
            logger.debug(f"[{session_id}] Removing stale buffer")
            await self.remove_buffer(session_id)
    
    async def create_buffer(self, session_id: str) -> ResponseBuffer:
        """Create a new response buffer for a session."""
        async with self._lock:
            # Cancel any existing task for this session
            if session_id in self._tasks:
                self._tasks[session_id].cancel()
                del self._tasks[session_id]
            
            # Clear any existing buffer
            if session_id in self._buffers:
                del self._buffers[session_id]
            
            buffer = ResponseBuffer(session_id=session_id)
            self._buffers[session_id] = buffer
            logger.info(f"[{session_id}] Created response buffer, total buffers: {len(self._buffers)}")
            return buffer
    
    def register_task(self, session_id: str, task: asyncio.Task) -> None:
        """Register the background task for a session."""
        self._tasks[session_id] = task
    
    async def get_buffer(self, session_id: str) -> Optional[ResponseBuffer]:
        """Get the response buffer for a session."""
        async with self._lock:
            return self._buffers.get(session_id)
    
    async def remove_buffer(self, session_id: str) -> None:
        """Remove a completed buffer (cleanup)."""
        async with self._lock:
            self._buffers.pop(session_id, None)
            task = self._tasks.pop(session_id, None)
            if task and not task.done():
                task.cancel()
    
    def has_active_response(self, session_id: str) -> bool:
        """Check if there's an active (running) response for a session."""
        buffer = self._buffers.get(session_id)
        return buffer is not None and buffer.status == ResponseStatus.RUNNING
    
    def get_status(self, session_id: str) -> dict:
        """Get status of response buffer for a session."""
        buffer = self._buffers.get(session_id)
        if not buffer:
            return {"active": False}
        
        return {
            "active": buffer.status == ResponseStatus.RUNNING,
            "status": buffer.status.value,
            "chunks_count": len(buffer.chunks),
            "steps_count": len(buffer.steps),
            "error": buffer.error,
        }
    
    def get_all_active(self, include_content: bool = False, content_tail_chars: int = 500) -> list[dict]:
        """Get status of all active (running) response buffers.
        
        Returns a list of session statuses for sessions where agents are
        currently generating responses.
        
        Args:
            include_content: If True, include content preview in the response
            content_tail_chars: Number of characters from the end to include
        """
        active_sessions = []
        for session_id, buffer in self._buffers.items():
            if buffer.status == ResponseStatus.RUNNING:
                session_info = {
                    "session_id": session_id,
                    "status": buffer.status.value,
                    "chunks_count": len(buffer.chunks),
                    "steps_count": len(buffer.steps),
                    "started_at": buffer.started_at.isoformat() if buffer.started_at else None,
                }
                if include_content:
                    full_content = buffer.get_full_content()
                    session_info["content_length"] = len(full_content)
                    # Get last N characters for live tail view
                    session_info["content_tail"] = full_content[-content_tail_chars:] if len(full_content) > content_tail_chars else full_content
                    # Current step info
                    if buffer.steps:
                        session_info["current_step"] = buffer.steps[-1]
                active_sessions.append(session_info)
        return active_sessions
    
    def get_active_count(self) -> int:
        """Get count of sessions with active (running) responses."""
        return sum(1 for b in self._buffers.values() if b.status == ResponseStatus.RUNNING)


# Singleton instance
response_buffer_manager = ResponseBufferManager()
