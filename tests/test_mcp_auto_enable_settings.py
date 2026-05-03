"""Phase 3 Slice 2: tests for mcp_auto_enable settings overlay."""

from __future__ import annotations

import json

import pytest


@pytest.fixture
def fresh_storage(tmp_path, monkeypatch):
    """Isolated APP_HOME / SETTINGS_FILE per test.

    Re-imports the storage_service module fresh so we work with the same
    module object that gets monkeypatched. Other tests (notably the FastAPI
    `client` fixture) clear sys.modules, so we can't rely on a top-level
    import of StorageService still pointing at the live module.
    """
    import importlib

    from copilot_console.app import config as app_config
    from copilot_console.app.services import storage_service as storage_module

    storage_module = importlib.reload(storage_module)

    home = tmp_path / "appdata"
    home.mkdir()
    sessions = home / "sessions"
    sessions.mkdir()
    settings_file = home / "settings.json"
    metadata_file = home / "metadata.json"

    monkeypatch.setattr(app_config, "APP_HOME", home)
    monkeypatch.setattr(app_config, "SESSIONS_DIR", sessions)
    monkeypatch.setattr(app_config, "SETTINGS_FILE", settings_file)
    monkeypatch.setattr(app_config, "METADATA_FILE", metadata_file)
    monkeypatch.setattr(storage_module, "SETTINGS_FILE", settings_file)
    monkeypatch.setattr(storage_module, "SESSIONS_DIR", sessions)
    monkeypatch.setattr(storage_module, "METADATA_FILE", metadata_file)

    return storage_module.StorageService()


class TestGetSettingsDefaults:
    def test_default_mcp_auto_enable_is_empty_dict(self, fresh_storage):
        s = fresh_storage.get_settings()
        assert s["mcp_auto_enable"] == {}

    def test_existing_settings_without_mcp_auto_enable_get_default(self, fresh_storage, tmp_path):
        from copilot_console.app.services import storage_service as storage_module

        # Simulate a settings.json from before this slice
        storage_module.SETTINGS_FILE.write_text(json.dumps({"default_model": "x"}))
        s = fresh_storage.get_settings()
        assert s["mcp_auto_enable"] == {}
        assert s["default_model"] == "x"

    def test_corrupt_mcp_auto_enable_value_replaced_with_empty(self, fresh_storage):
        from copilot_console.app.services import storage_service as storage_module

        storage_module.SETTINGS_FILE.write_text(
            json.dumps({"default_model": "x", "mcp_auto_enable": "not-a-dict"})
        )
        s = fresh_storage.get_settings()
        assert s["mcp_auto_enable"] == {}


class TestGetMcpAutoEnable:
    def test_empty_when_unset(self, fresh_storage):
        assert fresh_storage.get_mcp_auto_enable() == {}

    def test_returns_persisted_map(self, fresh_storage):
        fresh_storage.patch_settings({"mcp_auto_enable": {"fs": True, "github": False}})
        assert fresh_storage.get_mcp_auto_enable() == {"fs": True, "github": False}

    def test_coerces_non_bool_values(self, fresh_storage):
        from copilot_console.app.services import storage_service as storage_module

        storage_module.SETTINGS_FILE.write_text(
            json.dumps({"mcp_auto_enable": {"fs": 1, "github": 0, "x": "yes"}})
        )
        result = fresh_storage.get_mcp_auto_enable()
        assert result == {"fs": True, "github": False, "x": True}


class TestSetMcpAutoEnable:
    def test_first_write_creates_entry(self, fresh_storage):
        result = fresh_storage.set_mcp_auto_enable("fs", True)
        assert result == {"fs": True}
        # Disk persisted
        assert fresh_storage.get_mcp_auto_enable() == {"fs": True}

    def test_setting_one_preserves_others(self, fresh_storage):
        fresh_storage.set_mcp_auto_enable("fs", True)
        fresh_storage.set_mcp_auto_enable("github", False)
        fresh_storage.set_mcp_auto_enable("bluebird", True)
        result = fresh_storage.get_mcp_auto_enable()
        assert result == {"fs": True, "github": False, "bluebird": True}

    def test_overwrites_existing_entry(self, fresh_storage):
        fresh_storage.set_mcp_auto_enable("fs", True)
        fresh_storage.set_mcp_auto_enable("fs", False)
        assert fresh_storage.get_mcp_auto_enable() == {"fs": False}

    def test_does_not_clobber_unrelated_top_level_keys(self, fresh_storage):
        fresh_storage.update_settings({"default_model": "claude", "tunnel_url": "https://x.io"})
        fresh_storage.set_mcp_auto_enable("fs", True)
        s = fresh_storage.get_settings()
        assert s["default_model"] == "claude"
        assert s["tunnel_url"] == "https://x.io"
        assert s["mcp_auto_enable"] == {"fs": True}

    def test_rejects_empty_name(self, fresh_storage):
        with pytest.raises(ValueError):
            fresh_storage.set_mcp_auto_enable("", True)

    def test_rejects_non_string_name(self, fresh_storage):
        with pytest.raises(ValueError):
            fresh_storage.set_mcp_auto_enable(None, True)  # type: ignore[arg-type]


class TestRemoveMcpAutoEnable:
    def test_removes_existing_entry(self, fresh_storage):
        fresh_storage.set_mcp_auto_enable("fs", True)
        fresh_storage.set_mcp_auto_enable("github", False)
        result = fresh_storage.remove_mcp_auto_enable("fs")
        assert result == {"github": False}
        assert fresh_storage.get_mcp_auto_enable() == {"github": False}

    def test_missing_key_is_noop(self, fresh_storage):
        fresh_storage.set_mcp_auto_enable("fs", True)
        result = fresh_storage.remove_mcp_auto_enable("nonexistent")
        assert result == {"fs": True}

    def test_remove_from_empty_settings_is_safe(self, fresh_storage):
        result = fresh_storage.remove_mcp_auto_enable("fs")
        assert result == {}

    def test_remove_preserves_unrelated_top_level_keys(self, fresh_storage):
        fresh_storage.update_settings({"default_model": "x"})
        fresh_storage.set_mcp_auto_enable("fs", True)
        fresh_storage.remove_mcp_auto_enable("fs")
        s = fresh_storage.get_settings()
        assert s["default_model"] == "x"
        assert s["mcp_auto_enable"] == {}
