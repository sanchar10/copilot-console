"""Elicitation and user-input request management.

Manages interactive request/response cycles (SDK elicitation + ask_user tool).
Owns the pending futures dict and provides handler factories for session creation.
"""

import asyncio
import uuid
from typing import Callable

from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)


def _safe_enqueue(queue: asyncio.Queue, item: dict | None) -> None:
    """Put *item* on *queue*, dropping the oldest non-sentinel event if full."""
    try:
        queue.put_nowait(item)
    except asyncio.QueueFull:
        try:
            dropped = queue.get_nowait()
            if dropped is None:
                queue.put_nowait(dropped)
        except asyncio.QueueEmpty:
            pass
        try:
            queue.put_nowait(item)
        except asyncio.QueueFull:
            pass


class ElicitationManager:
    """Manages pending elicitation/ask_user futures for all sessions."""

    def __init__(self) -> None:
        # (session_id, request_id) → asyncio.Future
        self._pending: dict[tuple[str, str], asyncio.Future] = {}

    def make_elicitation_handler(self, session_id: str, get_client: Callable) -> Callable:
        """Create an elicitation handler for a session.

        The handler is called by the SDK when the agent needs structured user input
        (e.g., ask_user tool, MCP elicitation). It pushes the request to the SSE
        stream and waits for the user to respond via the elicitation-response endpoint.

        Args:
            session_id: The session this handler belongs to.
            get_client: Callback ``(session_id) -> SessionClient | None`` to
                        look up the active client without importing CopilotService.
        """
        loop = asyncio.get_event_loop()

        async def handle_elicitation(context: dict) -> dict:
            request_id = str(uuid.uuid4())
            future: asyncio.Future = loop.create_future()

            key = (session_id, request_id)
            self._pending[key] = future

            client = get_client(session_id)
            if client:
                client.touch()

            schema = context.get("requestedSchema", {})
            elicitation_data = {
                "request_id": request_id,
                "message": context.get("message", ""),
                "schema": schema if isinstance(schema, dict) else (schema.to_dict() if hasattr(schema, "to_dict") else {}),
                "source": context.get("elicitationSource", ""),
            }
            evt = {"event": "elicitation", "data": elicitation_data}

            if client and client.event_queue:
                _safe_enqueue(client.event_queue, evt)
            logger.debug(f"[{session_id}] Elicitation requested: {request_id}")

            try:
                result = await future
                logger.debug(f"[{session_id}] Elicitation resolved: {request_id} action={result.get('action')}")
                return result
            except asyncio.CancelledError:
                logger.debug(f"[{session_id}] Elicitation cancelled: {request_id}")
                return {"action": "cancel"}
            finally:
                self._pending.pop(key, None)
                if client:
                    client.touch()

        return handle_elicitation

    def make_user_input_handler(self, session_id: str, get_client: Callable) -> Callable:
        """Create a user input handler for a session.

        The handler is called by the SDK when the agent uses the ask_user tool.
        It pushes an ask_user event to the SSE stream and waits for the user
        to respond via the user-input-response endpoint.

        Args:
            session_id: The session this handler belongs to.
            get_client: Callback ``(session_id) -> SessionClient | None``.
        """
        loop = asyncio.get_event_loop()

        async def handle_user_input(request: dict, invocation: dict) -> dict:
            request_id = str(uuid.uuid4())
            future: asyncio.Future = loop.create_future()

            key = (session_id, request_id)
            self._pending[key] = future

            client = get_client(session_id)
            if client:
                client.touch()

            ask_data = {
                "request_id": request_id,
                "question": request.get("question", ""),
                "choices": request.get("choices"),
                "allowFreeform": request.get("allowFreeform", True),
            }
            evt = {"event": "ask_user", "data": ask_data}

            if client and client.event_queue:
                _safe_enqueue(client.event_queue, evt)
            logger.debug(f"[{session_id}] ask_user requested: {request_id} question={ask_data['question'][:80]}")

            try:
                result = await future
                logger.debug(f"[{session_id}] ask_user resolved: {request_id}")
                return result
            except asyncio.CancelledError:
                logger.debug(f"[{session_id}] ask_user cancelled: {request_id}")
                return {"answer": "User cancelled the request.", "wasFreeform": True}
            finally:
                self._pending.pop(key, None)
                if client:
                    client.touch()

        return handle_user_input

    def resolve(self, session_id: str, request_id: str, result: dict) -> bool:
        """Resolve a pending elicitation with the user's response.

        Returns True if resolved, False if not found (already resolved or expired).
        """
        key = (session_id, request_id)
        future = self._pending.pop(key, None)
        if future is None or future.done():
            return False
        try:
            future.set_result(result)
        except asyncio.InvalidStateError:
            return False
        logger.debug(f"[{session_id}] Elicitation response delivered: {request_id}")
        return True

    def cancel(self, session_id: str, request_id: str) -> bool:
        """Cancel a specific pending elicitation/ask_user Future.

        Returns True if cancelled, False if not found or already done.
        """
        key = (session_id, request_id)
        future = self._pending.get(key)
        if future and not future.done():
            future.cancel()
            return True
        return False

    def cancel_all(self, session_id: str) -> int:
        """Cancel all pending elicitations for a session (on disconnect/destroy)."""
        cancelled = 0
        to_remove = [k for k in self._pending if k[0] == session_id]
        for key in to_remove:
            future = self._pending.pop(key, None)
            if future and not future.done():
                future.cancel()
                cancelled += 1
        if cancelled:
            logger.debug(f"[{session_id}] Cancelled {cancelled} pending elicitation(s)")
        return cancelled
