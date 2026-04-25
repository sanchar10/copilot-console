"""Tests for POST /api/mcp/sessions/{session_id}/{server_name}/oauth-retrigger."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock


def test_retrigger_404_when_session_unknown(client):
    resp = client.post("/api/mcp/sessions/does-not-exist/srv/oauth-retrigger")
    assert resp.status_code == 404
    assert "not active" in resp.json()["detail"].lower()


def test_retrigger_409_when_no_coordinator(client, monkeypatch):
    """Active session with no OAuth coordinator → 409."""
    from copilot_console.app.services.copilot_service import copilot_service

    monkeypatch.setattr(copilot_service, "is_session_active", lambda _id: True)
    monkeypatch.setattr(copilot_service, "get_oauth_coordinator", lambda _id: None)

    resp = client.post("/api/mcp/sessions/sess-1/srv/oauth-retrigger")
    assert resp.status_code == 409
    assert "send a message first" in resp.json()["detail"].lower()


def test_retrigger_invokes_coordinator(client, monkeypatch):
    """Happy path — endpoint awaits coordinator.retrigger and returns 200."""
    from copilot_console.app.services.copilot_service import copilot_service

    fake_coord = MagicMock()
    fake_coord.retrigger = AsyncMock(return_value=None)

    monkeypatch.setattr(copilot_service, "is_session_active", lambda _id: True)
    monkeypatch.setattr(copilot_service, "get_oauth_coordinator", lambda _id: fake_coord)

    resp = client.post("/api/mcp/sessions/sess-1/my-server/oauth-retrigger")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "accepted"
    assert body["serverName"] == "my-server"
    fake_coord.retrigger.assert_awaited_once_with("my-server")


def test_retrigger_url_encodes_server_name(client, monkeypatch):
    """Server names with special chars must round-trip through URL decoding."""
    from copilot_console.app.services.copilot_service import copilot_service

    captured = {}

    async def _retrigger(name):
        captured["name"] = name

    fake_coord = MagicMock()
    fake_coord.retrigger = _retrigger

    monkeypatch.setattr(copilot_service, "is_session_active", lambda _id: True)
    monkeypatch.setattr(copilot_service, "get_oauth_coordinator", lambda _id: fake_coord)

    # %20 → space, %2F → /
    resp = client.post("/api/mcp/sessions/sess-1/my%20server/oauth-retrigger")
    assert resp.status_code == 200
    assert captured["name"] == "my server"
