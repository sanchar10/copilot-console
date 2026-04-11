"""Unified agent discovery across all sources.

Scans 4 locations for agent definitions:
1. Copilot Global:  ~/.copilot/agents/*.md
2. GitHub Global:   ~/.github/agents/*.agent.md
3. GitHub CWD:      [cwd]/.github/agents/*.agent.md
4. Console Global:  ~/.copilot-console/agents/*.json  (rich Agent model)

Returns agents grouped by source_type for the sub-agent dropdown sections.
"""

import glob
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from copilot_console.app.config import COPILOT_HOME

if TYPE_CHECKING:
    from copilot_console.app.models.agent import Agent
    from copilot_console.app.services.mcp_service import MCPService

logger = logging.getLogger(__name__)

# Source type constants (ordered by priority: highest first)
GITHUB_CWD = "github_cwd"
CONSOLE_GLOBAL = "console_global"
COPILOT_GLOBAL = "copilot_global"
GITHUB_GLOBAL = "github_global"

SOURCE_TYPES = [GITHUB_CWD, CONSOLE_GLOBAL, COPILOT_GLOBAL, GITHUB_GLOBAL]

# Priority for dedup: lower number = higher priority
SOURCE_PRIORITY = {
    GITHUB_CWD: 0,
    CONSOLE_GLOBAL: 1,
    COPILOT_GLOBAL: 2,
    GITHUB_GLOBAL: 3,
}

# Display labels for UI sections
SOURCE_LABELS = {
    COPILOT_GLOBAL: "Copilot Global",
    GITHUB_GLOBAL: "GitHub Global",
    GITHUB_CWD: "GitHub CWD",
    CONSOLE_GLOBAL: "Console Global",
}


@dataclass
class DiscoveredAgent:
    """A discovered agent from any source, normalized to SDK-compatible format."""
    name: str
    display_name: str
    description: str
    prompt: str
    source_type: str
    prefixed_id: str
    tools: list[str] = field(default_factory=list)
    mcp_servers: list[str] = field(default_factory=list)

    def to_api_dict(self) -> dict:
        """Return a dict suitable for the discoverable API response."""
        return {
            "id": self.prefixed_id,
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "source_type": self.source_type,
        }

    def to_sdk_dict(self, resolved_mcp: dict | None = None) -> dict:
        """Return a dict suitable for SDK's CustomAgentConfig."""
        sdk: dict = {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "prompt": self.prompt,
            "infer": True,
        }
        if self.tools:
            sdk["tools"] = self.tools
        if resolved_mcp:
            sdk["mcp_servers"] = resolved_mcp
        return sdk


def _make_prefixed_id(source_type: str, name: str) -> str:
    """Create a prefixed ID like 'copilot:travel-advisor'."""
    prefix = {
        COPILOT_GLOBAL: "copilot",
        GITHUB_GLOBAL: "github",
        GITHUB_CWD: "github-cwd",
        CONSOLE_GLOBAL: "console",
    }[source_type]
    return f"{prefix}:{name}"


def parse_prefixed_id(prefixed_id: str) -> tuple[str, str]:
    """Parse 'prefix:name' into (source_type, name).
    
    Unprefixed IDs are treated as console: for backward compatibility.
    """
    if ":" not in prefixed_id:
        return CONSOLE_GLOBAL, prefixed_id

    prefix, name = prefixed_id.split(":", 1)
    source_map = {
        "copilot": COPILOT_GLOBAL,
        "github": GITHUB_GLOBAL,
        "github-cwd": GITHUB_CWD,
        "console": CONSOLE_GLOBAL,
    }
    source_type = source_map.get(prefix)
    if source_type is None:
        logger.warning(f"Unknown agent prefix '{prefix}' in '{prefixed_id}', treating as console")
        return CONSOLE_GLOBAL, prefixed_id
    return source_type, name


