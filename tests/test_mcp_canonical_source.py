"""Phase 3 Slice 1: tests for MCPServerScope enum, raw_config capture, and helper props."""

from __future__ import annotations

import json

import pytest

from copilot_console.app.models.mcp import MCPServer, MCPServerScope


class TestMCPServerScope:
    def test_enum_values_match_legacy_source_strings(self):
        """Enum values must equal the strings the FE already compares against."""
        assert MCPServerScope.GLOBAL.value == "global"
        assert MCPServerScope.AGENT_ONLY.value == "agent-only"

    def test_str_subclass_for_easy_comparison(self):
        """str subclass means scope == 'global' is true without .value access."""
        assert MCPServerScope.GLOBAL == "global"
        assert MCPServerScope.AGENT_ONLY == "agent-only"

    def test_plugin_intentionally_excluded(self):
        """Plugin scope is not part of the writable enum (read-only)."""
        with pytest.raises(ValueError):
            MCPServerScope("plugin")
        with pytest.raises(ValueError):
            MCPServerScope("github-pr-helper")

    def test_invalid_value_rejected(self):
        with pytest.raises(ValueError):
            MCPServerScope("nonsense")


class TestMCPServerHelpers:
    def test_is_writable_for_global(self):
        s = MCPServer(name="x", source="global", command="echo")
        assert s.is_writable is True
        assert s.plugin_name is None

    def test_is_writable_for_agent_only(self):
        s = MCPServer(name="x", source="agent-only", command="echo")
        assert s.is_writable is True
        assert s.plugin_name is None

    def test_plugin_source_not_writable(self):
        s = MCPServer(name="x", source="github-pr-helper", command="echo")
        assert s.is_writable is False
        assert s.plugin_name == "github-pr-helper"

    def test_unknown_source_treated_as_plugin(self):
        """Defensive: any source string we don't recognise is non-writable."""
        s = MCPServer(name="x", source="something-weird", command="echo")
        assert s.is_writable is False
        assert s.plugin_name == "something-weird"


class TestRawConfigField:
    def test_default_is_none(self):
        s = MCPServer(name="x", source="global", command="echo")
        assert s.raw_config is None

    def test_can_be_populated(self):
        s = MCPServer(
            name="x",
            source="global",
            command="echo",
            raw_config={"command": "echo", "args": [], "experimentalKey": "future"},
        )
        assert s.raw_config == {"command": "echo", "args": [], "experimentalKey": "future"}

    def test_serializes_in_model_dump(self):
        s = MCPServer(
            name="x",
            source="global",
            command="echo",
            raw_config={"command": "echo", "x": 1},
        )
        dumped = s.model_dump()
        assert dumped["raw_config"] == {"command": "echo", "x": 1}


class TestParserCapturesRawConfig:
    """Parser must populate raw_config with the verbatim inner JSON object."""

    def _parse(self, mcp_servers_dict: dict, source: str = "global"):
        from copilot_console.app.services.mcp_service import MCPService

        svc = MCPService()
        return svc._parse_mcp_servers_from_json({"mcpServers": mcp_servers_dict}, source)

    def test_local_server_raw_config_captured(self):
        config = {
            "fs": {
                "type": "stdio",
                "command": "/usr/bin/mcp-fs",
                "args": ["--root", "/tmp"],
                "env": {"DEBUG": "1"},
                "tools": ["*"],
            }
        }
        servers = self._parse(config)
        assert len(servers) == 1
        assert servers[0].raw_config == config["fs"]

    def test_remote_server_raw_config_captured(self):
        config = {
            "bluebird": {
                "type": "http",
                "url": "https://example.com/mcp",
                "headers": {"X-Foo": "bar"},
                "tools": ["*"],
            }
        }
        servers = self._parse(config)
        assert servers[0].raw_config == config["bluebird"]

    def test_unknown_fields_preserved_in_raw_config(self):
        """The whole point: parser drops unknown fields from typed model
        but raw_config keeps them for the JSON-first editor to round-trip."""
        config = {
            "exotic": {
                "type": "http",
                "url": "https://example.com/mcp",
                "experimentalRetryPolicy": {"backoff": "exp", "maxAttempts": 5},
                "futureField": True,
                "comment": "set by ops 2026-04",
            }
        }
        servers = self._parse(config)
        assert servers[0].raw_config["experimentalRetryPolicy"] == {
            "backoff": "exp",
            "maxAttempts": 5,
        }
        assert servers[0].raw_config["futureField"] is True
        assert servers[0].raw_config["comment"] == "set by ops 2026-04"

    def test_raw_config_is_independent_copy(self):
        """Mutating the input dict after parse must not affect the captured snapshot."""
        config = {
            "fs": {
                "command": "/usr/bin/mcp-fs",
                "args": ["--root", "/tmp"],
                "env": {"DEBUG": "1"},
            }
        }
        servers = self._parse(config)
        # Mutate the original dict
        config["fs"]["args"].append("--extra")
        config["fs"]["env"]["NEW"] = "added"

        # Snapshot should be unchanged
        assert servers[0].raw_config["args"] == ["--root", "/tmp"]
        assert servers[0].raw_config["env"] == {"DEBUG": "1"}

    def test_round_trip_via_json(self):
        """raw_config survives JSON serialization through model_dump."""
        config = {
            "x": {
                "type": "stdio",
                "command": "echo",
                "args": [],
                "customMetadata": {"owner": "team-x", "version": 2},
            }
        }
        servers = self._parse(config)
        dumped = servers[0].model_dump()
        # Re-serialize and re-load to prove the snapshot is JSON-safe
        round_tripped = json.loads(json.dumps(dumped["raw_config"]))
        assert round_tripped == config["x"]


class TestBackwardCompatPreservedSourceField:
    """The existing `source: str` contract with the FE must not regress."""

    def test_source_field_still_populated_with_plain_string(self):
        from copilot_console.app.services.mcp_service import MCPService

        svc = MCPService()
        servers = svc._parse_mcp_servers_from_json(
            {"mcpServers": {"x": {"command": "echo", "args": []}}},
            "agent-only",
        )
        # FE compares server.source === 'agent-only' literally
        assert servers[0].source == "agent-only"
        assert isinstance(servers[0].source, str)
