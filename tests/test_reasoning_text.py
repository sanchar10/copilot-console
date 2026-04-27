"""Tests for reasoning_text extraction from SDK assistant.message events.

Verifies that get_session_with_messages reads `reasoning_text` directly from the
SDK's AssistantMessageData (instead of re-reading events.jsonl) and that the
dedupe guard prevents double Reasoning steps if both an assistant.reasoning
event and an assistant.message.reasoning_text are present.
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from copilot_console.app.models.agent import AgentTools
from copilot_console.app.models.session import Session


def _evt(evt_type: str, data: object, evt_id: str | None = None) -> SimpleNamespace:
    """Build a fake SDK SessionEvent with .type, .data, .id, .timestamp."""
    return SimpleNamespace(
        type=SimpleNamespace(value=evt_type),
        data=data,
        id=evt_id or evt_type,
        timestamp=datetime.now(timezone.utc),
    )


def _fake_session(session_id: str = "sess-1"):
    # Resolve fresh classes at call time to survive other tests' sys.modules
    # pollution (e.g. tests/test_session_config.py drops copilot_console.app.*).
    from copilot_console.app.models.agent import AgentTools as _AgentTools
    from copilot_console.app.models.session import Session as _Session
    now = datetime.now(timezone.utc)
    return _Session(
        session_id=session_id,
        session_name="test",
        model="claude-sonnet-4.6",
        cwd="/tmp",
        mcp_servers=[],
        tools=_AgentTools(),
        system_message=None,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_reasoning_text_from_assistant_message():
    """SDK reasoning_text on assistant.message becomes the first Reasoning step."""
    from copilot_console.app.services import session_service as svc_module

    user_data = SimpleNamespace(content="hi", attachments=None)
    intent_data = SimpleNamespace(intent="planning")
    asst_data = SimpleNamespace(
        content="answer",
        message_id="m1",
        reasoning_text="why I picked this answer",
        tool_requests=None,
    )

    fake_events = [
        _evt("user.message", user_data, evt_id="u1"),
        _evt("assistant.intent", intent_data, evt_id="i1"),
        _evt("assistant.message", asst_data, evt_id="a1"),
    ]

    with patch.object(svc_module.SessionService, "get_session", new=AsyncMock(return_value=_fake_session())), \
         patch.object(svc_module.copilot_service, "get_session_messages", new=AsyncMock(return_value=fake_events)):
        result = await svc_module.session_service.get_session_with_messages("sess-1")

    assert result is not None
    assistant_msgs = [m for m in result.messages if m.role == "assistant"]
    assert len(assistant_msgs) == 1
    msg = assistant_msgs[0]
    assert msg.content == "answer"
    assert msg.steps is not None
    titles = [s.title for s in msg.steps]
    assert titles == ["Reasoning", "Intent"]
    reasoning_step = msg.steps[0]
    assert reasoning_step.detail == "why I picked this answer"


@pytest.mark.asyncio
async def test_reasoning_text_dedupe_when_assistant_reasoning_also_present():
    """If an assistant.reasoning event already added a Reasoning step, don't add another."""
    from copilot_console.app.services import session_service as svc_module

    user_data = SimpleNamespace(content="hi", attachments=None)
    reasoning_event_data = SimpleNamespace(content="reasoning from streaming event")
    asst_data = SimpleNamespace(
        content="answer",
        message_id="m1",
        reasoning_text="reasoning from final message field",
        tool_requests=None,
    )

    fake_events = [
        _evt("user.message", user_data, evt_id="u1"),
        _evt("assistant.reasoning", reasoning_event_data, evt_id="r1"),
        _evt("assistant.message", asst_data, evt_id="a1"),
    ]

    with patch.object(svc_module.SessionService, "get_session", new=AsyncMock(return_value=_fake_session())), \
         patch.object(svc_module.copilot_service, "get_session_messages", new=AsyncMock(return_value=fake_events)):
        result = await svc_module.session_service.get_session_with_messages("sess-1")

    assistant_msgs = [m for m in result.messages if m.role == "assistant"]
    assert len(assistant_msgs) == 1
    msg = assistant_msgs[0]
    reasoning_steps = [s for s in (msg.steps or []) if s.title == "Reasoning"]
    assert len(reasoning_steps) == 1
    # The first-seen Reasoning step (from assistant.reasoning event) wins
    assert reasoning_steps[0].detail == "reasoning from streaming event"


@pytest.mark.asyncio
async def test_no_reasoning_step_when_field_missing_or_blank():
    """No Reasoning step is added when reasoning_text is None or whitespace-only."""
    from copilot_console.app.services import session_service as svc_module

    user_data = SimpleNamespace(content="hi", attachments=None)
    asst_blank = SimpleNamespace(
        content="answer",
        message_id="m1",
        reasoning_text="   ",
        tool_requests=None,
    )

    fake_events = [
        _evt("user.message", user_data, evt_id="u1"),
        _evt("assistant.message", asst_blank, evt_id="a1"),
    ]

    with patch.object(svc_module.SessionService, "get_session", new=AsyncMock(return_value=_fake_session())), \
         patch.object(svc_module.copilot_service, "get_session_messages", new=AsyncMock(return_value=fake_events)):
        result = await svc_module.session_service.get_session_with_messages("sess-1")

    assistant_msgs = [m for m in result.messages if m.role == "assistant"]
    assert len(assistant_msgs) == 1
    assert assistant_msgs[0].steps is None