def parse_md_agent(filepath: str, source_type: str) -> DiscoveredAgent | None:
    """Parse a .md or .agent.md file into a DiscoveredAgent.
    
    Expects YAML frontmatter with at least a description.
    Name is taken from frontmatter 'name:' field or derived from filename.
    Tools are parsed from frontmatter 'tools:' field (YAML list).
    Body content after frontmatter is used as the prompt.
    """
    basename = os.path.basename(filepath)
    # Strip both .agent.md and .md extensions for filename-derived name
    filename_name = basename
    if filename_name.endswith(".agent.md"):
        filename_name = filename_name[:-len(".agent.md")]
    elif filename_name.endswith(".md"):
        filename_name = filename_name[:-len(".md")]

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        logger.warning(f"Failed to read agent file {filepath}: {e}")
        return None

    # Parse YAML frontmatter (---\n...\n---)
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", content, re.DOTALL)
    if not match:
        logger.warning(f"Agent file {filepath} has no YAML frontmatter, skipping")
        return None

    fm_text = match.group(1)
    body = content[match.end():].strip()

    # Parse frontmatter fields (simple line-based, no full YAML dependency)
    fm: dict[str, str] = {}
    current_key = ""
    current_value_lines: list[str] = []

    def _flush():
        if current_key:
            fm[current_key] = "\n".join(current_value_lines).strip()

    for line in fm_text.split("\n"):
        # Check for a new key: line
        key_match = re.match(r"^(\w[\w_-]*)\s*:\s*(.*)", line)
        if key_match:
            _flush()
            current_key = key_match.group(1)
            current_value_lines = [key_match.group(2)]
        else:
            # Continuation line (for multiline values like description: >)
            current_value_lines.append(line)
    _flush()

    # Extract fields
    name = fm.get("name", "").strip().strip('"').strip("'") or filename_name
    description = fm.get("description", "").strip().strip('"').strip("'")
    # Handle multiline descriptions (YAML > or |)
    if description.startswith(">") or description.startswith("|"):
        description = description[1:].strip()

    # Parse tools — handles both ["a", "b"] and ['a', 'b'] YAML-style lists
    tools: list[str] = []
    tools_raw = fm.get("tools", "").strip()
    if tools_raw:
        # Match items in brackets: ["a", "b"] or ['a', 'b']
        items = re.findall(r"""['"]([^'"]+)['"]""", tools_raw)
        if items:
            tools = items

    if not body:
        logger.warning(f"Agent file {filepath} has no body content (prompt), skipping")
        return None

    if not description:
        logger.debug(f"Agent file {filepath} has no description")

    prefixed_id = _make_prefixed_id(source_type, name)

    return DiscoveredAgent(
        name=name,
        display_name=name,
        description=description,
        prompt=body,
        source_type=source_type,
        prefixed_id=prefixed_id,
        tools=tools,
    )


def parse_console_agent(agent: "Agent") -> DiscoveredAgent:
    """Convert a Console Agent (JSON) into a DiscoveredAgent."""
    tools = agent.tools.builtin if agent.tools.builtin else []
    return DiscoveredAgent(
        name=agent.id,
        display_name=agent.name,
        description=agent.description,
        prompt=agent.system_message.content,
        source_type=CONSOLE_GLOBAL,
        prefixed_id=_make_prefixed_id(CONSOLE_GLOBAL, agent.id),
        tools=tools,
        mcp_servers=agent.mcp_servers,
    )


def _scan_md_dir(directory: str, source_type: str, pattern: str) -> list[DiscoveredAgent]:
    """Scan a directory for MD agent files and return parsed agents."""
    agents: list[DiscoveredAgent] = []
    if not os.path.isdir(directory):
        return agents
    
    seen_names: set[str] = set()
    for filepath in sorted(glob.glob(os.path.join(directory, pattern))):
        agent = parse_md_agent(filepath, source_type)
        if agent and agent.name not in seen_names:
            agents.append(agent)
            seen_names.add(agent.name)
        elif agent:
            logger.debug(f"Duplicate agent name '{agent.name}' in {directory}, skipping {filepath}")
    return agents


def discover_all_agents(
    cwd: str,
    console_agents: list["Agent"] | None = None,
) -> dict[str, list[DiscoveredAgent]]:
    """Discover agents from all 4 sources, grouped by source_type.
    
    Args:
        cwd: Working directory for GitHub CWD agents.
        console_agents: Pre-loaded console agents (from AgentStorageService).
                       If None, console_global section will be empty.
    
    Returns:
        Dict with keys: copilot_global, github_global, github_cwd, console_global.
        Each value is a sorted list of DiscoveredAgent.
    """
    result: dict[str, list[DiscoveredAgent]] = {st: [] for st in SOURCE_TYPES}

    # 1. Copilot Global: ~/.copilot/agents/*.md
    copilot_dir = str(COPILOT_HOME / "agents")
    result[COPILOT_GLOBAL] = _scan_md_dir(copilot_dir, COPILOT_GLOBAL, "*.md")

    # 2. GitHub Global: ~/.github/agents/*.agent.md
    github_global_dir = os.path.join(os.path.expanduser("~"), ".github", "agents")
    result[GITHUB_GLOBAL] = _scan_md_dir(github_global_dir, GITHUB_GLOBAL, "*.agent.md")

    # 3. GitHub CWD: [cwd]/.github/agents/*.agent.md
    if cwd:
        github_cwd_dir = os.path.join(cwd, ".github", "agents")
        result[GITHUB_CWD] = _scan_md_dir(github_cwd_dir, GITHUB_CWD, "*.agent.md")

    # 4. Console Global: from pre-loaded Agent objects (eligible sub-agents only)
    if console_agents:
        seen: set[str] = set()
        for agent in console_agents:
            da = parse_console_agent(agent)
            if da.name not in seen:
                result[CONSOLE_GLOBAL].append(da)
                seen.add(da.name)

    # Sort each section alphabetically by display_name
    for source_type in SOURCE_TYPES:
        result[source_type].sort(key=lambda a: a.display_name.lower())

    total = sum(len(v) for v in result.values())
    logger.debug(f"Discovered {total} agents across {sum(1 for v in result.values() if v)} sources (cwd={cwd})")

    return result


