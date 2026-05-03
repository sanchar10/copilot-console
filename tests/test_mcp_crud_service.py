"""Phase 3 Slice 4: CRUD operations on MCPService.

Covers add/update/delete/reset_oauth, validation, scope locking,
read-only protection, and atomic cache rebind.
"""

from __future__ import annotations

import asyncio
import importlib
import json

import pytest


@pytest.fixture
def mcp_env(tmp_path, monkeypatch):
    """Isolated copilot home + agent home with empty MCP config dirs."""
    from copilot_console.app import config as app_config
    from copilot_console.app.services import mcp_service as mcp_module
    from copilot_console.app.services import storage_service as storage_module

    storage_module = importlib.reload(storage_module)
    mcp_module = importlib.reload(mcp_module)

    copilot_home = tmp_path / "copilot-home"
    app_home = tmp_path / "copilot-console-home"
    copilot_home.mkdir()
    app_home.mkdir()
    (copilot_home / "installed-plugins" / "copilot-plugins").mkdir(parents=True)
    oauth_dir = copilot_home / "mcp-oauth-config"
    oauth_dir.mkdir()

    global_cfg = copilot_home / "mcp-config.json"
    agent_cfg = app_home / "mcp-config.json"
    settings_file = app_home / "settings.json"

    monkeypatch.setattr(app_config, "APP_HOME", app_home)
    monkeypatch.setattr(app_config, "SETTINGS_FILE", settings_file)
    monkeypatch.setattr(app_config, "SESSIONS_DIR", app_home / "sessions")
    (app_home / "sessions").mkdir()
    monkeypatch.setattr(app_config, "METADATA_FILE", app_home / "metadata.json")

    monkeypatch.setattr(storage_module, "SETTINGS_FILE", settings_file)
    monkeypatch.setattr(storage_module, "SESSIONS_DIR", app_home / "sessions")
    monkeypatch.setattr(storage_module, "METADATA_FILE", app_home / "metadata.json")

    monkeypatch.setattr(mcp_module, "COPILOT_HOME", copilot_home)
    monkeypatch.setattr(mcp_module, "GLOBAL_MCP_CONFIG", global_cfg)
    monkeypatch.setattr(
        mcp_module,
        "PLUGINS_DIR",
        copilot_home / "installed-plugins" / "copilot-plugins",
    )
    monkeypatch.setattr(mcp_module, "AGENT_ONLY_MCP_CONFIG", agent_cfg)
    monkeypatch.setattr(mcp_module, "OAUTH_CONFIG_DIR", oauth_dir)
    # Re-bind the storage_service singleton on the mcp module to the freshly
    # reloaded one (mcp module imported the OLD storage_service singleton at
    # its own import time).
    monkeypatch.setattr(mcp_module, "storage_service", storage_module.storage_service)

    service = mcp_module.MCPService()

    return {
        "service": service,
        "copilot_home": copilot_home,
        "app_home": app_home,
        "global_cfg": global_cfg,
        "agent_cfg": agent_cfg,
        "oauth_dir": oauth_dir,
        "settings_file": settings_file,
        "module": mcp_module,
        "storage": storage_module.storage_service,
    }


def _seed(path, data):
    path.write_text(json.dumps(data), encoding="utf-8")


# ---------- add_server ---------------------------------------------------------


@pytest.mark.asyncio
async def test_add_server_to_empty_global(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    server = await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL,
        "fs",
        {"command": "/usr/bin/mcp-fs", "args": ["--root", "/tmp"]},
    )
    assert server.name == "fs"
    assert server.source == "global"
    assert server.command == "/usr/bin/mcp-fs"

    # File written
    on_disk = json.loads(mcp_env["global_cfg"].read_text())
    assert "fs" in on_disk["mcpServers"]
    assert on_disk["mcpServers"]["fs"]["command"] == "/usr/bin/mcp-fs"


