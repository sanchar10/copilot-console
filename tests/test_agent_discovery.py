"""Tests for the unified agent discovery service."""

import os
import tempfile
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from copilot_console.app.services.agent_discovery_service import (
    parse_md_agent,
    parse_console_agent,
    parse_prefixed_id,
    discover_all_agents,
    resolve_selected_agents,
    validate_selected_agents,
    get_stale_cwd_agents,
    DiscoveredAgent,
    COPILOT_GLOBAL,
    GITHUB_GLOBAL,
    GITHUB_CWD,
    CONSOLE_GLOBAL,
)


# --- Helpers ---

def _write_agent_md(directory: str, filename: str, content: str) -> str:
    """Write an agent MD file and return its path."""
    os.makedirs(directory, exist_ok=True)
    filepath = os.path.join(directory, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    return filepath


def _make_console_agent(**kwargs):
    """Create a mock Agent object for console agent tests."""
    agent = MagicMock()
    agent.id = kwargs.get("id", "test-agent")
    agent.name = kwargs.get("name", "Test Agent")
    agent.description = kwargs.get("description", "A test agent")
    agent.system_message.content = kwargs.get("prompt", "You are a test agent.")
    agent.tools.builtin = kwargs.get("builtin_tools", [])
    agent.mcp_servers = kwargs.get("mcp_servers", [])
    return agent


# --- parse_md_agent tests ---

class TestParseMdAgent:
    def test_basic_agent_file(self, tmp_path):
        content = """---
name: travel-advisor
description: A travel assistant
tools: ["execute"]
---

# Travel Advisor

You are a travel advisor.
"""
        filepath = _write_agent_md(str(tmp_path), "travel-advisor.md", content)
        agent = parse_md_agent(filepath, COPILOT_GLOBAL)

        assert agent is not None
        assert agent.name == "travel-advisor"
        assert agent.display_name == "travel-advisor"
        assert agent.description == "A travel assistant"
        assert agent.tools == ["execute"]
        assert "You are a travel advisor." in agent.prompt
        assert agent.source_type == COPILOT_GLOBAL
        assert agent.prefixed_id == "copilot:travel-advisor"

    def test_agent_md_extension(self, tmp_path):
        content = """---
description: A security agent
---

You check for vulnerabilities.
"""
        filepath = _write_agent_md(str(tmp_path), "security-auditor.agent.md", content)
        agent = parse_md_agent(filepath, GITHUB_GLOBAL)

        assert agent is not None
        assert agent.name == "security-auditor"
        assert agent.source_type == GITHUB_GLOBAL
        assert agent.prefixed_id == "github:security-auditor"

    def test_name_from_frontmatter_overrides_filename(self, tmp_path):
        content = """---
name: custom-name
description: Overridden name
---

Body content.
"""
        filepath = _write_agent_md(str(tmp_path), "filename-name.md", content)
        agent = parse_md_agent(filepath, COPILOT_GLOBAL)

        assert agent is not None
        assert agent.name == "custom-name"

    def test_tools_single_quotes(self, tmp_path):
        content = """---
name: tools-test
description: Test tools
tools: ['shell', 'read', 'search', 'edit']
---

Body.
"""
        filepath = _write_agent_md(str(tmp_path), "tools-test.md", content)
        agent = parse_md_agent(filepath, COPILOT_GLOBAL)

        assert agent is not None
        assert agent.tools == ["shell", "read", "search", "edit"]

    def test_no_tools(self, tmp_path):
        content = """---
name: no-tools
description: No tools defined
---

Body.
"""
        filepath = _write_agent_md(str(tmp_path), "no-tools.md", content)
        agent = parse_md_agent(filepath, COPILOT_GLOBAL)

        assert agent is not None
        assert agent.tools == []

    def test_missing_frontmatter_returns_none(self, tmp_path):
        content = "Just some content without frontmatter."
        filepath = _write_agent_md(str(tmp_path), "bad.md", content)
        agent = parse_md_agent(filepath, COPILOT_GLOBAL)
        assert agent is None

    def test_empty_body_returns_none(self, tmp_path):
        content = """---
name: empty-body
description: No body
---
"""
        filepath = _write_agent_md(str(tmp_path), "empty-body.md", content)
        agent = parse_md_agent(filepath, COPILOT_GLOBAL)
        assert agent is None

    def test_missing_description_still_parses(self, tmp_path):
        content = """---
name: no-desc
---

Body content here.
"""
        filepath = _write_agent_md(str(tmp_path), "no-desc.md", content)
        agent = parse_md_agent(filepath, COPILOT_GLOBAL)

        assert agent is not None
        assert agent.description == ""
        assert agent.prompt == "Body content here."

    def test_multiline_description(self, tmp_path):
        content = """---
name: ralph-runner
description: >
  Dispatch batch jobs via ralph. Use for starting jobs
  and processing backlogs.
---

You dispatch jobs.
"""
        filepath = _write_agent_md(str(tmp_path), "ralph-runner.md", content)
        agent = parse_md_agent(filepath, COPILOT_GLOBAL)

        assert agent is not None
        assert "Dispatch batch jobs" in agent.description

    def test_quoted_description(self, tmp_path):
        content = '''---
description: "A quoted description with special chars: [test]"
name: quoted
---

Body.
'''
        filepath = _write_agent_md(str(tmp_path), "quoted.md", content)
        agent = parse_md_agent(filepath, COPILOT_GLOBAL)

        assert agent is not None
        assert "A quoted description with special chars: [test]" in agent.description

    def test_nonexistent_file_returns_none(self):
        agent = parse_md_agent("/nonexistent/path.md", COPILOT_GLOBAL)
        assert agent is None


# --- parse_console_agent tests ---

class TestParseConsoleAgent:
    def test_basic_console_agent(self):
        agent = _make_console_agent(
            id="my-agent",
            name="My Agent",
            description="Does things",
            prompt="You do things.",
            builtin_tools=["shell", "read"],
            mcp_servers=["server1"],
        )
        da = parse_console_agent(agent)

        assert da.name == "my-agent"
        assert da.display_name == "My Agent"
        assert da.description == "Does things"
        assert da.prompt == "You do things."
        assert da.tools == ["shell", "read"]
        assert da.mcp_servers == ["server1"]
        assert da.source_type == CONSOLE_GLOBAL
        assert da.prefixed_id == "console:my-agent"

    def test_console_agent_no_tools(self):
        agent = _make_console_agent(builtin_tools=[])
        da = parse_console_agent(agent)
        assert da.tools == []


# --- parse_prefixed_id tests ---

class TestParsePrefixedId:
    def test_copilot_prefix(self):
        assert parse_prefixed_id("copilot:travel") == (COPILOT_GLOBAL, "travel")

    def test_github_prefix(self):
        assert parse_prefixed_id("github:auditor") == (GITHUB_GLOBAL, "auditor")

    def test_github_cwd_prefix(self):
        assert parse_prefixed_id("github-cwd:squad") == (GITHUB_CWD, "squad")

    def test_console_prefix(self):
        assert parse_prefixed_id("console:my-agent") == (CONSOLE_GLOBAL, "my-agent")

    def test_unprefixed_backward_compat(self):
        assert parse_prefixed_id("old-agent-id") == (CONSOLE_GLOBAL, "old-agent-id")

    def test_unknown_prefix_warns(self):
        source, name = parse_prefixed_id("unknown:something")
        assert source == CONSOLE_GLOBAL


# --- discover_all_agents tests ---

class TestDiscoverAllAgents:
    def test_discovers_from_all_sources(self, tmp_path):
        # Set up copilot agents
        copilot_dir = tmp_path / ".copilot" / "agents"
        _write_agent_md(str(copilot_dir), "advisor.md", """---
name: advisor
description: An advisor
---

You advise.
""")

        # Set up github global agents
        github_dir = tmp_path / ".github_global" / "agents"
        _write_agent_md(str(github_dir), "auditor.agent.md", """---
name: auditor
description: An auditor
---

You audit.
""")

        # Set up github cwd agents
        cwd = str(tmp_path / "myproject")
        cwd_agents = os.path.join(cwd, ".github", "agents")
        _write_agent_md(cwd_agents, "squad.agent.md", """---
name: squad
description: A squad agent
---

You coordinate.
""")

        # Console agents
        console_agent = _make_console_agent(id="bot", name="Bot", description="A bot", prompt="You are a bot.")

        with patch("copilot_console.app.services.agent_discovery_service.COPILOT_HOME", tmp_path / ".copilot"), \
             patch("os.path.expanduser", return_value=str(tmp_path)):
            # Patch github global path
            with patch("copilot_console.app.services.agent_discovery_service.os.path.expanduser", return_value=str(tmp_path)):
                result = discover_all_agents(cwd, console_agents=[console_agent])

        assert len(result[COPILOT_GLOBAL]) == 1
        assert result[COPILOT_GLOBAL][0].name == "advisor"

        # github_global scan depends on expanduser mock
        assert len(result[GITHUB_CWD]) == 1
        assert result[GITHUB_CWD][0].name == "squad"
        assert result[GITHUB_CWD][0].prefixed_id == "github-cwd:squad"

        assert len(result[CONSOLE_GLOBAL]) == 1
        assert result[CONSOLE_GLOBAL][0].name == "bot"

    def test_dedup_within_section(self, tmp_path):
        copilot_dir = tmp_path / ".copilot" / "agents"
        # Two files with same name in frontmatter
        _write_agent_md(str(copilot_dir), "a.md", """---
name: advisor
description: First
---

Body 1.
""")
        _write_agent_md(str(copilot_dir), "b.md", """---
name: advisor
description: Second
---

Body 2.
""")

        with patch("copilot_console.app.services.agent_discovery_service.COPILOT_HOME", tmp_path / ".copilot"):
            result = discover_all_agents("", console_agents=[])

        # Only first should be kept (alphabetical file order: a.md before b.md)
        assert len(result[COPILOT_GLOBAL]) == 1
        assert result[COPILOT_GLOBAL][0].description == "First"

    def test_empty_sources(self, tmp_path):
        with patch("copilot_console.app.services.agent_discovery_service.COPILOT_HOME", tmp_path / ".copilot"), \
             patch("copilot_console.app.services.agent_discovery_service.os.path.expanduser", return_value=str(tmp_path)):
            result = discover_all_agents(str(tmp_path), console_agents=[])

        for source_type in result:
            assert result[source_type] == []

    def test_alphabetical_sort(self, tmp_path):
        copilot_dir = tmp_path / ".copilot" / "agents"
        for name in ["zebra", "alpha", "middle"]:
            _write_agent_md(str(copilot_dir), f"{name}.md", f"""---
name: {name}
description: Agent {name}
---

Body for {name}.
""")

        with patch("copilot_console.app.services.agent_discovery_service.COPILOT_HOME", tmp_path / ".copilot"):
            result = discover_all_agents("", console_agents=[])

        names = [a.name for a in result[COPILOT_GLOBAL]]
        assert names == ["alpha", "middle", "zebra"]


# --- resolve_selected_agents tests ---

class TestResolveSelectedAgents:
    def test_resolves_mixed_sources(self, tmp_path):
        copilot_dir = tmp_path / ".copilot" / "agents"
        _write_agent_md(str(copilot_dir), "advisor.md", """---
name: advisor
description: Advises
tools: ["execute"]
---

You advise.
""")
        console_agent = _make_console_agent(id="bot", name="Bot", description="A bot", prompt="You bot.")

        with patch("copilot_console.app.services.agent_discovery_service.COPILOT_HOME", tmp_path / ".copilot"):
            sdk_agents = resolve_selected_agents(
                ["copilot:advisor", "console:bot"],
                cwd="",
                console_agents=[console_agent],
            )

        assert len(sdk_agents) == 2
        assert sdk_agents[0]["name"] == "advisor"
        assert sdk_agents[0]["tools"] == ["execute"]
        assert sdk_agents[0]["infer"] is True
        assert sdk_agents[1]["name"] == "bot"

    def test_backward_compat_unprefixed(self, tmp_path):
        console_agent = _make_console_agent(id="old-agent", name="Old", description="Old agent", prompt="Old prompt.")

        with patch("copilot_console.app.services.agent_discovery_service.COPILOT_HOME", tmp_path / ".copilot"):
            sdk_agents = resolve_selected_agents(
                ["old-agent"],  # unprefixed
                cwd="",
                console_agents=[console_agent],
            )

        assert len(sdk_agents) == 1
        assert sdk_agents[0]["name"] == "old-agent"

    def test_unknown_id_skipped(self, tmp_path):
        with patch("copilot_console.app.services.agent_discovery_service.COPILOT_HOME", tmp_path / ".copilot"):
            sdk_agents = resolve_selected_agents(
                ["copilot:nonexistent"],
                cwd="",
                console_agents=[],
            )
        assert sdk_agents == []


# --- validate_selected_agents tests ---

class TestValidateSelectedAgents:
    def test_valid_agents_no_errors(self, tmp_path):
        copilot_dir = tmp_path / ".copilot" / "agents"
        _write_agent_md(str(copilot_dir), "advisor.md", """---
name: advisor
description: Advises
---

You advise.
""")

        with patch("copilot_console.app.services.agent_discovery_service.COPILOT_HOME", tmp_path / ".copilot"):
            errors = validate_selected_agents(["copilot:advisor"], cwd="", console_agents=[])
        assert errors == []

    def test_missing_agent_returns_error(self, tmp_path):
        with patch("copilot_console.app.services.agent_discovery_service.COPILOT_HOME", tmp_path / ".copilot"):
            errors = validate_selected_agents(["copilot:missing"], cwd="", console_agents=[])
        assert len(errors) == 1
        assert "not found" in errors[0]


# --- get_stale_cwd_agents tests ---

class TestGetStaleCwdAgents:
    def test_finds_stale_agents(self, tmp_path):
        # New CWD has no agents
        new_cwd = str(tmp_path / "new-project")
        os.makedirs(new_cwd, exist_ok=True)

        stale = get_stale_cwd_agents(
            ["github-cwd:squad", "copilot:advisor", "github-cwd:reviewer"],
            new_cwd,
        )
        assert stale == ["github-cwd:squad", "github-cwd:reviewer"]

    def test_no_stale_when_agents_exist(self, tmp_path):
        new_cwd = str(tmp_path / "project")
        agents_dir = os.path.join(new_cwd, ".github", "agents")
        _write_agent_md(agents_dir, "squad.agent.md", """---
name: squad
description: Squad
---

Squad body.
""")

        stale = get_stale_cwd_agents(["github-cwd:squad"], new_cwd)
        assert stale == []

    def test_ignores_non_cwd_prefixes(self, tmp_path):
        stale = get_stale_cwd_agents(
            ["copilot:advisor", "console:bot"],
            str(tmp_path),
        )
        assert stale == []

    def test_empty_selection(self):
        assert get_stale_cwd_agents([], "/some/path") == []


# --- DiscoveredAgent methods tests ---

class TestDiscoveredAgent:
    def test_to_api_dict(self):
        agent = DiscoveredAgent(
            name="test", display_name="Test", description="Desc",
            prompt="Prompt", source_type=COPILOT_GLOBAL,
            prefixed_id="copilot:test", tools=["shell"],
        )
        d = agent.to_api_dict()
        assert d["id"] == "copilot:test"
        assert d["name"] == "test"
        assert d["source_type"] == COPILOT_GLOBAL
        assert "prompt" not in d  # API doesn't expose prompt
        assert "tools" not in d

    def test_to_sdk_dict(self):
        agent = DiscoveredAgent(
            name="test", display_name="Test", description="Desc",
            prompt="Prompt", source_type=COPILOT_GLOBAL,
            prefixed_id="copilot:test", tools=["shell"],
        )
        d = agent.to_sdk_dict()
        assert d["name"] == "test"
        assert d["prompt"] == "Prompt"
        assert d["tools"] == ["shell"]
        assert d["infer"] is True

    def test_to_sdk_dict_with_mcp(self):
        agent = DiscoveredAgent(
            name="test", display_name="Test", description="Desc",
            prompt="Prompt", source_type=CONSOLE_GLOBAL,
            prefixed_id="console:test",
        )
        mcp = {"server1": {"command": "npx", "args": ["server"]}}
        d = agent.to_sdk_dict(resolved_mcp=mcp)
        assert d["mcp_servers"] == mcp

    def test_to_sdk_dict_no_tools_omits_key(self):
        agent = DiscoveredAgent(
            name="test", display_name="Test", description="Desc",
            prompt="Prompt", source_type=COPILOT_GLOBAL,
            prefixed_id="copilot:test", tools=[],
        )
        d = agent.to_sdk_dict()
        assert "tools" not in d
