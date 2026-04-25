"""MCP Server models.

Supports two server types matching the Copilot SDK:
- Local/stdio: command + args (+ optional env, cwd)
- Remote (http/sse): url (+ optional headers, OAuth client metadata)

Servers come from three pools:
- Global: ~/.copilot/mcp-config.json (shared with CLI)
- Agent-only: ~/.copilot-console/mcp-config.json (only visible to this app)
- Plugin: ~/.copilot/installed-plugins/<plugin>/.mcp.json
"""

from pydantic import BaseModel, ConfigDict, Field


class MCPServer(BaseModel):
    """MCP Server configuration — supports both local and remote servers."""

    # Allow camelCase JSON keys (oauthClientId, oauthPublicClient) to populate snake_case fields.
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(..., description="Unique name/identifier for the MCP server")
    type: str | None = Field(default=None, description="Server type: 'stdio' (local) or 'http'/'sse' (remote)")
    # Local server fields
    command: str | None = Field(default=None, description="Command to execute (local servers)")
    args: list[str] = Field(default_factory=list, description="Arguments to pass to the command")
    env: dict[str, str] | None = Field(default=None, description="Environment variables (local servers)")
    cwd: str | None = Field(default=None, description="Working directory (local servers)")
    # Remote server fields
    url: str | None = Field(default=None, description="Server URL (http/sse servers)")
    headers: dict[str, str] | None = Field(default=None, description="HTTP headers (http/sse servers)")
    # OAuth client metadata for remote servers (SDK 0.3.0+)
    oauth_client_id: str | None = Field(
        default=None,
        alias="oauthClientId",
        description="Pre-registered OAuth client ID (skips dynamic client registration)",
    )
    oauth_public_client: bool | None = Field(
        default=None,
        alias="oauthPublicClient",
        description="If true, treat OAuth client as public (no client secret)",
    )
    # Common fields
    tools: list[str] = Field(default=["*"], description="Tools to enable: ['*'] for all, [] for none, or specific names")
    timeout: int | None = Field(default=None, description="Timeout in milliseconds")
    source: str = Field(default="global", description="Where this config came from: 'global', 'agent-only', or plugin name")


class MCPServerConfig(BaseModel):
    """Collection of MCP server configurations."""

    servers: list[MCPServer] = Field(default_factory=list)


class MCPServerSelection(BaseModel):
    """User's selection of MCP servers for a session.

    Note: Session metadata only stores which servers are enabled (by name).
    The full server configuration is always loaded fresh from config files.
    """

    # Map of server name -> enabled status
    selections: dict[str, bool] = Field(default_factory=dict)