@pytest.mark.asyncio
async def test_add_server_to_agent_only(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    server = await mcp_env["service"].add_server(
        MCPServerScope.AGENT_ONLY,
        "private",
        {"command": "echo", "args": []},
    )
    assert server.source == "agent-only"
    assert mcp_env["agent_cfg"].exists()
    assert not mcp_env["global_cfg"].exists()


@pytest.mark.asyncio
async def test_add_remote_server(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    server = await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL,
        "bluebird",
        {"type": "http", "url": "https://example.com/mcp"},
    )
    assert server.url == "https://example.com/mcp"
    assert server.type == "http"


@pytest.mark.asyncio
async def test_add_server_preserves_existing_entries(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    _seed(mcp_env["global_cfg"], {"mcpServers": {"existing": {"command": "echo"}}})
    mcp_env["service"].refresh()
    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "newone", {"command": "ls"}
    )
    on_disk = json.loads(mcp_env["global_cfg"].read_text())
    assert set(on_disk["mcpServers"]) == {"existing", "newone"}


@pytest.mark.asyncio
async def test_add_server_name_conflict_in_same_scope(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope
    from copilot_console.app.services.mcp_service import MCPNameConflictError

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "fs", {"command": "echo"}
    )
    with pytest.raises(MCPNameConflictError):
        await mcp_env["service"].add_server(
            MCPServerScope.GLOBAL, "fs", {"command": "ls"}
        )


@pytest.mark.asyncio
async def test_add_server_name_conflict_across_scopes(mcp_env):
    """Cannot add a name that already exists in agent-only when adding to global."""
    from copilot_console.app.models.mcp import MCPServerScope
    from copilot_console.app.services.mcp_service import MCPNameConflictError

    await mcp_env["service"].add_server(
        MCPServerScope.AGENT_ONLY, "fs", {"command": "echo"}
    )
    with pytest.raises(MCPNameConflictError):
        await mcp_env["service"].add_server(
            MCPServerScope.GLOBAL, "fs", {"command": "ls"}
        )


@pytest.mark.asyncio
async def test_add_server_rejects_missing_command_and_url(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope
    from copilot_console.app.services.mcp_service import MCPInvalidConfigError

    with pytest.raises(MCPInvalidConfigError):
        await mcp_env["service"].add_server(
            MCPServerScope.GLOBAL, "x", {"args": ["nope"]}
        )


@pytest.mark.asyncio
async def test_add_server_rejects_remote_without_url(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope
    from copilot_console.app.services.mcp_service import MCPInvalidConfigError

    with pytest.raises(MCPInvalidConfigError):
        await mcp_env["service"].add_server(
            MCPServerScope.GLOBAL, "x", {"type": "http"}
        )


@pytest.mark.asyncio
async def test_add_server_cache_rebuilt_atomically(mcp_env):
    """After add, get_available_servers reflects the new server immediately."""
    from copilot_console.app.models.mcp import MCPServerScope

    _seed(mcp_env["global_cfg"], {"mcpServers": {}})
    mcp_env["service"].refresh()
    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "fs", {"command": "echo"}
    )
    names = [s.name for s in mcp_env["service"].get_available_servers().servers]
    assert "fs" in names


# ---------- update_server ------------------------------------------------------


@pytest.mark.asyncio
async def test_update_server_replaces_inner_config(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "fs", {"command": "old", "args": ["a"]}
    )
    server = await mcp_env["service"].update_server(
        "fs", {"command": "new", "args": ["b", "c"]}
    )
    assert server.command == "new"
    assert server.args == ["b", "c"]


@pytest.mark.asyncio
async def test_update_server_preserves_unrelated_servers_in_scope(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "fs", {"command": "echo"}
    )
    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "ls", {"command": "ls"}
    )
    await mcp_env["service"].update_server("fs", {"command": "newecho"})

    on_disk = json.loads(mcp_env["global_cfg"].read_text())
    assert on_disk["mcpServers"]["fs"]["command"] == "newecho"
    assert on_disk["mcpServers"]["ls"]["command"] == "ls"


@pytest.mark.asyncio
async def test_update_server_not_found(mcp_env):
    from copilot_console.app.services.mcp_service import MCPNotFoundError

    with pytest.raises(MCPNotFoundError):
        await mcp_env["service"].update_server("nope", {"command": "x"})


@pytest.mark.asyncio
async def test_update_plugin_server_rejected(mcp_env):
    from copilot_console.app.services.mcp_service import MCPReadOnlyError

    plugin = mcp_env["copilot_home"] / "installed-plugins" / "copilot-plugins" / "myplugin"
    plugin.mkdir()
    _seed(plugin / ".mcp.json", {"mcpServers": {"plug-srv": {"command": "echo"}}})
    mcp_env["service"].refresh()

    with pytest.raises(MCPReadOnlyError):
        await mcp_env["service"].update_server("plug-srv", {"command": "ls"})


@pytest.mark.asyncio
async def test_update_server_invalid_config_rejected(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope
    from copilot_console.app.services.mcp_service import MCPInvalidConfigError

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "fs", {"command": "echo"}
    )
    with pytest.raises(MCPInvalidConfigError):
        await mcp_env["service"].update_server("fs", {"args": []})


# ---------- delete_server ------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_server_removes_from_disk_and_cache(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "fs", {"command": "echo"}
    )
    await mcp_env["service"].delete_server("fs")
    assert mcp_env["service"].find_server("fs") is None
    on_disk = json.loads(mcp_env["global_cfg"].read_text())
    assert "fs" not in on_disk["mcpServers"]


