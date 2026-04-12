"""Agent storage service for CRUD operations on agent definitions.

Stores agent definitions as JSON files in ~/.copilot-console/agents/.
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from copilot_console.app.config import AGENTS_DIR, ensure_directories
from copilot_console.app.models.agent import Agent, AgentCreate, AgentUpdate
from copilot_console.app.services.storage_service import atomic_write

if TYPE_CHECKING:
    from copilot_console.app.services.mcp_service import MCPService


class AgentStorageService:
    """Handles agent definition persistence."""

    def __init__(self) -> None:
        ensure_directories()

    def _agent_file(self, agent_id: str) -> Path:
        return AGENTS_DIR / f"{agent_id}.json"

    def _generate_id(self, name: str) -> str:
        """Generate a URL-safe slug from agent name."""
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        if not slug:
            slug = "agent"
        # Ensure uniqueness
        candidate = slug
        counter = 1
        while self._agent_file(candidate).exists():
            candidate = f"{slug}-{counter}"
            counter += 1
        return candidate

    def save_agent(self, agent: Agent) -> None:
        """Save an agent definition to disk."""
        data = agent.model_dump()
        data["created_at"] = agent.created_at.isoformat()
        data["updated_at"] = agent.updated_at.isoformat()
        atomic_write(
            self._agent_file(agent.id),
            json.dumps(data, indent=2, default=str),
        )

    def _ensure_id(self, data: dict, agent_file: Path) -> dict:
        """Ensure agent data has an 'id' field, deriving from filename if missing."""
        if "id" not in data:
            data["id"] = agent_file.stem
        return data

    def load_agent(self, agent_id: str) -> Agent | None:
        """Load an agent definition by ID."""
        agent_file = self._agent_file(agent_id)
        if not agent_file.exists():
            return None
        try:
            data = json.loads(agent_file.read_text(encoding="utf-8"))
            self._ensure_id(data, agent_file)
            return Agent(**data)
        except (json.JSONDecodeError, IOError, ValueError):
            return None

    def list_agents(self) -> list[Agent]:
        """List all agent definitions."""
        agents = []
        if AGENTS_DIR.exists():
            for agent_file in sorted(AGENTS_DIR.glob("*.json")):
                try:
                    data = json.loads(agent_file.read_text(encoding="utf-8"))
                    self._ensure_id(data, agent_file)
                    agents.append(Agent(**data))
                except (json.JSONDecodeError, IOError, ValueError):
                    pass
        return agents

    def create_agent(self, request: AgentCreate) -> Agent:
        """Create a new agent definition."""
        agent_id = self._generate_id(request.name)
        now = datetime.now(timezone.utc)
        agent = Agent(
            id=agent_id,
            created_at=now,
            updated_at=now,
            **request.model_dump(),
        )
        self.save_agent(agent)
        return agent

    def update_agent(self, agent_id: str, request: AgentUpdate) -> Agent | None:
        """Update an existing agent definition. Returns None if not found."""
        agent = self.load_agent(agent_id)
        if not agent:
            return None

        update_data = request.model_dump(exclude_unset=True)
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        # Re-validate to properly coerce nested models (SystemMessage, AgentTools)
        merged = {**agent.model_dump(), **update_data}
        agent = Agent.model_validate(merged)

        self.save_agent(agent)
        return agent

    def delete_agent(self, agent_id: str) -> bool:
        """Delete an agent definition. Returns True if deleted."""
        agent_file = self._agent_file(agent_id)
        if not agent_file.exists():
            return False
        agent_file.unlink()
        return True

    def get_eligible_sub_agents(self, exclude_agent_id: str | None = None) -> list[Agent]:
        """Return agents eligible to be used as sub-agents.
        
        Eligibility rules:
        1. No custom tools (SDK limitation)
        2. No excluded built-in tools (SDK limitation)
        3. No sub-agents of its own (no nesting)
        4. Not the excluded agent (self-reference prevention)
        5. Has non-empty system_message content (required as prompt)
        6. Has non-empty description (required for auto-dispatch)
        """
        all_agents = self.list_agents()
        eligible = []
        for agent in all_agents:
            if exclude_agent_id and agent.id == exclude_agent_id:
                continue
            if agent.tools.custom:
                continue
            if agent.tools.excluded_builtin:
                continue
            if agent.sub_agents:
                continue
            if not agent.system_message.content:
                continue
            if not agent.description:
                continue
            eligible.append(agent)
        return eligible

    def validate_sub_agents(self, sub_agent_ids: list[str], exclude_agent_id: str | None = None) -> list[str]:
        """Validate that all sub-agent IDs are eligible. Returns list of error messages."""
        errors = []
        eligible_ids = {a.id for a in self.get_eligible_sub_agents(exclude_agent_id)}
        for agent_id in sub_agent_ids:
            if agent_id not in eligible_ids:
                agent = self.load_agent(agent_id)
                if not agent:
                    errors.append(f"Sub-agent '{agent_id}' not found")
                elif agent.tools.custom:
                    errors.append(f"Sub-agent '{agent.name}' has custom tools (not supported)")
                elif agent.tools.excluded_builtin:
                    errors.append(f"Sub-agent '{agent.name}' has excluded built-in tools (not supported)")
                elif agent.sub_agents:
                    errors.append(f"Sub-agent '{agent.name}' has its own sub-agents (nesting not supported)")
                elif not agent.system_message.content:
                    errors.append(f"Sub-agent '{agent.name}' has no prompt (system message required)")
                elif not agent.description:
                    errors.append(f"Sub-agent '{agent.name}' has no description (required for auto-dispatch)")
                elif exclude_agent_id and agent_id == exclude_agent_id:
                    errors.append(f"Sub-agent '{agent.name}' cannot be its own sub-agent")
                else:
                    errors.append(f"Sub-agent '{agent_id}' is not eligible")
        return errors

    def convert_to_sdk_custom_agents(
        self, sub_agent_ids: list[str], mcp_service: "MCPService"
    ) -> list[dict]:
        """Convert agent IDs to SDK CustomAgentConfig dicts.
        
        Returns list of dicts ready for session_opts["custom_agents"].
        """
        sdk_agents = []
        for agent_id in sub_agent_ids:
            agent = self.load_agent(agent_id)
            if not agent:
                continue
            sdk_agent: dict = {
                "name": agent.id,
                "display_name": agent.name,
                "description": agent.description,
                "prompt": agent.system_message.content,
                "infer": True,
            }
            if agent.tools.builtin:
                sdk_agent["tools"] = agent.tools.builtin
            if agent.mcp_servers:
                resolved = mcp_service.get_servers_for_sdk(agent.mcp_servers)
                if resolved:
                    sdk_agent["mcp_servers"] = resolved
            sdk_agents.append(sdk_agent)
        return sdk_agents


# Singleton instance
agent_storage_service = AgentStorageService()
