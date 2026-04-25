"""Long-lived SSE channel for events that out-live a single chat turn.

One connection per browser tab is expected. Carries MCP OAuth events,
MCP status changes, and any future cross-session notifications.

Per-turn streaming continues to live on ``/sessions/{id}/messages``.
"""

from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter, Header, Request
from sse_starlette.sse import EventSourceResponse

from copilot_console.app.services.event_bus import event_bus
from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/events", tags=["events"])


def _parse_since(since_query: int | None, last_event_id: str | None) -> int | None:
    """Resolve the replay cursor.

    The standard SSE reconnect mechanism uses the ``Last-Event-ID``
    request header. We also accept a ``?since=`` query parameter for
    explicit / scripted callers. Header wins when both are present.
    """
    if last_event_id:
        try:
            return int(last_event_id)
        except ValueError:
            return None
    return since_query


@router.get("")
async def events_stream(
    request: Request,
    since: int | None = None,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> EventSourceResponse:
    """Subscribe to the global event bus.

    On connect, replays any buffered events newer than the resolved
    cursor (Last-Event-ID header or ``?since=``), then streams live.
    SSE keepalives are sent automatically by ``sse_starlette`` via the
    ``ping`` argument so corporate proxies don't kill the connection.
    """
    cursor = _parse_since(since, last_event_id)

    async def gen() -> AsyncGenerator[dict, None]:
        async for envelope in event_bus.stream(since_id=cursor):
            # If the client disconnected, stop iterating. Without this,
            # publishers would keep enqueueing into an orphaned queue
            # until the next event triggers the cleanup in stream().
            if await request.is_disconnected():
                return
            yield {
                "id": str(envelope["id"]),
                "event": envelope["type"],
                "data": json.dumps(
                    {
                        "id": envelope["id"],
                        "type": envelope["type"],
                        "ts": envelope["ts"],
                        "sessionId": envelope.get("sessionId"),
                        "data": envelope.get("data") or {},
                    }
                ),
            }

    # ping=20 → sse_starlette emits a comment-line keepalive every 20s.
    return EventSourceResponse(gen(), ping=20)
