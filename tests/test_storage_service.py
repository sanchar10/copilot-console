"""Pre-refactor characterization tests for StorageService write/read behavior.

McManus is adding atomic writes. These tests capture the current happy-path
behavior so we can verify the refactor preserves it exactly.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

from tests.test_services import _fresh_config, _make_session


# ===================================================================
# StorageService — write/read round-trip fidelity
# ===================================================================

class TestStorageServiceWriteRead:
    """Verify that save→load produces identical data for every field."""

    def _make_service(self, monkeypatch, tmp_path):
        cfg = _fresh_config(monkeypatch, tmp_path)
        from copilot_console.app.services.storage_service import StorageService
        return StorageService()

    def test_roundtrip_all_fields(self, monkeypatch, tmp_path):
        """Save a fully-populated session and verify every field loads back."""
        svc = self._make_service(monkeypatch, tmp_path)
        from copilot_console.app.models.agent import AgentTools

        session = _make_session("rt-1", "RoundTrip Test")
        session.cwd = "/home/user/project"
        session.mcp_servers = ["server-x", "server-y"]
        session.tools = AgentTools(
            custom=["tool-a", "tool-b"],
            builtin=["read_file"],
            excluded_builtin=["bash"],
        )
        session.system_message = {"mode": "append", "content": "Be helpful."}
        session.name_set = True
        session.agent_id = "agent-123"
        session.trigger = "automation"
        session.sub_agents = ["sub-1", "sub-2"]
        session.reasoning_effort = "high"

        svc.save_session(session)
        loaded = svc.load_session("rt-1")

        assert loaded is not None
        assert loaded["session_id"] == "rt-1"
        assert loaded["session_name"] == "RoundTrip Test"
        assert loaded["cwd"] == "/home/user/project"
        assert loaded["mcp_servers"] == ["server-x", "server-y"]
        assert loaded["tools"]["custom"] == ["tool-a", "tool-b"]
        assert loaded["tools"]["builtin"] == ["read_file"]
        assert loaded["tools"]["excluded_builtin"] == ["bash"]
        assert loaded["system_message"] == {"mode": "append", "content": "Be helpful."}
        assert loaded["name_set"] is True
        assert loaded["agent_id"] == "agent-123"
        assert loaded["trigger"] == "automation"
        assert loaded["sub_agents"] == ["sub-1", "sub-2"]
        assert loaded["reasoning_effort"] == "high"

    def test_roundtrip_minimal_session(self, monkeypatch, tmp_path):
        """Save a session with defaults and verify they load back."""
        svc = self._make_service(monkeypatch, tmp_path)
        session = _make_session("min-1", "Minimal")

        svc.save_session(session)
        loaded = svc.load_session("min-1")

        assert loaded is not None
        assert loaded["session_id"] == "min-1"
        assert loaded["mcp_servers"] == []
        assert loaded["system_message"] is None
        assert loaded["sub_agents"] == []

    def test_save_overwrites_existing(self, monkeypatch, tmp_path):
        """Save twice to the same ID — second write wins."""
        svc = self._make_service(monkeypatch, tmp_path)
        s1 = _make_session("ow-1", "Version 1")
        svc.save_session(s1)

        s2 = _make_session("ow-1", "Version 2")
        svc.save_session(s2)

        loaded = svc.load_session("ow-1")
        assert loaded["session_name"] == "Version 2"

    def test_save_session_raw_roundtrip(self, monkeypatch, tmp_path):
        """save_session_raw writes arbitrary dicts that load_session can read."""
        svc = self._make_service(monkeypatch, tmp_path)
        raw = {"session_id": "raw-1", "custom_field": "hello", "number": 42}
        svc.save_session_raw("raw-1", raw)

        loaded = svc.load_session("raw-1")
        assert loaded == raw

    def test_concurrent_sessions_isolated(self, monkeypatch, tmp_path):
        """Multiple sessions don't interfere with each other."""
        svc = self._make_service(monkeypatch, tmp_path)
        svc.save_session(_make_session("iso-a", "Alpha"))
        svc.save_session(_make_session("iso-b", "Beta"))

        a = svc.load_session("iso-a")
        b = svc.load_session("iso-b")
        assert a["session_name"] == "Alpha"
        assert b["session_name"] == "Beta"


# ===================================================================
# StorageService — settings round-trip
# ===================================================================

