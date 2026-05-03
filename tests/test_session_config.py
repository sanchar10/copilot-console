"""Pre-refactor characterization tests for session config resolution and cleanup.

McManus is extracting _resolve_session_config from the router into a helper.
These tests capture the current behavior so the extraction can be verified.
Also covers session delete/disconnect cleanup paths.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fresh_config(monkeypatch, tmp_path: Path):
    """Monkeypatch config module constants to point at tmp_path."""
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


# ===================================================================
# _resolve_session_config — session config resolution
# ===================================================================

class TestResolveSessionConfig:
    """Capture the behavior of _resolve_session_config from the router."""

    def _setup(self, monkeypatch, tmp_path):
        cfg = _fresh_config(monkeypatch, tmp_path)
        from copilot_console.app.models.session import Session
        from copilot_console.app.models.agent import AgentTools
        return cfg, Session, AgentTools

    def test_cwd_defaults_to_home_when_none(self, monkeypatch, tmp_path):
        """When session.cwd is None, resolved cwd should be user home."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config
        import os

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            cwd=None, created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        assert result["cwd"] == os.path.expanduser("~")

    def test_cwd_uses_session_cwd(self, monkeypatch, tmp_path):
        """When session.cwd is set, resolved cwd should use it."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            cwd="/my/project", created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        assert result["cwd"] == "/my/project"

    def test_system_message_none_when_empty(self, monkeypatch, tmp_path):
        """No system_message → resolved system_message is None."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            system_message=None, created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        assert result["system_message"] is None

    def test_system_message_none_when_content_empty(self, monkeypatch, tmp_path):
        """system_message with empty content → resolved system_message is None."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            system_message={"mode": "replace", "content": ""},
            created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        assert result["system_message"] is None

    def test_system_message_resolved_correctly(self, monkeypatch, tmp_path):
        """system_message with content → resolved with mode and content."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            system_message={"mode": "append", "content": "Be concise."},
            created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        assert result["system_message"] == {
            "mode": "append",
            "content": "Be concise.",
        }

    def test_system_message_defaults_mode_to_replace(self, monkeypatch, tmp_path):
        """system_message without mode → defaults to 'replace'."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            system_message={"content": "Hello"},
            created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        assert result["system_message"]["mode"] == "replace"

    def test_no_custom_tools_returns_none(self, monkeypatch, tmp_path):
        """Empty custom tools → resolved tools is None."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            tools=AgentTools(custom=[], builtin=[]),
            created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        assert result["tools"] is None

    def test_no_builtin_tools_returns_none(self, monkeypatch, tmp_path):
        """Empty builtin tools → available_tools is None."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            tools=AgentTools(custom=[], builtin=[]),
            created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        assert result["available_tools"] is None

    def test_builtin_tools_passed_through(self, monkeypatch, tmp_path):
        """Non-empty builtin tools → passed through as available_tools."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            tools=AgentTools(custom=[], builtin=["read_file", "bash"]),
            created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        assert result["available_tools"] == ["read_file", "bash"]

    def test_excluded_builtin_tools_passed_through(self, monkeypatch, tmp_path):
        """Non-empty excluded_builtin → passed through as excluded_tools."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            tools=AgentTools(custom=[], builtin=[], excluded_builtin=["dangerous_tool"]),
            created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        assert result["excluded_tools"] == ["dangerous_tool"]

    def test_no_sub_agents_returns_none(self, monkeypatch, tmp_path):
        """Empty sub_agents → custom_agents is None."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            sub_agents=[], created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        assert result["custom_agents"] is None

    def test_result_has_all_expected_keys(self, monkeypatch, tmp_path):
        """Result dict must have all required keys."""
        cfg, Session, AgentTools = self._setup(monkeypatch, tmp_path)
        from copilot_console.app.routers.sessions import _resolve_session_config

        now = datetime.now(timezone.utc)
        session = Session(
            session_id="s1", session_name="Test", model="gpt-4.1",
            created_at=now, updated_at=now,
        )

        result = _resolve_session_config(session)
        expected_keys = {
            "cwd", "mcp_servers", "tools", "available_tools",
            "excluded_tools", "system_message", "custom_agents",
        }
        assert set(result.keys()) == expected_keys


# ===================================================================
# Session migration helpers
# ===================================================================