@pytest.mark.asyncio
async def test_delete_server_clears_auto_enable(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "fs", {"command": "echo"}
    )
    mcp_env["storage"].set_mcp_auto_enable("fs", True)
    await mcp_env["service"].delete_server("fs")
    assert mcp_env["storage"].get_mcp_auto_enable() == {}


@pytest.mark.asyncio
async def test_delete_plugin_server_rejected(mcp_env):
    from copilot_console.app.services.mcp_service import MCPReadOnlyError

    plugin = mcp_env["copilot_home"] / "installed-plugins" / "copilot-plugins" / "p1"
    plugin.mkdir()
    _seed(plugin / ".mcp.json", {"mcpServers": {"plug-srv": {"command": "echo"}}})
    mcp_env["service"].refresh()

    with pytest.raises(MCPReadOnlyError):
        await mcp_env["service"].delete_server("plug-srv")


@pytest.mark.asyncio
async def test_delete_unknown_server_raises(mcp_env):
    from copilot_console.app.services.mcp_service import MCPNotFoundError

    with pytest.raises(MCPNotFoundError):
        await mcp_env["service"].delete_server("ghost")


@pytest.mark.asyncio
async def test_delete_preserves_unrelated_servers(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "a", {"command": "echo"}
    )
    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "b", {"command": "ls"}
    )
    await mcp_env["service"].delete_server("a")
    on_disk = json.loads(mcp_env["global_cfg"].read_text())
    assert list(on_disk["mcpServers"]) == ["b"]


# ---------- reset_oauth --------------------------------------------------------


@pytest.mark.asyncio
async def test_reset_oauth_removes_matching_files(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL,
        "bluebird",
        {"type": "http", "url": "https://example.com/mcp"},
    )

    reg = mcp_env["oauth_dir"] / "abc123.json"
    tokens = mcp_env["oauth_dir"] / "abc123.tokens.json"
    reg.write_text(json.dumps({"serverUrl": "https://example.com/mcp", "clientId": "x"}))
    tokens.write_text(json.dumps({"accessToken": "y"}))

    result = await mcp_env["service"].reset_oauth("bluebird")
    assert "abc123.json" in result["removed"]
    assert "abc123.tokens.json" in result["removed"]
    assert not reg.exists()
    assert not tokens.exists()


