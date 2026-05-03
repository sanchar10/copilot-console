"""Tests for MCP CRUD endpoints (Phase 3 Slice 5).

Endpoints:
- POST   /api/mcp/servers
- PUT    /api/mcp/servers/{name}
- DELETE /api/mcp/servers/{name}
- POST   /api/mcp/servers/{name}/reset-oauth
"""

from __future__ import annotations

import json
from pathlib import Path


# ---------- POST /servers ------------------------------------------------------


def test_create_global_server_201(client):
    resp = client.post(
        "/api/mcp/servers",
        json={"scope": "global", "name": "fs", "config": {"command": "echo"}},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "fs"
    assert body["source"] == "global"
    assert body["command"] == "echo"

    # Appears in subsequent list call
    listing = client.get("/api/mcp/servers").json()
    assert any(s["name"] == "fs" for s in listing["servers"])


def test_create_agent_only_server(client):
    resp = client.post(
        "/api/mcp/servers",
        json={"scope": "agent-only", "name": "private", "config": {"command": "ls"}},
    )
    assert resp.status_code == 201
    assert resp.json()["source"] == "agent-only"


def test_create_remote_server(client):
    resp = client.post(
        "/api/mcp/servers",
        json={
            "scope": "global",
            "name": "bluebird",
            "config": {"type": "http", "url": "https://example.com/mcp"},
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["url"] == "https://example.com/mcp"


def test_create_with_combined_auto_enable(client):
    """S6 — single round trip writes both server and the auto-enable flag."""
    resp = client.post(
        "/api/mcp/servers",
        json={
            "scope": "global",
            "name": "fs",
            "config": {"command": "echo"},
            "autoEnable": True,
        },
    )
    assert resp.status_code == 201
    settings = client.get("/api/mcp/settings").json()
    assert settings["mcp_auto_enable"]["fs"] is True


def test_create_plugin_scope_rejected_422(client):
    """Plugin scope is not in the writable-scope enum, Pydantic rejects with 422."""
    resp = client.post(
        "/api/mcp/servers",
        json={"scope": "plugin", "name": "x", "config": {"command": "echo"}},
    )
    assert resp.status_code == 422


def test_create_invalid_name_400(client):
    resp = client.post(
        "/api/mcp/servers",
        json={"scope": "global", "name": "has spaces", "config": {"command": "echo"}},
    )
    assert resp.status_code == 400


def test_create_invalid_config_400(client):
    """Inner config missing both command and url."""
    resp = client.post(
        "/api/mcp/servers",
        json={"scope": "global", "name": "fs", "config": {"args": []}},
    )
    assert resp.status_code == 400


def test_create_name_conflict_409(client):
    client.post(
        "/api/mcp/servers",
        json={"scope": "global", "name": "fs", "config": {"command": "echo"}},
    )
    resp = client.post(
        "/api/mcp/servers",
        json={"scope": "global", "name": "fs", "config": {"command": "ls"}},
    )
    assert resp.status_code == 409


def test_create_oversized_config_413(client):
    huge_args = ["x" * 1024 for _ in range(80)]  # ~80 KB
    resp = client.post(
        "/api/mcp/servers",
        json={"scope": "global", "name": "fs", "config": {"command": "echo", "args": huge_args}},
    )
    assert resp.status_code == 413


def test_create_unknown_scope_422(client):
    resp = client.post(
        "/api/mcp/servers",
        json={"scope": "weird", "name": "fs", "config": {"command": "echo"}},
    )
    # Pydantic enum rejection → 422 (FastAPI validation error)
    assert resp.status_code == 422


# ---------- PUT /servers/{name} -----------------------------------------------


def test_update_replaces_inner_config(client):
    client.post(
        "/api/mcp/servers",
        json={"scope": "global", "name": "fs", "config": {"command": "old"}},
    )
    resp = client.put(
        "/api/mcp/servers/fs",
        json={"config": {"command": "new", "args": ["a"]}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["command"] == "new"
    assert body["args"] == ["a"]


def test_update_with_combined_auto_enable(client):
    client.post(
        "/api/mcp/servers",
        json={"scope": "global", "name": "fs", "config": {"command": "echo"}},
    )
    resp = client.put(
        "/api/mcp/servers/fs",
        json={"config": {"command": "echo"}, "autoEnable": True},
    )
    assert resp.status_code == 200
    assert client.get("/api/mcp/settings").json()["mcp_auto_enable"]["fs"] is True


def test_update_unknown_server_404(client):
    resp = client.put(
        "/api/mcp/servers/ghost",
        json={"config": {"command": "echo"}},
    )
    assert resp.status_code == 404


def test_update_invalid_config_400(client):
    client.post(
        "/api/mcp/servers",
        json={"scope": "global", "name": "fs", "config": {"command": "echo"}},
    )
    resp = client.put(
        "/api/mcp/servers/fs",
        json={"config": {"args": []}},
    )
    assert resp.status_code == 400


def test_update_invalid_name_400(client):
    resp = client.put(
        "/api/mcp/servers/has spaces",
        json={"config": {"command": "echo"}},
    )
    assert resp.status_code == 400


def test_update_plugin_server_403(client, tmp_path, monkeypatch):
    """Plugin server (read-only) cannot be updated."""
    # Seed a plugin file under the monkeypatched HOME.
    home = Path(client.app.state.__dict__.get("home", "")) if False else None
    # Simpler: locate the plugins dir via env
    import os
    user_home = Path(os.environ["HOME"])
    plugin_dir = user_home / ".copilot" / "installed-plugins" / "copilot-plugins" / "p1"
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / ".mcp.json").write_text(
        json.dumps({"mcpServers": {"plug-srv": {"command": "echo"}}})
    )
    # Force cache rebuild via the refresh endpoint so the plugin is visible.
    client.post("/api/mcp/servers/refresh")

    resp = client.put(
        "/api/mcp/servers/plug-srv",
        json={"config": {"command": "ls"}},
    )
    assert resp.status_code == 403


# ---------- DELETE /servers/{name} --------------------------------------------


def test_delete_204(client):
    client.post(
        "/api/mcp/servers",
        json={"scope": "global", "name": "fs", "config": {"command": "echo"}},
    )
    resp = client.delete("/api/mcp/servers/fs")
    assert resp.status_code == 204
    assert resp.text == ""

    listing = client.get("/api/mcp/servers").json()
    assert not any(s["name"] == "fs" for s in listing["servers"])


def test_delete_clears_auto_enable(client):
    client.post(
        "/api/mcp/servers",
        json={
            "scope": "global",
            "name": "fs",
            "config": {"command": "echo"},
            "autoEnable": True,
        },
    )
    assert client.get("/api/mcp/settings").json()["mcp_auto_enable"] == {"fs": True}
    client.delete("/api/mcp/servers/fs")
    assert client.get("/api/mcp/settings").json()["mcp_auto_enable"] == {}


def test_delete_unknown_404(client):
    resp = client.delete("/api/mcp/servers/ghost")
    assert resp.status_code == 404


def test_delete_invalid_name_400(client):
    resp = client.delete("/api/mcp/servers/has spaces")
    assert resp.status_code == 400


def test_delete_plugin_403(client):
    import os
    user_home = Path(os.environ["HOME"])
    plugin_dir = user_home / ".copilot" / "installed-plugins" / "copilot-plugins" / "p1"
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / ".mcp.json").write_text(
        json.dumps({"mcpServers": {"plug-srv": {"command": "echo"}}})
    )
    client.post("/api/mcp/servers/refresh")

    resp = client.delete("/api/mcp/servers/plug-srv")
    assert resp.status_code == 403


# ---------- POST /servers/{name}/reset-oauth ----------------------------------


def test_reset_oauth_removes_files(client):
    import os
    user_home = Path(os.environ["HOME"])
    oauth_dir = user_home / ".copilot" / "mcp-oauth-config"
    oauth_dir.mkdir(parents=True, exist_ok=True)
    reg = oauth_dir / "abc.json"
    tokens = oauth_dir / "abc.tokens.json"
    reg.write_text(json.dumps({"serverUrl": "https://example.com/mcp"}))
    tokens.write_text(json.dumps({"accessToken": "y"}))

    client.post(
        "/api/mcp/servers",
        json={
            "scope": "global",
            "name": "bluebird",
            "config": {"type": "http", "url": "https://example.com/mcp"},
        },
    )

    resp = client.post("/api/mcp/servers/bluebird/reset-oauth")
    assert resp.status_code == 200
    body = resp.json()
    assert "abc.json" in body["removed"]
    assert "abc.tokens.json" in body["removed"]
    assert not reg.exists()
    assert not tokens.exists()


def test_reset_oauth_local_server_400(client):
    client.post(
        "/api/mcp/servers",
        json={"scope": "global", "name": "fs", "config": {"command": "echo"}},
    )
    resp = client.post("/api/mcp/servers/fs/reset-oauth")
    assert resp.status_code == 400


def test_reset_oauth_unknown_404(client):
    resp = client.post("/api/mcp/servers/ghost/reset-oauth")
    assert resp.status_code == 404


def test_reset_oauth_invalid_name_400(client):
    resp = client.post("/api/mcp/servers/has spaces/reset-oauth")
    assert resp.status_code == 400


def test_reset_oauth_no_matches_returns_empty(client):
    """No registration files match → returns clean empty result, not an error."""
    client.post(
        "/api/mcp/servers",
        json={
            "scope": "global",
            "name": "bluebird",
            "config": {"type": "http", "url": "https://example.com/mcp"},
        },
    )
    resp = client.post("/api/mcp/servers/bluebird/reset-oauth")
    assert resp.status_code == 200
    assert resp.json()["removed"] == []