class TestStorageServiceSettings:
    """Verify settings read/write behavior that McManus must preserve."""

    def _make_service(self, monkeypatch, tmp_path):
        cfg = _fresh_config(monkeypatch, tmp_path)
        from copilot_console.app.services.storage_service import StorageService
        return StorageService()

    def test_default_settings_include_all_required_keys(self, monkeypatch, tmp_path):
        svc = self._make_service(monkeypatch, tmp_path)
        settings = svc.get_settings()
        assert "default_model" in settings
        assert "default_cwd" in settings
        assert "workflow_step_timeout" in settings
        assert "cli_notifications" in settings

    def test_update_settings_merges_with_existing(self, monkeypatch, tmp_path):
        svc = self._make_service(monkeypatch, tmp_path)
        svc.update_settings({"default_model": "gpt-4o"})
        svc.update_settings({"cli_notifications": True})

        settings = svc.get_settings()
        assert settings["default_model"] == "gpt-4o"
        assert settings["cli_notifications"] is True
        # Other defaults still present
        assert "default_cwd" in settings

    def test_update_settings_returns_merged_result(self, monkeypatch, tmp_path):
        svc = self._make_service(monkeypatch, tmp_path)
        result = svc.update_settings({"default_model": "o1"})
        assert result["default_model"] == "o1"
        assert "default_cwd" in result

    def test_settings_backfill_missing_keys(self, monkeypatch, tmp_path):
        """If settings file is missing keys, get_settings fills defaults."""
        svc = self._make_service(monkeypatch, tmp_path)
        # Write a minimal settings file
        from copilot_console.app.config import SETTINGS_FILE
        SETTINGS_FILE.write_text(json.dumps({"default_model": "test"}), encoding="utf-8")

        settings = svc.get_settings()
        assert settings["default_model"] == "test"
        assert "default_cwd" in settings
        assert "workflow_step_timeout" in settings
        assert "cli_notifications" in settings


# ===================================================================
# StorageService — delete behavior
# ===================================================================

class TestStorageServiceDelete:
    """Verify delete fully removes the session directory."""

    def _make_service(self, monkeypatch, tmp_path):
        cfg = _fresh_config(monkeypatch, tmp_path)
        from copilot_console.app.services.storage_service import StorageService
        return StorageService()

    def test_delete_returns_true_and_removes_dir(self, monkeypatch, tmp_path):
        svc = self._make_service(monkeypatch, tmp_path)
        svc.save_session(_make_session("del-1"))

        assert svc.delete_session("del-1") is True
        assert svc.load_session("del-1") is None

        # Directory should not exist
        from copilot_console.app.config import SESSIONS_DIR
        assert not (SESSIONS_DIR / "del-1").exists()

    def test_delete_removes_from_list(self, monkeypatch, tmp_path):
        svc = self._make_service(monkeypatch, tmp_path)
        svc.save_session(_make_session("del-2"))
        svc.delete_session("del-2")

        sessions = svc.list_all_sessions()
        ids = {s["session_id"] for s in sessions}
        assert "del-2" not in ids


# ===================================================================
# StorageService — JSON file integrity
# ===================================================================

class TestStorageServiceFileIntegrity:
    """Verify the on-disk format is valid JSON — atomic writes must preserve this."""

    def _make_service(self, monkeypatch, tmp_path):
        cfg = _fresh_config(monkeypatch, tmp_path)
        from copilot_console.app.services.storage_service import StorageService
        return StorageService()

    def test_session_file_is_valid_json(self, monkeypatch, tmp_path):
        svc = self._make_service(monkeypatch, tmp_path)
        svc.save_session(_make_session("json-1"))

        from copilot_console.app.config import SESSIONS_DIR
        session_file = SESSIONS_DIR / "json-1" / "session.json"
        assert session_file.exists()

        data = json.loads(session_file.read_text(encoding="utf-8"))
        assert isinstance(data, dict)
        assert data["session_id"] == "json-1"

    def test_settings_file_is_valid_json(self, monkeypatch, tmp_path):
        svc = self._make_service(monkeypatch, tmp_path)
        svc.update_settings({"test_key": "test_value"})

        from copilot_console.app.config import SETTINGS_FILE
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        assert isinstance(data, dict)
        assert data["test_key"] == "test_value"

    def test_list_skips_corrupt_json(self, monkeypatch, tmp_path):
        """list_all_sessions should skip corrupt session files gracefully."""
        svc = self._make_service(monkeypatch, tmp_path)
        svc.save_session(_make_session("good-1"))

        # Create a corrupt session file
        from copilot_console.app.config import SESSIONS_DIR
        corrupt_dir = SESSIONS_DIR / "corrupt-1"
        corrupt_dir.mkdir(parents=True)
        (corrupt_dir / "session.json").write_text("NOT VALID JSON{{{", encoding="utf-8")

        sessions = svc.list_all_sessions()
        ids = {s["session_id"] for s in sessions}
        assert "good-1" in ids
        assert "corrupt-1" not in ids
