"""Tests for Phase 5 kick_compact / _run_compact + SessionClient compact bridge.

The Phase 5 design replaces the per-turn-SSE-coupled compact lifecycle with a
fire-and-forget RPC whose events flow through the always-on global event bus.
These tests pin down the contract:

* kick_compact is idempotent (one task per session at a time).
* The in-flight task field is identity-cleared in finally (no clobbering newer
  tasks).
* SDK ``compaction_start`` / ``compaction_complete`` events are bridged to
  ``session.compaction`` envelopes on the global event_bus.
* The bridge unsubscribes on SessionClient.stop().
* RPC failure synthesizes a ``session.compaction`` ``phase=complete,
  success=False`` event so the UI doesn't get stuck on "compacting…".
* RPC success publishes ``session.usage_info`` with camelCase fields.
* In-flight compact task is cancelled by SessionClient.stop().
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest


def _fresh_config(monkeypatch, tmp_path: Path):
    agent_home = tmp_path / "home"
    sessions_dir = agent_home / "sessions"
    settings_file = agent_home / "settings.json"
    metadata_file = agent_home / "metadata.json"
    agent_home.mkdir(parents=True, exist_ok=True)

    for mod in list(sys.modules):
        if mod.startswith("copilot_console.app"):
            sys.modules.pop(mod, None)

    monkeypatch.setenv("copilot_console_HOME", str(agent_home))

    import copilot_console.app.config as cfg
    monkeypatch.setattr(cfg, "APP_HOME", agent_home)
    monkeypatch.setattr(cfg, "SESSIONS_DIR", sessions_dir)
    monkeypatch.setattr(cfg, "SETTINGS_FILE", settings_file)
    monkeypatch.setattr(cfg, "METADATA_FILE", metadata_file)
    return cfg


def _make_service(monkeypatch, tmp_path):
    _fresh_config(monkeypatch, tmp_path)
    from copilot_console.app.services.copilot_service import CopilotService
    return CopilotService()


def _make_client_with_session(svc, session_id: str = "s1", *,
                              compact_result=None,
                              compact_side_effect=None):
    """Register a fake SessionClient under svc with a stub session.rpc.history.compact."""
    from copilot_console.app.services.session_client import SessionClient

    client = SessionClient(session_id=session_id, cwd="/tmp")
    fake_session = MagicMock()
    if compact_side_effect is not None:
        fake_session.rpc.history.compact = AsyncMock(side_effect=compact_side_effect)
    else:
        fake_session.rpc.history.compact = AsyncMock(return_value=compact_result)
    client.session = fake_session
    svc._session_clients[session_id] = client
    return client, fake_session


def _drain_bus_events():
    """Return all dict envelopes accumulated on the global event_bus buffer."""
    from copilot_console.app.services.event_bus import event_bus
    return list(event_bus._buffer)


@pytest.fixture
def reset_event_bus():
    """Snapshot then restore event_bus buffer so tests don't bleed into each other."""
    from copilot_console.app.services.event_bus import event_bus
    snapshot = list(event_bus._buffer)
    yield
    try:
        event_bus._buffer.clear()
        event_bus._buffer.extend(snapshot)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# kick_compact behavior
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_kick_compact_no_session_returns_status(monkeypatch, tmp_path):
    svc = _make_service(monkeypatch, tmp_path)
    result = await svc.kick_compact("missing")
    assert result == {"status": "no_session"}


@pytest.mark.asyncio
async def test_kick_compact_idempotent_while_in_flight(monkeypatch, tmp_path, reset_event_bus):
    svc = _make_service(monkeypatch, tmp_path)

    gate = asyncio.Event()

    async def slow_compact():
        await gate.wait()
        return SimpleNamespace(context_window=SimpleNamespace(
            token_limit=200000, current_tokens=1000, messages_length=5,
        ))

    client, _ = _make_client_with_session(svc, compact_side_effect=slow_compact)

    first = await svc.kick_compact("s1")
    assert first == {"status": "kicked"}
    assert client._compact_task is not None
    assert not client._compact_task.done()

    second = await svc.kick_compact("s1")
    assert second == {"status": "already_running"}

    # Let the in-flight task complete so we can confirm a fresh kick is then
    # accepted (proves the identity-pop in finally cleared the field).
    gate.set()
    await client._compact_task
    assert client._compact_task is None

    third = await svc.kick_compact("s1")
    assert third == {"status": "kicked"}
    await client._compact_task


@pytest.mark.asyncio
async def test_run_compact_publishes_usage_info_on_success(monkeypatch, tmp_path, reset_event_bus):
    svc = _make_service(monkeypatch, tmp_path)
    result = SimpleNamespace(context_window=SimpleNamespace(
        token_limit=128000, current_tokens=2048, messages_length=12,
    ))
    client, fake_session = _make_client_with_session(svc, compact_result=result)

    await svc.kick_compact("s1")
    await client._compact_task  # wait for completion

    fake_session.rpc.history.compact.assert_awaited_once()
    events = _drain_bus_events()
    usage = [e for e in events if e.get("type") == "session.usage_info"]
    assert usage, f"expected a session.usage_info event, got: {[e.get('type') for e in events]}"
    assert usage[-1]["data"] == {"tokenLimit": 128000, "currentTokens": 2048, "messagesLength": 12}
    assert usage[-1]["sessionId"] == "s1"