class TestMigrationHelpers:
    """Test _migrate_selections and _migrate_tools preserve backward compat."""

    def _setup(self, monkeypatch, tmp_path):
        _fresh_config(monkeypatch, tmp_path)

    def test_migrate_selections_list_passthrough(self, monkeypatch, tmp_path):
        self._setup(monkeypatch, tmp_path)
        from copilot_console.app.services.session_service import _migrate_selections
        assert _migrate_selections(["a", "b"]) == ["a", "b"]

    def test_migrate_selections_dict_to_list(self, monkeypatch, tmp_path):
        self._setup(monkeypatch, tmp_path)
        from copilot_console.app.services.session_service import _migrate_selections
        result = _migrate_selections({"a": True, "b": False, "c": True})
        assert set(result) == {"a", "c"}

    def test_migrate_selections_invalid_returns_empty(self, monkeypatch, tmp_path):
        self._setup(monkeypatch, tmp_path)
        from copilot_console.app.services.session_service import _migrate_selections
        assert _migrate_selections(None) == []
        assert _migrate_selections(42) == []

    def test_migrate_tools_new_format(self, monkeypatch, tmp_path):
        self._setup(monkeypatch, tmp_path)
        from copilot_console.app.services.session_service import _migrate_tools
        result = _migrate_tools({"custom": ["a"], "builtin": ["b"]})
        assert result.custom == ["a"]
        assert result.builtin == ["b"]

    def test_migrate_tools_old_dict_bool(self, monkeypatch, tmp_path):
        self._setup(monkeypatch, tmp_path)
        from copilot_console.app.services.session_service import _migrate_tools
        result = _migrate_tools({"greet": True, "calc": False})
        assert result.custom == ["greet"]

    def test_migrate_tools_old_list_format(self, monkeypatch, tmp_path):
        self._setup(monkeypatch, tmp_path)
        from copilot_console.app.services.session_service import _migrate_tools
        result = _migrate_tools(["greet", "calc"])
        assert result.custom == ["greet", "calc"]

    def test_migrate_tools_available_format(self, monkeypatch, tmp_path):
        self._setup(monkeypatch, tmp_path)
        from copilot_console.app.services.session_service import _migrate_tools
        result = _migrate_tools({"available": ["a", "b"], "custom": []})
        assert result.custom == ["a", "b"]

    def test_migrate_tools_none_returns_empty(self, monkeypatch, tmp_path):
        self._setup(monkeypatch, tmp_path)
        from copilot_console.app.services.session_service import _migrate_tools
        result = _migrate_tools(None)
        assert result.custom == []
        assert result.builtin == []


# ===================================================================
# SessionService — delete + disconnect cleanup
# ===================================================================

class TestSessionCleanup:
    """Verify session deletion and disconnection cleanup paths."""

    def _setup(self, monkeypatch, tmp_path):
        cfg = _fresh_config(monkeypatch, tmp_path)
        cfg.SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

        from copilot_console.app.services.session_service import session_service
        from copilot_console.app.services.copilot_service import copilot_service
        from copilot_console.app.services.storage_service import storage_service

        return session_service, copilot_service, storage_service

    def test_disconnect_destroys_client(self, monkeypatch, tmp_path):
        """disconnect_session calls destroy_session_client."""
        async def _run():
            ss, cs, _ = self._setup(monkeypatch, tmp_path)

            # Mock the destroy call
            cs.destroy_session_client = AsyncMock()

            await ss.disconnect_session("s1")
            cs.destroy_session_client.assert_awaited_once_with("s1")
        asyncio.run(_run())

    def test_delete_removes_from_storage(self, monkeypatch, tmp_path):
        """delete_session removes session from both SDK and local storage."""
        async def _run():
            ss, cs, storage = self._setup(monkeypatch, tmp_path)

            from tests.test_services import _make_session
            storage.save_session(_make_session("del-1"))
            assert storage.load_session("del-1") is not None

            # Mock SDK delete
            cs.delete_session = AsyncMock()

            await ss.delete_session("del-1")

            cs.delete_session.assert_awaited_once_with("del-1")
            assert storage.load_session("del-1") is None
        asyncio.run(_run())


# ===================================================================
# SessionService — create_session
# ===================================================================

