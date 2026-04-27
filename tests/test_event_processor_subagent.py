"""Unit tests for sub-agent step events emitted by EventProcessor.

The SDK fires ``subagent.started`` / ``subagent.completed`` / ``subagent.failed``
during a turn when the lead agent delegates work to a child agent. We surface
each as an inline ``step`` event whose title uses prefixes that ``InputBox.tsx``
already recognizes ("🤖 Agent:", "✨ Agent:", "✗ Agent:") so they render as
system messages in the chat thread alongside compaction notices.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from copilot_console.app.services.event_processor import EventProcessor


def _make_processor() -> tuple[EventProcessor, asyncio.Queue]:
    queue: asyncio.Queue = asyncio.Queue(maxsize=64)
    proc = EventProcessor(
        session_id="s-test",
        event_queue=queue,
        done=asyncio.Event(),
        touch_callback=lambda: None,
    )
    return proc, queue


def _make_event(type_value: str, **data_fields):
    """Mimic the SDK's event shape: ``event.type.value`` + ``event.data``."""
    return SimpleNamespace(
        type=SimpleNamespace(value=type_value),
        data=SimpleNamespace(**data_fields),
    )


def _drain_steps(queue: asyncio.Queue) -> list[dict]:
    out: list[dict] = []
    while True:
        try:
            item = queue.get_nowait()
        except asyncio.QueueEmpty:
            break
        if item and item.get("event") == "step":
            out.append(item["data"])
    return out


def test_subagent_started_emits_step_with_display_name_and_description():
    proc, queue = _make_processor()
    evt = _make_event(
        "subagent.started",
        agent_display_name="Frontend Dev",
        agent_name="frontend-dev",
        agent_description="Builds React UIs with Tailwind",
        tool_call_id="tc-1",
    )

    proc.on_event(evt)

    steps = _drain_steps(queue)
    assert steps == [{"title": "🤖 Agent: Frontend Dev", "detail": "Builds React UIs with Tailwind"}]


def test_subagent_started_falls_back_to_agent_name_when_display_name_missing():
    proc, queue = _make_processor()
    evt = _make_event(
        "subagent.started",
        agent_display_name="",
        agent_name="frontend-dev",
        agent_description="",
        tool_call_id="tc-1",
    )

    proc.on_event(evt)

    steps = _drain_steps(queue)
    # Empty description must NOT add a "detail" key (mirrors compaction behaviour).
    assert steps == [{"title": "🤖 Agent: frontend-dev"}]


def test_subagent_completed_emits_step_without_detail():
    proc, queue = _make_processor()
    evt = _make_event(
        "subagent.completed",
        agent_display_name="Frontend Dev",
        agent_name="frontend-dev",
        tool_call_id="tc-1",
    )

    proc.on_event(evt)

    steps = _drain_steps(queue)
    assert steps == [{"title": "✨ Agent: Frontend Dev completed"}]


def test_subagent_failed_includes_error_detail():
    proc, queue = _make_processor()
    evt = _make_event(
        "subagent.failed",
        agent_display_name="Frontend Dev",
        agent_name="frontend-dev",
        error="timeout after 60s",
        tool_call_id="tc-1",
    )

    proc.on_event(evt)

    steps = _drain_steps(queue)
    assert steps == [{"title": "✗ Agent: Frontend Dev failed", "detail": "timeout after 60s"}]


def test_subagent_failed_without_error_omits_detail():
    proc, queue = _make_processor()
    evt = _make_event(
        "subagent.failed",
        agent_display_name="Frontend Dev",
        agent_name="frontend-dev",
        tool_call_id="tc-1",
    )

    proc.on_event(evt)

    steps = _drain_steps(queue)
    assert steps == [{"title": "✗ Agent: Frontend Dev failed"}]


def test_subagent_titles_use_prefixes_recognized_by_inputbox():
    """InputBox.tsx routes step titles starting with these prefixes to the
    chat thread as system messages. If we change the prefixes here without
    updating InputBox.tsx, sub-agent indicators fall back to the transient
    streaming-step area instead — invisible after the turn ends.
    """
    proc, queue = _make_processor()
    proc.on_event(_make_event("subagent.started", agent_display_name="X",
                              agent_name="x", agent_description="", tool_call_id="t"))
    proc.on_event(_make_event("subagent.completed", agent_display_name="X",
                              agent_name="x", tool_call_id="t"))
    proc.on_event(_make_event("subagent.failed", agent_display_name="X",
                              agent_name="x", tool_call_id="t"))

    steps = _drain_steps(queue)
    assert steps[0]["title"].startswith("🤖 Agent:")
    assert steps[1]["title"].startswith("✨ Agent:")
    assert steps[2]["title"].startswith("✗ Agent")