@pytest.mark.asyncio
async def test_reset_oauth_ignores_other_servers(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL,
        "bluebird",
        {"type": "http", "url": "https://example.com/mcp"},
    )

    keep = mcp_env["oauth_dir"] / "other.json"
    keep.write_text(json.dumps({"serverUrl": "https://different.com/mcp"}))

    result = await mcp_env["service"].reset_oauth("bluebird")
    assert result["removed"] == []
    assert keep.exists()


@pytest.mark.asyncio
async def test_reset_oauth_normalises_trailing_slash(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL,
        "bluebird",
        {"type": "http", "url": "https://example.com/mcp/"},
    )
    reg = mcp_env["oauth_dir"] / "z.json"
    reg.write_text(json.dumps({"serverUrl": "https://example.com/mcp"}))
    result = await mcp_env["service"].reset_oauth("bluebird")
    assert "z.json" in result["removed"]


@pytest.mark.asyncio
async def test_reset_oauth_skips_unreadable_files(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL,
        "bluebird",
        {"type": "http", "url": "https://example.com/mcp"},
    )
    bad = mcp_env["oauth_dir"] / "bad.json"
    bad.write_text("{not valid json")
    good = mcp_env["oauth_dir"] / "good.json"
    good.write_text(json.dumps({"serverUrl": "https://example.com/mcp"}))

    result = await mcp_env["service"].reset_oauth("bluebird")
    assert "good.json" in result["removed"]
    assert "bad.json" not in result["removed"]
    assert bad.exists()  # unreadable file is left in place


@pytest.mark.asyncio
async def test_reset_oauth_local_server_rejected(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope
    from copilot_console.app.services.mcp_service import MCPInvalidConfigError

    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL, "fs", {"command": "echo"}
    )
    with pytest.raises(MCPInvalidConfigError):
        await mcp_env["service"].reset_oauth("fs")


@pytest.mark.asyncio
async def test_reset_oauth_unknown_server(mcp_env):
    from copilot_console.app.services.mcp_service import MCPNotFoundError

    with pytest.raises(MCPNotFoundError):
        await mcp_env["service"].reset_oauth("ghost")


@pytest.mark.asyncio
async def test_reset_oauth_no_oauth_dir(mcp_env):
    """Missing OAuth dir should be a clean no-op, not an error."""
    from copilot_console.app.models.mcp import MCPServerScope
    import shutil

    shutil.rmtree(mcp_env["oauth_dir"])
    await mcp_env["service"].add_server(
        MCPServerScope.GLOBAL,
        "bluebird",
        {"type": "http", "url": "https://example.com/mcp"},
    )
    result = await mcp_env["service"].reset_oauth("bluebird")
    assert result == {"removed": [], "scanned": 0}


# ---------- Concurrency --------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_adds_to_same_scope_no_lost_updates(mcp_env):
    """Two concurrent add_server calls to the same scope must both succeed
    (S1: read-modify-write inside per-scope lock)."""
    from copilot_console.app.models.mcp import MCPServerScope

    async def add(name):
        await mcp_env["service"].add_server(
            MCPServerScope.GLOBAL, name, {"command": "echo"}
        )

    await asyncio.gather(add("a"), add("b"), add("c"))
    on_disk = json.loads(mcp_env["global_cfg"].read_text())
    assert set(on_disk["mcpServers"]) == {"a", "b", "c"}


@pytest.mark.asyncio
async def test_cache_consistent_after_concurrent_writes(mcp_env):
    from copilot_console.app.models.mcp import MCPServerScope

    async def add(name):
        await mcp_env["service"].add_server(
            MCPServerScope.GLOBAL, name, {"command": "echo"}
        )

    await asyncio.gather(*(add(f"srv{i}") for i in range(10)))
    cached = {s.name for s in mcp_env["service"].get_available_servers().servers}
    assert cached == {f"srv{i}" for i in range(10)}