class TestSessionCreate:
    """Verify create_session behavior for pre-refactor baseline."""

    def _setup(self, monkeypatch, tmp_path):
        cfg = _fresh_config(monkeypatch, tmp_path)
        cfg.SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        from copilot_console.app.services.session_service import SessionService
        return SessionService()

    def test_create_generates_uuid(self, monkeypatch, tmp_path):
        async def _run():
            svc = self._setup(monkeypatch, tmp_path)
            from copilot_console.app.models.session import SessionCreate
            req = SessionCreate(model="gpt-4.1")
            session = await svc.create_session(req)
            assert len(session.session_id) == 36  # UUID format
        asyncio.run(_run())

    def test_create_uses_default_name(self, monkeypatch, tmp_path):
        async def _run():
            svc = self._setup(monkeypatch, tmp_path)
            from copilot_console.app.models.session import SessionCreate
            req = SessionCreate(model="gpt-4.1")
            session = await svc.create_session(req)
            assert session.session_name == "New Session"
            assert session.name_set is False
        asyncio.run(_run())

    def test_create_with_custom_name_sets_name_set(self, monkeypatch, tmp_path):
        async def _run():
            svc = self._setup(monkeypatch, tmp_path)
            from copilot_console.app.models.session import SessionCreate
            req = SessionCreate(model="gpt-4.1", name="My Chat")
            session = await svc.create_session(req)
            assert session.session_name == "My Chat"
            assert session.name_set is True
        asyncio.run(_run())

    def test_create_with_mcp_servers(self, monkeypatch, tmp_path):
        async def _run():
            svc = self._setup(monkeypatch, tmp_path)
            from copilot_console.app.models.session import SessionCreate
            req = SessionCreate(model="gpt-4.1", mcp_servers=["server-a"])
            session = await svc.create_session(req)
            assert session.mcp_servers == ["server-a"]
        asyncio.run(_run())

    def test_create_defaults_mcp_to_empty(self, monkeypatch, tmp_path):
        async def _run():
            svc = self._setup(monkeypatch, tmp_path)
            from copilot_console.app.models.session import SessionCreate
            req = SessionCreate(model="gpt-4.1")
            session = await svc.create_session(req)
            assert session.mcp_servers == []
        asyncio.run(_run())

    def test_create_defaults_mcp_from_auto_enable(self, monkeypatch, tmp_path):
        """When mcp_servers is omitted, default to auto-enable ∩ available servers."""
        async def _run():
            svc = self._setup(monkeypatch, tmp_path)
            from copilot_console.app.models.session import SessionCreate
            from copilot_console.app.services import storage_service as storage_mod
            from copilot_console.app.services import mcp_service as mcp_mod

            # Configure auto-enable map: srv-a on, srv-c off, srv-missing on
            storage_mod.storage_service.patch_settings(
                {"mcp_auto_enable": {"srv-a": True, "srv-c": False, "srv-missing": True}}
            )

            class _FakeServer:
                def __init__(self, name): self.name = name
            class _FakeConfig:
                servers = [_FakeServer("srv-a"), _FakeServer("srv-b"), _FakeServer("srv-c")]
            monkeypatch.setattr(
                mcp_mod.mcp_service, "get_available_servers", lambda *a, **k: _FakeConfig()
            )

            req = SessionCreate(model="gpt-4.1")
            session = await svc.create_session(req)
            # srv-a enabled and available; srv-c off; srv-b not in auto-enable;
            # srv-missing in auto-enable but not in available list -> filtered out
            assert session.mcp_servers == ["srv-a"]
        asyncio.run(_run())

    def test_create_explicit_empty_mcp_overrides_auto_enable(self, monkeypatch, tmp_path):
        """Explicit [] in the request must NOT be replaced by the auto-enable default."""
        async def _run():
            svc = self._setup(monkeypatch, tmp_path)
            from copilot_console.app.models.session import SessionCreate
            from copilot_console.app.services import storage_service as storage_mod
            from copilot_console.app.services import mcp_service as mcp_mod

            storage_mod.storage_service.patch_settings(
                {"mcp_auto_enable": {"srv-a": True}}
            )

            class _FakeServer:
                def __init__(self, name): self.name = name
            class _FakeConfig:
                servers = [_FakeServer("srv-a")]
            monkeypatch.setattr(
                mcp_mod.mcp_service, "get_available_servers", lambda *a, **k: _FakeConfig()
            )

            req = SessionCreate(model="gpt-4.1", mcp_servers=[])
            session = await svc.create_session(req)
            assert session.mcp_servers == []
        asyncio.run(_run())

    def test_create_persists_to_storage(self, monkeypatch, tmp_path):
        async def _run():
            svc = self._setup(monkeypatch, tmp_path)
            from copilot_console.app.models.session import SessionCreate
            from copilot_console.app.services.storage_service import storage_service

            req = SessionCreate(model="gpt-4.1", name="Persisted")
            session = await svc.create_session(req)

            loaded = storage_service.load_session(session.session_id)
            assert loaded is not None
            assert loaded["session_name"] == "Persisted"
        asyncio.run(_run())

    def test_create_tracks_auto_naming(self, monkeypatch, tmp_path):
        """Sessions without explicit names are tracked for auto-naming."""
        async def _run():
            svc = self._setup(monkeypatch, tmp_path)
            from copilot_console.app.models.session import SessionCreate

            req = SessionCreate(model="gpt-4.1")  # no name
            session = await svc.create_session(req)

            assert svc.should_auto_name(session.session_id) is True
            # Consuming should return True once, then False
            assert svc.consume_auto_name(session.session_id) is True
            assert svc.consume_auto_name(session.session_id) is False
        asyncio.run(_run())
