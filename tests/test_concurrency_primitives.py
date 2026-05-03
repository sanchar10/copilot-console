"""Phase 3 Slice 0: tests for concurrency / safety primitives.

Covers:
- atomic_write_json: temp + os.replace round-trip, Windows-safe (replace-over-existing).
- deep_merge: nested merge semantics, immutability of inputs.
- patch_settings: deep merge through re-read; preserves sibling keys; preserves
  unrelated nested entries when patching a single nested key.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.test_services import _fresh_config


class TestAtomicWriteJson:
    def test_round_trip(self, tmp_path):
        from copilot_console.app.services.storage_service import atomic_write_json

        target = tmp_path / "out.json"
        data = {"alpha": 1, "beta": ["x", "y"], "nested": {"k": "v"}}
        atomic_write_json(target, data)

        loaded = json.loads(target.read_text(encoding="utf-8"))
        assert loaded == data

    def test_overwrite_existing(self, tmp_path):
        """os.replace must overwrite an existing file (Windows quirk that os.rename fails)."""
        from copilot_console.app.services.storage_service import atomic_write_json

        target = tmp_path / "out.json"
        target.write_text('{"old": true}', encoding="utf-8")
        atomic_write_json(target, {"new": True})

        loaded = json.loads(target.read_text(encoding="utf-8"))
        assert loaded == {"new": True}

    def test_no_temp_file_left_behind(self, tmp_path):
        from copilot_console.app.services.storage_service import atomic_write_json

        target = tmp_path / "out.json"
        atomic_write_json(target, {"k": 1})
        siblings = [p.name for p in tmp_path.iterdir()]
        assert siblings == ["out.json"]

    def test_terminating_newline(self, tmp_path):
        """Diff-friendly output should end with a newline."""
        from copilot_console.app.services.storage_service import atomic_write_json

        target = tmp_path / "out.json"
        atomic_write_json(target, {"k": 1})
        assert target.read_text(encoding="utf-8").endswith("\n")


class TestDeepMerge:
    def test_disjoint_keys(self):
        from copilot_console.app.services.storage_service import deep_merge

        result = deep_merge({"a": 1}, {"b": 2})
        assert result == {"a": 1, "b": 2}

    def test_patch_wins_for_scalars(self):
        from copilot_console.app.services.storage_service import deep_merge

        result = deep_merge({"a": 1}, {"a": 2})
        assert result == {"a": 2}

    def test_recursive_merge_of_nested_dicts(self):
        from copilot_console.app.services.storage_service import deep_merge

        base = {"mcp_auto_enable": {"X": True, "Y": False}}
        patch = {"mcp_auto_enable": {"Y": True, "Z": True}}
        result = deep_merge(base, patch)
        assert result == {"mcp_auto_enable": {"X": True, "Y": True, "Z": True}}

    def test_lists_replaced_not_concatenated(self):
        from copilot_console.app.services.storage_service import deep_merge

        result = deep_merge({"items": [1, 2]}, {"items": [3]})
        assert result == {"items": [3]}

    def test_dict_replaces_scalar_and_vice_versa(self):
        from copilot_console.app.services.storage_service import deep_merge

        # scalar in base, dict in patch -> patch wins
        assert deep_merge({"k": 1}, {"k": {"a": 2}}) == {"k": {"a": 2}}
        # dict in base, scalar in patch -> patch wins (replaces whole subtree)
        assert deep_merge({"k": {"a": 2}}, {"k": 1}) == {"k": 1}

    def test_inputs_not_mutated(self):
        from copilot_console.app.services.storage_service import deep_merge

        base = {"nest": {"a": 1}}
        patch = {"nest": {"b": 2}}
        deep_merge(base, patch)
        assert base == {"nest": {"a": 1}}
        assert patch == {"nest": {"b": 2}}

    def test_none_value_in_patch_overrides(self):
        from copilot_console.app.services.storage_service import deep_merge

        result = deep_merge({"a": "x"}, {"a": None})
        assert result == {"a": None}


class TestPatchSettings:
    def _make_service(self, monkeypatch, tmp_path):
        _fresh_config(monkeypatch, tmp_path)
        from copilot_console.app.services.storage_service import StorageService
        return StorageService()

    def test_patch_preserves_sibling_top_level_keys(self, monkeypatch, tmp_path):
        svc = self._make_service(monkeypatch, tmp_path)
        svc.update_settings({"default_model": "gpt-4.1", "default_cwd": "/work"})

        merged = svc.patch_settings({"workflow_step_timeout": 600})

        assert merged["default_model"] == "gpt-4.1"
        assert merged["default_cwd"] == "/work"
        assert merged["workflow_step_timeout"] == 600

    def test_patch_nested_dict_preserves_unrelated_entries(self, monkeypatch, tmp_path):
        """The classic mcp_auto_enable use case: toggle one server without losing others."""
        svc = self._make_service(monkeypatch, tmp_path)
        svc.update_settings({"mcp_auto_enable": {"alpha": True, "beta": False}})

        merged = svc.patch_settings({"mcp_auto_enable": {"gamma": True}})

        assert merged["mcp_auto_enable"] == {
            "alpha": True,
            "beta": False,
            "gamma": True,
        }

    def test_patch_nested_dict_can_overwrite_existing_entry(self, monkeypatch, tmp_path):
        svc = self._make_service(monkeypatch, tmp_path)
        svc.update_settings({"mcp_auto_enable": {"alpha": False}})

        merged = svc.patch_settings({"mcp_auto_enable": {"alpha": True}})
        assert merged["mcp_auto_enable"]["alpha"] is True

    def test_patch_persists_to_disk(self, monkeypatch, tmp_path):
        svc = self._make_service(monkeypatch, tmp_path)
        svc.patch_settings({"mcp_auto_enable": {"alpha": True}})

        # Re-read via a fresh service instance
        from copilot_console.app.services.storage_service import StorageService
        svc2 = StorageService()
        assert svc2.get_settings()["mcp_auto_enable"] == {"alpha": True}

    def test_concurrent_patches_to_different_nested_keys_no_lost_updates(
        self, monkeypatch, tmp_path
    ):
        """Simulate two callers patching different nested keys back-to-back.

        Because patch_settings re-reads from disk inside each call, the
        second call sees the first call's write. Even with no explicit
        lock, single-threaded sync execution serializes them safely.
        """
        svc = self._make_service(monkeypatch, tmp_path)

        svc.patch_settings({"mcp_auto_enable": {"alpha": True}})
        svc.patch_settings({"mcp_auto_enable": {"beta": True}})

        final = svc.get_settings()["mcp_auto_enable"]
        assert final == {"alpha": True, "beta": True}

    def test_unlike_update_settings_patch_does_not_clobber_nested(
        self, monkeypatch, tmp_path
    ):
        """Document the contract: update_settings() shallow-replaces;
        patch_settings() deep-merges. Both have legitimate uses."""
        svc = self._make_service(monkeypatch, tmp_path)
        svc.update_settings({"mcp_auto_enable": {"alpha": True}})

        # Shallow replaces the whole subtree:
        svc.update_settings({"mcp_auto_enable": {"beta": True}})
        assert svc.get_settings()["mcp_auto_enable"] == {"beta": True}

        # patch_settings preserves siblings:
        svc.patch_settings({"mcp_auto_enable": {"gamma": True}})
        assert svc.get_settings()["mcp_auto_enable"] == {"beta": True, "gamma": True}
