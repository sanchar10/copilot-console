"""Session models."""

from datetime import datetime

from pydantic import BaseModel, Field

from copilot_console.app.models.agent import AgentTools


class SessionBase(BaseModel):
    """Base session fields."""

    session_name: str = Field(default="New Session")
    model: str
    reasoning_effort: str | None = Field(default=None, description="Reasoning effort level (low/medium/high/xhigh) for models that support it")
    cwd: str | None = Field(default=None, description="Working directory for this session")
    mcp_servers: list[str] = Field(
        default_factory=list,
        description="List of enabled MCP server names"
    )
    tools: AgentTools = Field(
        default_factory=AgentTools,
        description="Tool selections: custom (local) and builtin (SDK) tool names"
    )
    system_message: dict | None = Field(
        default=None,
        description="Custom system prompt: {mode: 'replace'|'append', content: str}. None = SDK default."
    )
    name_set: bool = Field(
        default=False,
        description="Whether the user explicitly set the session name. "
        "If False, the name will be auto-updated from SDK summary after first response."
    )
    sub_agents: list[str] = Field(
        default_factory=list,
        description="List of sub-agent IDs enabled for this session (Agent Teams)"
    )
    # Reference fields (informational only, no behavioral impact)
    agent_id: str | None = Field(default=None, description="Agent ID this session was created from (reference only)")
    trigger: str | None = Field(default=None, description="How this session was triggered: 'manual', 'automation', or null for regular chat")


class SessionCreate(BaseModel):
    """Request to create a new session."""

    model: str
    reasoning_effort: str | None = None
    name: str | None = None
    cwd: str | None = None
    mcp_servers: list[str] | None = None
    tools: AgentTools | None = None
    system_message: dict | None = None
    sub_agents: list[str] | None = None
    agent_id: str | None = None
    trigger: str | None = None


class SessionUpdate(BaseModel):
    """Request to update a session."""

    name: str | None = None
    cwd: str | None = None
    mcp_servers: list[str] | None = None
    tools: AgentTools | None = None
    system_message: dict | None = None
    sub_agents: list[str] | None = None


class ModeSetRequest(BaseModel):
    """Request to set the agent mode for a session."""
    mode: str = Field(description="Agent mode: 'interactive', 'plan', or 'autopilot'")


class Session(SessionBase):
    """Full session model."""

    session_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SessionWithMessages(Session):
    """Session with message history."""

    messages: list["Message"] = Field(default_factory=list)


from copilot_console.app.models.message import Message  # noqa: E402

SessionWithMessages.model_rebuild()
