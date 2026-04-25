"""Global in-process event bus for long-lived SSE notifications.

Carries events that out-live a single chat turn — primarily MCP OAuth
(`mcp_oauth_required` / `mcp_oauth_completed` / `mcp_oauth_failed`) and
MCP server status changes. Anything that is per-turn and dies with the
turn stays on the per-turn ``/sessions/{id}/messages`` stream; anything
that needs to survive turn boundaries goes here.

Design:
- Single in-memory pub/sub. Each subscriber owns one ``asyncio.Queue``.
- Publishers call ``bus.publish(...)`` synchronously; fan-out is
  non-blocking (``put_nowait`` + drop-with-warn for slow subscribers).
- A bounded ring buffer holds recent events so a freshly-(re)connected
  subscriber can replay events it missed via ``?since=<id>``.
- If a client's ``since`` is older than the buffer's oldest entry we
  emit a synthetic ``replay_gap`` event so the client knows to refresh
  state from authoritative sources.

Event shape::

    {
        "id":        int,        # monotonic, assigned by the bus
        "type":      str,        # e.g. "mcp_oauth_required"
        "ts":        float,      # epoch seconds
        "sessionId": str | None, # optional — present only when scoped
        "data":      dict,       # event-specific payload
    }

This module is single-process. If we ever scale to multiple workers,
swap the in-memory bus for Redis pub/sub or similar — the ``publish`` /
``subscribe`` API stays the same.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Any, AsyncIterator
from uuid import uuid4

from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)

# Ring buffer size. ~500 events covers minutes of activity even under
# heavy MCP churn — more than enough for a brief reconnect window.
RING_BUFFER_SIZE = 500

# Per-subscriber queue cap. If a subscriber falls this far behind we
# drop new events (and log a warning) rather than blocking the publisher.
SUBSCRIBER_QUEUE_MAX = 256


class EventBus:
    """In-process pub/sub with a small replay buffer."""

    def __init__(self) -> None:
        self._next_id: int = 1
        self._buffer: deque[dict[str, Any]] = deque(maxlen=RING_BUFFER_SIZE)
        # Dict so we can iterate without a snapshot copy on every publish.
        self._subscribers: dict[str, asyncio.Queue[dict[str, Any]]] = {}
        self._lock = asyncio.Lock()

    # ----- publisher -----

    def publish(
        self,
        event_type: str,
        data: dict[str, Any] | None = None,
        *,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """Publish an event to all subscribers and the replay buffer.

        Sync — safe to call from inside SDK callbacks. Returns the
        envelope dict (useful for tests and immediate logging).
        """
        envelope: dict[str, Any] = {
            "id": self._next_id,
            "type": event_type,
            "ts": time.time(),
            "sessionId": session_id,
            "data": data or {},
        }
        self._next_id += 1
        self._buffer.append(envelope)

        # Fan-out. Tolerate slow / dead subscribers — never block the
        # publisher, never let one bad subscriber starve the others.
        slow: list[str] = []
        for sub_id, queue in self._subscribers.items():
            try:
                queue.put_nowait(envelope)
            except asyncio.QueueFull:
                slow.append(sub_id)
        for sub_id in slow:
            logger.warning(
                f"event_bus: subscriber {sub_id} queue full — dropped event "
                f"id={envelope['id']} type={event_type}"
            )
        return envelope

    # ----- subscriber lifecycle -----

    async def subscribe(self) -> tuple[str, asyncio.Queue[dict[str, Any]]]:
        """Register a new subscriber. Returns (id, queue)."""
        sub_id = uuid4().hex[:8]
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_MAX)
        async with self._lock:
            self._subscribers[sub_id] = queue
        logger.info(
            f"event_bus: subscriber {sub_id} connected (total={len(self._subscribers)})"
        )
        return sub_id, queue

    async def unsubscribe(self, sub_id: str) -> None:
        async with self._lock:
            self._subscribers.pop(sub_id, None)
        logger.info(
            f"event_bus: subscriber {sub_id} disconnected (total={len(self._subscribers)})"
        )

    # ----- replay -----

    def replay_since(self, since_id: int) -> list[dict[str, Any]]:
        """Return buffered events with id > ``since_id``.

        If ``since_id`` is older than the oldest buffered event, the
        first item in the returned list is a synthetic ``replay_gap``
        envelope so the client can refresh state.
        """
        if not self._buffer:
            return []
        oldest_id = self._buffer[0]["id"]
        # If the client is fully caught up, nothing to do.
        latest_id = self._buffer[-1]["id"]
        if since_id >= latest_id:
            return []
        if since_id < oldest_id - 1:
            gap = {
                "id": since_id,  # so client's lastEventId stays sane
                "type": "replay_gap",
                "ts": time.time(),
                "sessionId": None,
                "data": {
                    "lostFromId": since_id + 1,
                    "lostUntilId": oldest_id - 1,
                },
            }
            tail = [e for e in self._buffer if e["id"] > since_id]
            return [gap, *tail]
        return [e for e in self._buffer if e["id"] > since_id]

    # ----- consumer helper -----

    async def stream(
        self, since_id: int | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        """Async generator yielding replay (if any) then live events.

        Caller is responsible for ``unsubscribe``-ing — typically in a
        ``finally`` block in the SSE route.
        """
        sub_id, queue = await self.subscribe()
        try:
            if since_id is not None:
                for ev in self.replay_since(since_id):
                    yield ev
            while True:
                ev = await queue.get()
                yield ev
        finally:
            await self.unsubscribe(sub_id)

    # ----- introspection (mostly for tests) -----

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    @property
    def buffered_count(self) -> int:
        return len(self._buffer)


# Module-level singleton. Routers and services import this directly.
event_bus = EventBus()
