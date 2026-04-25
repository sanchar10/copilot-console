"""SDK event stream processor.

Translates SDK session events into SSE queue entries. The ``on_event``
callback is registered with ``session.on(processor.on_event)`` and converts
raw SDK events (deltas, tool calls, compaction, usage, etc.) into the
dict-based SSE events consumed by the frontend.
"""

import asyncio
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


class EventProcessor:
    """Translates SDK session events into SSE queue entries."""

    def __init__(
        self,
        session_id: str,
        event_queue: asyncio.Queue,
        done: asyncio.Event,
        touch_callback: Callable[[], None],
        post_turn_hook: Callable[[], None] | None = None,
    ):
        self.session_id = session_id
        self.event_queue = event_queue
        self.done = done
        self.touch_callback = touch_callback
        # Optional sync hook called after each ``assistant.turn_end`` and on
        # ``session.error``. Used by the OAuth coordinator to lazily discover
        # MCP servers in ``needs-auth`` and trigger the sign-in flow without
        # awaiting from inside this synchronous handler.
        self.post_turn_hook = post_turn_hook
        self.full_response: list[str] = []
        self.reasoning_buffer: list[str] = []
        self.pending_turn_msg_id: str | None = None
        self.pending_turn_event_id: str | None = None
        self.pending_turn_timestamp: str | None = None
        self.compacting = False
        self.idle_received = False
        self.last_token_limit: int | None = None

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------

    @staticmethod
    def clean_text(text: str) -> str:
        if not text:
            return text
        text = text.replace('\\r\\n', '\n').replace('\\n', '\n').replace('\\r', '')
        text = text.replace('\r\n', '\n').replace('\r', '')
        return text

    @staticmethod
    def get_text(data: object) -> str:
        if data is None:
            return ""
        for attr in ("delta_content", "content", "text", "delta"):
            try:
                value = getattr(data, attr, None)
            except Exception:
                value = None
            if isinstance(value, str) and value:
                return value
        if isinstance(data, dict):
            for key in ("delta_content", "content", "text", "delta"):
                value = data.get(key)
                if isinstance(value, str) and value:
                    return value
        return ""

    @staticmethod
    def format_tool_prompt(data: object) -> str:
        question = getattr(data, "question", None)
        if not isinstance(question, str) or not question.strip():
            question = None

        choices = getattr(data, "choices", None)
        if isinstance(choices, (list, tuple)):
            choice_lines = [f"- {c}" for c in choices if isinstance(c, str) and c]
        else:
            choice_lines = []

        if question and choice_lines:
            return "".join([
                question.strip(),
                "\n\nChoices:\n",
                "\n".join(choice_lines),
            ])
        if question:
            return question.strip()

        tool_requests = getattr(data, "tool_requests", None) or getattr(data, "toolRequests", None)
        if tool_requests:
            return ""
        if isinstance(data, dict) and (data.get("tool_requests") or data.get("toolRequests")):
            return ""

        return ""

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _enqueue_step(self, title: str, detail: str | None = None) -> None:
        payload: dict = {"title": title}
        if detail and detail.strip():
            payload["detail"] = detail
        _safe_enqueue(self.event_queue, {"event": "step", "data": payload})

    def terminate_stream(self) -> None:
        """Push sentinel to end the generator loop.

        Also fires the post-turn hook so MCP needs-auth detection still runs
        when a turn is aborted before ``assistant.turn_end`` (e.g. network
        drop, client disconnect). Hook is idempotent — if turn_end already
        fired the hook, this is a no-op-ish second call (coordinator's
        _maybe_start is itself idempotent).
        """
        _safe_enqueue(self.event_queue, None)
        self.done.set()
        self._fire_post_turn_hook()

    def _fire_post_turn_hook(self) -> None:
        """Invoke the optional post-turn hook, swallowing errors."""
        if self.post_turn_hook is None:
            return
        try:
            self.post_turn_hook()
        except Exception as e:
            logger.debug(f"[{self.session_id}] post_turn_hook raised: {e}")

    # ------------------------------------------------------------------
    # Main event handler
    # ------------------------------------------------------------------

    def on_event(self, event) -> None:
        """Main event handler — register with ``session.on(processor.on_event)``."""
        # Keep session alive during long-running operations
        self.touch_callback()

        event_type = event.type.value if hasattr(event.type, "value") else str(event.type)
        data = getattr(event, "data", None)

        if event_type == "assistant.message_delta":
            delta = self.get_text(data)
            if delta:
                self.full_response.append(delta)
                _safe_enqueue(self.event_queue, {"event": "delta", "data": {"content": delta}})

        elif event_type == "assistant.message":
            if not self.full_response:
                content = self.get_text(data)
                if not content.strip():
                    content = self.format_tool_prompt(data)
                if content.strip():
                    self.full_response.append(content)
                    _safe_enqueue(self.event_queue, {"event": "delta", "data": {"content": content}})

            if self.full_response and data:
                msg_id = getattr(data, "message_id", None) or getattr(data, "id", None)
                if not msg_id and isinstance(data, dict):
                    msg_id = data.get("message_id") or data.get("id")
                self.pending_turn_msg_id = msg_id
                # Capture event-level ID and timestamp for truncate/fork support
                evt_id = getattr(event, "id", None)
                self.pending_turn_event_id = str(evt_id) if evt_id else None
                evt_ts = getattr(event, "timestamp", None)
                self.pending_turn_timestamp = evt_ts.isoformat() if evt_ts else None
                logger.debug(f"[{self.session_id}] assistant.message — captured msg_id={msg_id}, event_id={self.pending_turn_event_id}, deferring turn_done to turn_end")

        elif event_type == "assistant.reasoning_delta":
            text = self.get_text(data)
            if text:
                self.reasoning_buffer.append(text)

        elif event_type == "assistant.reasoning":
            if self.reasoning_buffer:
                full_reasoning = "".join(self.reasoning_buffer)
                self.reasoning_buffer.clear()
            else:
                full_reasoning = self.get_text(data)
            if full_reasoning.strip():
                self._enqueue_step("Reasoning", full_reasoning)

        elif event_type == "assistant.intent":
            intent = getattr(data, "intent", None)
            if isinstance(intent, str) and intent.strip():
                self._enqueue_step("Intent", intent)

        elif event_type == "assistant.turn_end":
            if self.full_response or self.pending_turn_msg_id:
                msg_id = self.pending_turn_msg_id
                evt_id = getattr(self, "pending_turn_event_id", None)
                evt_ts = getattr(self, "pending_turn_timestamp", None)
                logger.debug(f"[{self.session_id}] turn_done msg_id={msg_id}, event_id={evt_id} (from turn_end)")
                turn_data: dict = {"messageId": msg_id}
                if evt_id:
                    turn_data["eventId"] = evt_id
                if evt_ts:
                    turn_data["timestamp"] = evt_ts
                _safe_enqueue(self.event_queue, {"event": "turn_done", "data": turn_data})
            self.full_response.clear()
            self.reasoning_buffer.clear()
            self.pending_turn_msg_id = None
            self.pending_turn_event_id = None
            self.pending_turn_timestamp = None
            self._fire_post_turn_hook()

        elif event_type == "tool.execution_start":
            tool = getattr(data, "tool_name", None) or getattr(data, "name", None)
            tool_call_id = getattr(data, "tool_call_id", None)
            args = getattr(data, "arguments", None) or getattr(data, "input", None)
            title = f"Tool: {tool}" if tool else "Tool"
            detail_parts: list[str] = []
            if tool_call_id:
                detail_parts.append(f"id={tool_call_id}")
            if args:
                try:
                    import json
                    if isinstance(args, str):
                        detail_parts.append(f"Input: {self.clean_text(args[:500])}")
                    elif isinstance(args, dict):
                        detail_parts.append(f"Input: {json.dumps(args, indent=2)[:500]}")
                    else:
                        detail_parts.append(f"Input: {self.clean_text(str(args)[:500])}")
                except Exception:
                    detail_parts.append(f"Input: {self.clean_text(str(args)[:500])}")
            detail = "\n".join(detail_parts) if detail_parts else None
            self._enqueue_step(title, detail)

        elif event_type == "tool.execution_progress":
            msg = getattr(data, "progress_message", None)
            if isinstance(msg, str) and msg.strip():
                self._enqueue_step("Tool progress", self.clean_text(msg))

        elif event_type == "tool.execution_partial_result":
            pass

        elif event_type == "tool.execution_complete":
            tool = getattr(data, "tool_name", None) or getattr(data, "name", None)
            tool_call_id = getattr(data, "tool_call_id", None)
            result = getattr(data, "result", None) or getattr(data, "output", None)
            title = f"Tool done: {tool}" if tool else "Tool done"
            detail_parts: list[str] = []
            if tool_call_id:
                detail_parts.append(f"id={tool_call_id}")
            if result:
                try:
                    result_str = str(result)[:1000]
                    if result_str.startswith("Result(content="):
                        import ast
                        try:
                            inner = result_str[len("Result(content="):-1]
                            parsed = ast.literal_eval(inner)
                            if isinstance(parsed, str):
                                result_str = parsed[:1000]
                        except Exception:
                            pass
                    detail_parts.append(f"Output: {self.clean_text(result_str)}")
                except Exception:
                    pass
            detail = "\n".join(detail_parts) if detail_parts else None
            self._enqueue_step(title, detail)

        elif event_type == "session.compaction_start":
            self.compacting = True
            self._enqueue_step("⟳ Compacting context", "Background compaction started — summarizing older messages to free context space. You can continue chatting.")
            logger.debug(f"[{self.session_id}] Compaction started")

        elif event_type == "session.compaction_complete":
            self.compacting = False
            success = getattr(data, "success", None)
            tokens_removed = getattr(data, "tokens_removed", None)
            pre_tokens = getattr(data, "pre_compaction_tokens", None)
            post_tokens = getattr(data, "post_compaction_tokens", None)
            msgs_removed = getattr(data, "messages_removed", None)
            checkpoint = getattr(data, "checkpoint_number", None)

            if success:
                parts = ["Compaction completed successfully."]
                if tokens_removed is not None and pre_tokens:
                    pct = round((tokens_removed / pre_tokens) * 100)
                    parts.append(f"Freed {int(tokens_removed):,} tokens ({pct}% of context).")
                if post_tokens is not None:
                    parts.append(f"Context now: {int(post_tokens):,} tokens.")
                if msgs_removed is not None:
                    parts.append(f"Messages summarized: {int(msgs_removed)}.")
                if checkpoint is not None:
                    parts.append(f"Checkpoint #{int(checkpoint)} saved.")
                self._enqueue_step("✓ Context compacted", " ".join(parts))
                if post_tokens is not None and self.last_token_limit is not None:
                    _safe_enqueue(self.event_queue, {
                        "event": "usage_info",
                        "data": {
                            "tokenLimit": self.last_token_limit,
                            "currentTokens": post_tokens,
                            "messagesLength": 0,
                        },
                    })
            else:
                error = getattr(data, "error", None)
                self._enqueue_step("✗ Compaction failed", str(error) if error else "Compaction did not succeed.")
            logger.debug(f"[{self.session_id}] Compaction complete: success={success}, tokens_removed={tokens_removed}")

            if self.idle_received:
                self.terminate_stream()

        elif event_type == "session.error":
            msg = getattr(data, "message", None)
            if msg:
                self._enqueue_step("Session error", str(msg))
            self._fire_post_turn_hook()

        elif event_type == "session.usage_info":
            token_limit = getattr(data, "token_limit", None)
            current_tokens = getattr(data, "current_tokens", None)
            messages_length = getattr(data, "messages_length", None)
            if token_limit:
                self.last_token_limit = token_limit
            if token_limit and current_tokens is not None:
                _safe_enqueue(self.event_queue, {
                    "event": "usage_info",
                    "data": {
                        "tokenLimit": token_limit,
                        "currentTokens": current_tokens,
                        "messagesLength": messages_length,
                    },
                })

        elif event_type == "pending_messages.modified":
            _safe_enqueue(self.event_queue, {"event": "pending_messages", "data": {}})

        elif event_type == "session.title_changed":
            title = getattr(event.data, "title", None)
            if title and isinstance(title, str) and title.strip():
                _safe_enqueue(self.event_queue, {
                    "event": "title_changed",
                    "data": {"title": title.strip()},
                })

        elif event_type == "session.mode_changed":
            new_mode = getattr(data, "new_mode", None)
            previous_mode = getattr(data, "previous_mode", None)
            if new_mode:
                mode_val = new_mode.value if hasattr(new_mode, "value") else str(new_mode)
                prev_val = previous_mode.value if hasattr(previous_mode, "value") else str(previous_mode) if previous_mode else None
                _safe_enqueue(self.event_queue, {
                    "event": "mode_changed",
                    "data": {"mode": mode_val, "previous_mode": prev_val},
                })
                logger.debug(f"[{self.session_id}] Mode changed: {prev_val} → {mode_val}")

        elif event_type == "session.idle":
            self.idle_received = True
            if self.compacting:
                logger.debug(f"[{self.session_id}] session.idle while compacting — waiting for compaction_complete")
            else:
                self.terminate_stream()