@pytest.mark.asyncio
async def test_run_compact_synthesizes_failure_event_on_rpc_raise(monkeypatch, tmp_path, reset_event_bus):
    svc = _make_service(monkeypatch, tmp_path)

    async def boom():
        raise RuntimeError("transport closed")

    client, _ = _make_client_with_session(svc, compact_side_effect=boom)

    await svc.kick_compact("s1")
    await client._compact_task  # finally clears _compact_task

    events = _drain_bus_events()
    failures = [e for e in events if e.get("type") == "session.compaction"]
    assert failures, "expected a synthesized session.compaction failure event"
    data = failures[-1]["data"]
    assert data["phase"] == "complete"
    assert data["success"] is False
    assert "transport closed" in data.get("error", "")


@pytest.mark.asyncio
async def test_run_compact_clears_task_field_on_success(monkeypatch, tmp_path, reset_event_bus):
    svc = _make_service(monkeypatch, tmp_path)
    client, _ = _make_client_with_session(
        svc, compact_result=SimpleNamespace(context_window=None),
    )
    await svc.kick_compact("s1")
    await client._compact_task
    assert client._compact_task is None


# ---------------------------------------------------------------------------
# SessionClient compact bridge
# ---------------------------------------------------------------------------

class _FakeEventType:
    def __init__(self, value: str):
        self.value = value


def _make_sdk_event(event_type: str, **data):
    return SimpleNamespace(
        type=_FakeEventType(event_type),
        data=SimpleNamespace(**data) if data else None,
    )


@pytest.mark.asyncio
async def test_compact_bridge_publishes_start_and_complete(monkeypatch, tmp_path, reset_event_bus):
    _fresh_config(monkeypatch, tmp_path)
    from copilot_console.app.services.session_client import SessionClient

    fake_session = MagicMock()
    listener_holder = {}

    def _on(handler):
        listener_holder["fn"] = handler
        return lambda: None

    fake_session.on = _on

    client = SessionClient(session_id="bridge-1", cwd="/tmp")
    client.session = fake_session
    client._register_compact_bridge()

    listener_holder["fn"](_make_sdk_event("session.compaction_start"))
    listener_holder["fn"](_make_sdk_event(
        "session.compaction_complete",
        success=True, error=None,
        tokens_removed=500, messages_removed=4,
        pre_compaction_tokens=2000, post_compaction_tokens=1500,
        checkpoint_number=3,
    ))

    events = _drain_bus_events()
    compactions = [e for e in events
                   if e.get("type") == "session.compaction" and e.get("sessionId") == "bridge-1"]
    assert len(compactions) == 2
    start_data = compactions[0]["data"]
    complete_data = compactions[1]["data"]
    assert start_data == {"phase": "start"}
    assert complete_data["phase"] == "complete"
    assert complete_data["success"] is True
    assert complete_data["tokens_removed"] == 500
    assert complete_data["messages_removed"] == 4
    assert complete_data["pre_compaction_tokens"] == 2000
    assert complete_data["post_compaction_tokens"] == 1500
    assert complete_data["checkpoint_number"] == 3


@pytest.mark.asyncio
async def test_compact_bridge_register_is_idempotent(monkeypatch, tmp_path):
    _fresh_config(monkeypatch, tmp_path)
    from copilot_console.app.services.session_client import SessionClient

    fake_session = MagicMock()
    on_calls = []
    fake_session.on = lambda h: (on_calls.append(h) or (lambda: None))

    client = SessionClient(session_id="bridge-idem", cwd="/tmp")
    client.session = fake_session
    client._register_compact_bridge()
    client._register_compact_bridge()  # second call must be a no-op
    assert len(on_calls) == 1


@pytest.mark.asyncio
async def test_stop_cancels_inflight_compact_and_unsubs_bridge(monkeypatch, tmp_path, reset_event_bus):
    _fresh_config(monkeypatch, tmp_path)
    from copilot_console.app.services.session_client import SessionClient

    fake_session = MagicMock()
    unsub_called = {"n": 0}

    def _on(_h):
        def _unsub():
            unsub_called["n"] += 1
        return _unsub

    fake_session.on = _on

    client = SessionClient(session_id="stop-1", cwd="/tmp")
    client.session = fake_session
    client._register_compact_bridge()
    assert client._compact_bridge_unsub is not None

    # Plant an in-flight compact task that will never naturally complete.
    forever = asyncio.Event()

    async def never():
        await forever.wait()

    client._compact_task = asyncio.create_task(never())

    # Minimal state needed for stop() to run without hitting un-mocked branches.
    client.started = True
    client.client = MagicMock()
    client.client.delete_session = AsyncMock()
    client.client.stop = AsyncMock()

    await client.stop()

    assert unsub_called["n"] == 1
    assert client._compact_bridge_unsub is None
    assert client._compact_task is None
