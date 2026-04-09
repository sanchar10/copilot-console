"""Test MCP server that triggers elicitation.

Usage: Add to MCP config as a local server, then ask the agent to use the
"configure_project" tool. The tool will trigger an elicitation dialog asking
the user for project configuration via the MCP elicitation protocol.
"""

import json
from typing import Optional
from pydantic import BaseModel, Field
from mcp.server.fastmcp import FastMCP, Context

mcp = FastMCP("elicitation-test")


class ProjectConfig(BaseModel):
    database: str = Field(description="Which database engine to use", json_schema_extra={"enum": ["PostgreSQL", "MySQL", "SQLite"]})
    projectName: str = Field(description="Name of your project")
    port: int = Field(default=5432, ge=1024, le=65535, description="Port number")
    enableCaching: bool = Field(default=True, description="Enable caching")
    features: list[str] = Field(default_factory=list, description="Features to include", json_schema_extra={"items": {"enum": ["auth", "logging", "metrics", "rate-limiting"]}})


class PreferenceChoice(BaseModel):
    choice: str = Field(description="Your choice")


@mcp.tool()
async def configure_project(ctx: Context) -> str:
    """Ask the user to configure their project settings via an interactive form.
    
    This tool shows a form asking for database choice, project name, port, 
    caching preference, and feature selection. Use this when setting up a new project.
    """
    result = await ctx.elicit(
        message="Please configure your project settings:",
        schema=ProjectConfig,
    )
    
    if result.action == "accept" and result.data:
        return f"User configured project: {result.data.model_dump_json()}"
    elif result.action == "decline":
        return "User declined to configure the project."
    else:
        return "User cancelled the configuration."


@mcp.tool()
async def ask_preference(ctx: Context, question: str, options: str) -> str:
    """Ask the user to pick from a list of options.
    
    Args:
        question: The question to ask
        options: Comma-separated list of options
    """
    # For dynamic options, we create the model dynamically
    option_list = [o.strip() for o in options.split(",")]
    
    DynamicChoice = type("DynamicChoice", (BaseModel,), {
        "__annotations__": {"choice": str},
        "choice": Field(description="Your choice", json_schema_extra={"enum": option_list}),
    })
    
    result = await ctx.elicit(message=question, schema=DynamicChoice)
    
    if result.action == "accept" and result.data:
        return f"User chose: {result.data.choice}"
    return "User did not make a choice."


if __name__ == "__main__":
    mcp.run(transport="stdio")