def resolve_selected_agents(
    prefixed_ids: list[str],
    cwd: str,
    mcp_service: "MCPService | None" = None,
    console_agents: list["Agent"] | None = None,
) -> list[dict]:
    """Convert prefixed agent IDs to SDK CustomAgentConfig dicts.
    
    Discovers all agents, looks up each selected ID, and returns
    SDK-ready dicts. Unknown IDs are logged and skipped.
    """
    if not prefixed_ids:
        return []

    # Build a lookup from all discovered agents
    all_agents = discover_all_agents(cwd, console_agents)
    lookup: dict[str, DiscoveredAgent] = {}
    for agents in all_agents.values():
        for agent in agents:
            lookup[agent.prefixed_id] = agent

    sdk_agents: list[dict] = []
    seen_names: dict[str, int] = {}  # name -> priority of kept agent
    pending: list[tuple[int, DiscoveredAgent]] = []  # collect all, then sort by priority

    for pid in prefixed_ids:
        agent = lookup.get(pid)
        if not agent:
            if ":" not in pid:
                agent = lookup.get(f"console:{pid}")
            if not agent:
                logger.warning(f"Selected agent '{pid}' not found in any source, skipping")
                continue
        priority = SOURCE_PRIORITY.get(agent.source_type, 99)
        pending.append((priority, agent))

    # Sort by priority (lowest number = highest priority) so higher-priority wins dedup
    pending.sort(key=lambda x: x[0])

    for priority, agent in pending:
        if agent.name in seen_names:
            logger.debug(f"Skipping lower-priority duplicate '{agent.name}' from {agent.prefixed_id}")
            continue
        seen_names[agent.name] = priority

        # Resolve MCP servers for console agents
        resolved_mcp = None
        if agent.mcp_servers and mcp_service:
            resolved_mcp = mcp_service.get_servers_for_sdk(agent.mcp_servers)

        sdk_agents.append(agent.to_sdk_dict(resolved_mcp))

    return sdk_agents


def validate_selected_agents(
    prefixed_ids: list[str],
    cwd: str,
    console_agents: list["Agent"] | None = None,
    exclude_agent_id: str | None = None,
) -> list[str]:
    """Validate that all selected agent IDs are resolvable. Returns list of error messages."""
    if not prefixed_ids:
        return []

    all_agents = discover_all_agents(cwd, console_agents)
    lookup: dict[str, DiscoveredAgent] = {}
    for agents in all_agents.values():
        for agent in agents:
            lookup[agent.prefixed_id] = agent

    errors: list[str] = []
    for pid in prefixed_ids:
        # Skip self-reference check for console agents
        source_type, name = parse_prefixed_id(pid)
        if source_type == CONSOLE_GLOBAL and exclude_agent_id and name == exclude_agent_id:
            errors.append(f"Agent '{name}' cannot be its own sub-agent")
            continue

        agent = lookup.get(pid)
        # Backward compat
        if not agent and ":" not in pid:
            agent = lookup.get(f"console:{pid}")
        if not agent:
            errors.append(f"Agent '{pid}' not found")

    return errors


def get_stale_cwd_agents(
    prefixed_ids: list[str],
    new_cwd: str,
) -> list[str]:
    """Find github-cwd: agents that don't exist in the new CWD.
    
    Returns list of prefixed IDs that would become invalid after a CWD change.
    """
    stale: list[str] = []
    if not prefixed_ids:
        return stale

    # Check what agents exist in the new CWD
    github_cwd_dir = os.path.join(new_cwd, ".github", "agents")
    available_names: set[str] = set()
    if os.path.isdir(github_cwd_dir):
        for filepath in glob.glob(os.path.join(github_cwd_dir, "*.agent.md")):
            basename = os.path.basename(filepath)
            name = basename.replace(".agent.md", "")
            available_names.add(name)

    for pid in prefixed_ids:
        source_type, name = parse_prefixed_id(pid)
        if source_type == GITHUB_CWD and name not in available_names:
            stale.append(pid)

    return stale
