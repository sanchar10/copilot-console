"""Tests for MCPOAuthCoordinator — status publishing, retrigger, and OAuth flow."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from copilot_console.app.services.mcp_oauth_coordinator import (
    MCPOAuthCoordinator,
    POLL_INTERVAL_SECONDS,
    POLL_MAX_ATTEMPTS,
)


# ── helpers ──────────────────────────────────────────────────────────────


class _FakeServer:
    def __init__(self, name: str, status: str | None, error: str | None = None):
        self.name = name
        self.status = status
        self.error = error


class _FakeMCPList:
    """SDK 0.3.0 ``mcp.list()`` returns an object with a ``.servers`` attribute."""

    def __init__(self, servers: list[_FakeServer]):
        self.servers = servers


def _make_session(servers_by_call: list[list[_FakeServer]] | None = None,
                   login_result: Any = None,
                   login_raises: Exception | None = None) -> MagicMock:
    """Build a fake SDK session whose ``rpc.mcp.list()`` returns the next batch
    each call, and whose ``rpc.mcp.oauth.login()`` returns ``login_result`` (or
    raises ``login_raises``)."""
    session = MagicMock()
    session.rpc = MagicMock()
    session.rpc.mcp = MagicMock()
    session.rpc.mcp.oauth = MagicMock()

    calls = list(servers_by_call or [])

    async def _list():
        if not calls:
            return _FakeMCPList([])
        return _FakeMCPList(calls.pop(0))

    async def _login(_req):
        if login_raises is not None:
            raise login_raises
        return login_result

    session.rpc.mcp.list = _list
    session.rpc.mcp.oauth.login = _login
    return session


def _make_coord(session: Any) -> tuple[MCPOAuthCoordinator, list[tuple[str, dict]]]:
    """Build a coordinator wired to a list-based notify sink for assertions."""
    notifications: list[tuple[str, dict]] = []

    def notify(event: str, payload: dict) -> None:
        notifications.append((event, payload))

    coord = MCPOAuthCoordinator(
        session_id="sess-1",
        get_session=lambda: session,
        notify=notify,
    )
    return coord, notifications


# ── status publishing ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_publish_status_emits_only_on_transition():
    coord, notifs = _make_coord(_make_session())
    coord._publish_status("srv", "connected")
    coord._publish_status("srv", "connected")  # dup
    coord._publish_status("srv", "needs-auth")
    coord._publish_status("srv", "needs-auth")  # dup

    status_events = [n for n in notifs if n[0] == "mcp_server_status"]
    assert len(status_events) == 2
    assert status_events[0][1]["statuses"][0]["status"] == "connected"
    assert status_events[1][1]["statuses"][0]["status"] == "needs-auth"
    assert status_events[0][1]["sessionId"] == "sess-1"


@pytest.mark.asyncio
async def test_publish_status_force_overrides_dedup():
    coord, notifs = _make_coord(_make_session())
    coord._publish_status("srv", "connected")
    coord._publish_status("srv", "connected", force=True)
    status_events = [n for n in notifs if n[0] == "mcp_server_status"]
    assert len(status_events) == 2


@pytest.mark.asyncio
async def test_snapshot_publishes_transitions():
    """snapshot() must emit mcp_server_status for newly-observed states."""
    session = _make_session(servers_by_call=[
        [_FakeServer("a", "connected"), _FakeServer("b", "needs-auth")],
        [_FakeServer("a", "connected"), _FakeServer("b", "needs-auth")],  # no change
    ])
    coord, notifs = _make_coord(session)

    await coord.snapshot()
    status_events = [n for n in notifs if n[0] == "mcp_server_status"]
    assert len(status_events) == 2  # one per server
    names = {e[1]["statuses"][0]["serverName"] for e in status_events}
    assert names == {"a", "b"}

    # Second snapshot — no transitions, no new events.
    await coord.snapshot()
    status_events_2 = [n for n in notifs if n[0] == "mcp_server_status"]
    assert len(status_events_2) == 2


@pytest.mark.asyncio
async def test_snapshot_with_no_session_returns_empty():
    coord = MCPOAuthCoordinator(
        session_id="x", get_session=lambda: None, notify=lambda *_: None,
    )
    assert await coord.snapshot() == []


@pytest.mark.asyncio
async def test_snapshot_swallows_mcp_list_errors():
    session = MagicMock()
    session.rpc = MagicMock()
    session.rpc.mcp = MagicMock()

    async def _boom():
        raise RuntimeError("nope")

    session.rpc.mcp.list = _boom
    coord, _ = _make_coord(session)
    assert await coord.snapshot() == []


# ── retrigger ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_retrigger_cancels_inflight_and_starts_fresh(monkeypatch):
    """retrigger() must cancel any in-flight task before starting a new one."""
    # Build a session whose oauth.login blocks until we let it complete, so we
    # can be sure the first task is genuinely "in-flight" when retrigger runs.
    started = asyncio.Event()
    release = asyncio.Event()
    login_calls: list[int] = []

    async def _slow_login(_req):
        login_calls.append(1)
        started.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            raise
        # Return no auth url so flow exits quickly.
        return MagicMock(authorization_url=None)

    session = MagicMock()
    session.rpc = MagicMock()
    session.rpc.mcp = MagicMock()
    session.rpc.mcp.oauth = MagicMock()
    session.rpc.mcp.oauth.login = _slow_login

    async def _list():
        return _FakeMCPList([_FakeServer("srv", "connected")])

    session.rpc.mcp.list = _list

    # Force the SDK import path inside _run_flow to succeed without the real SDK.
    import copilot_console.app.services.mcp_oauth_coordinator as coord_mod
    fake_rpc = MagicMock()
    fake_rpc.MCPOauthLoginRequest = MagicMock()
    monkeypatch.setitem(__import__("sys").modules, "copilot.generated.rpc", fake_rpc)

    coord, _ = _make_coord(session)

    # Kick off first flow.
    await coord._maybe_start("srv")
    await asyncio.wait_for(started.wait(), timeout=2.0)
    assert len(login_calls) == 1
    first_task = coord._inflight.get("srv")
    assert first_task is not None and not first_task.done()

    # Allow the second login call to complete cleanly.
    started.clear()
    release.set()

    # Retrigger — must cancel first, await it, start fresh.
    await coord.retrigger("srv")

    # Wait for new task to finish.
    new_task = coord._inflight.get("srv")
    if new_task is not None:
        try:
            await asyncio.wait_for(new_task, timeout=2.0)
        except asyncio.CancelledError:
            pass

    # We should have observed two login calls (one cancelled, one fresh).
    assert len(login_calls) >= 2


@pytest.mark.asyncio
async def test_retrigger_on_closed_coordinator_is_noop():
    coord, notifs = _make_coord(_make_session())
    coord._closed = True
    await coord.retrigger("any")
    # No notifications, no crash.
    assert notifs == []


# ── OAuth flow ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_flow_emits_required_then_completed(monkeypatch):
    """When login returns an auth URL and server connects, emit required + completed."""
    # First poll says still needs-auth (so we publish that), second poll says connected.
    session = _make_session(
        servers_by_call=[
            [_FakeServer("srv", "needs-auth")],
            [_FakeServer("srv", "connected")],
        ],
        login_result=MagicMock(authorization_url="https://example/oauth"),
    )

    import copilot_console.app.services.mcp_oauth_coordinator as coord_mod
    fake_rpc = MagicMock()
    fake_rpc.MCPOauthLoginRequest = MagicMock()
    monkeypatch.setitem(__import__("sys").modules, "copilot.generated.rpc", fake_rpc)

    # Make the poll interval near-zero so the test is fast.
    monkeypatch.setattr(coord_mod, "POLL_INTERVAL_SECONDS", 0.01)

    coord, notifs = _make_coord(session)
    await coord._run_flow("srv")

    events = [n[0] for n in notifs]
    assert "mcp_oauth_required" in events
    assert "mcp_oauth_completed" in events

    required = next(p for e, p in notifs if e == "mcp_oauth_required")
    assert required["serverName"] == "srv"
    assert required["authorizationUrl"] == "https://example/oauth"
    assert required["sessionId"] == "sess-1"


@pytest.mark.asyncio
async def test_run_flow_login_failure_emits_failed(monkeypatch):
    session = _make_session(login_raises=RuntimeError("login failed"))

    import copilot_console.app.services.mcp_oauth_coordinator as coord_mod
    fake_rpc = MagicMock()
    fake_rpc.MCPOauthLoginRequest = MagicMock()
    monkeypatch.setitem(__import__("sys").modules, "copilot.generated.rpc", fake_rpc)

    coord, notifs = _make_coord(session)
    await coord._run_flow("srv")

    failed = [p for e, p in notifs if e == "mcp_oauth_failed"]
    assert len(failed) == 1
    assert "login failed" in failed[0]["reason"]


@pytest.mark.asyncio
async def test_run_flow_cached_token_path(monkeypatch):
    """When login returns no auth_url, reconcile via mcp.list and emit completed."""
    session = _make_session(
        servers_by_call=[[_FakeServer("srv", "connected")]],
        login_result=MagicMock(authorization_url=None),
    )

    import copilot_console.app.services.mcp_oauth_coordinator as coord_mod
    fake_rpc = MagicMock()
    fake_rpc.MCPOauthLoginRequest = MagicMock()
    monkeypatch.setitem(__import__("sys").modules, "copilot.generated.rpc", fake_rpc)

    coord, notifs = _make_coord(session)
    await coord._run_flow("srv")

    events = [n[0] for n in notifs]
    assert "mcp_oauth_completed" in events
    # Should also publish the connected status transition.
    status_events = [p for e, p in notifs if e == "mcp_server_status"]
    assert any(s["statuses"][0]["status"] == "connected" for s in status_events)


# ── deduplication ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_maybe_start_dedupes_concurrent_calls(monkeypatch):
    """Two _maybe_start calls in flight simultaneously must produce one task."""
    blocker = asyncio.Event()

    async def _slow_login(_req):
        await blocker.wait()
        return MagicMock(authorization_url=None)

    session = MagicMock()
    session.rpc = MagicMock()
    session.rpc.mcp = MagicMock()
    session.rpc.mcp.oauth = MagicMock()
    session.rpc.mcp.oauth.login = _slow_login

    async def _list():
        return _FakeMCPList([_FakeServer("srv", "connected")])

    session.rpc.mcp.list = _list

    fake_rpc = MagicMock()
    fake_rpc.MCPOauthLoginRequest = MagicMock()
    monkeypatch.setitem(__import__("sys").modules, "copilot.generated.rpc", fake_rpc)

    coord, _ = _make_coord(session)
    await coord._maybe_start("srv")
    await coord._maybe_start("srv")
    await coord._maybe_start("srv")

    # Only ONE task in flight despite three calls.
    assert len(coord._inflight) == 1

    blocker.set()
    task = coord._inflight.get("srv")
    if task:
        await asyncio.wait_for(task, timeout=2.0)


# ── extract helpers ─────────────────────────────────────────────────────


def test_extract_servers_handles_none_and_list():
    from copilot_console.app.services.mcp_oauth_coordinator import _extract_servers

    assert _extract_servers(None) == []
    assert _extract_servers([_FakeServer("a", "connected")])[0].name == "a"
    assert _extract_servers(_FakeMCPList([_FakeServer("b", "connected")]))[0].name == "b"


def test_status_value_handles_enum_and_str():
    from copilot_console.app.services.mcp_oauth_coordinator import _status_value

    class _Enum:
        value = "connected"

    assert _status_value(_Enum()) == "connected"
    assert _status_value("needs-auth") == "needs-auth"
    assert _status_value(None) is None


def test_poll_budget_constants_total_about_90s():
    """Sanity-check that the in-flight OAuth budget is ~90s as documented."""
    total = POLL_INTERVAL_SECONDS * POLL_MAX_ATTEMPTS
    assert 75 <= total <= 105, f"poll budget drifted: {total}s"
