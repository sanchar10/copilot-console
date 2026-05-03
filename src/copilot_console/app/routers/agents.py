"""Agent definition API router."""

from fastapi import APIRouter, HTTPException, Query

from copilot_console.app.models.agent import Agent, AgentCreate, AgentUpdate
from copilot_console.app.services.agent_storage_service import agent_storage_service
from copilot_console.app.services.agent_discovery_service import (
    discover_all_agents,
    get_stale_cwd_agents,
    SOURCE_LABELS,
)

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("/discoverable")
async def get_discoverable_agents(cwd: str = Query(""), exclude: str | None = None) -> dict:
    """Get all agents from all sources, grouped by source type.
    
    Returns agents suitable for the sub-agent dropdown with sections.
    Console agents are filtered for eligibility (no custom tools, no excluded_builtin, etc.).
    """
    import os
    from copilot_console.app.config import COPILOT_HOME, AGENTS_DIR
    
    # Console agents: use eligible sub-agents (same rules as before)
    console_agents = agent_storage_service.get_eligible_sub_agents(exclude_agent_id=exclude)
    
    all_agents = discover_all_agents(cwd, console_agents=console_agents)

    # Source folder paths for UI display. Use ``~``-relative form for paths
    # under the user's home directory so the UI is consistent with how MCP
    # config locations are displayed elsewhere (Settings → MCP Servers,
    # chat-header MCP picker).
    home = os.path.expanduser("~")

    def _pretty(p: str) -> str:
        if not p:
            return p
        try:
            np = os.path.normpath(p)
            nh = os.path.normpath(home)
            if np == nh:
                return "~"
            if np.lower().startswith(nh.lower() + os.sep):
                rel = np[len(nh) + 1:].replace(os.sep, "/")
                return f"~/{rel}"
        except Exception:
            pass
        return p.replace(os.sep, "/")

    source_paths = {
        "copilot_global": _pretty(str(COPILOT_HOME / "agents")),
        "github_global": _pretty(os.path.join(home, ".github", "agents")),
        "github_cwd": _pretty(os.path.join(cwd, ".github", "agents")) if cwd else "",
        "console_global": _pretty(str(AGENTS_DIR)),
    }
    
    result = {}
    for source_type, agents in all_agents.items():
        result[source_type] = {
            "label": SOURCE_LABELS[source_type],
            "path": source_paths.get(source_type, ""),
            "agents": [a.to_api_dict() for a in agents],
        }
    return result


@router.get("/stale-cwd-agents")
async def check_stale_cwd_agents(
    new_cwd: str = Query(...),
    selected: str = Query(""),
) -> dict:
    """Check if any github-cwd agents become stale when changing CWD.
    
    selected: comma-separated prefixed IDs of currently selected sub-agents.
    Returns list of stale agent IDs and their names.
    """
    prefixed_ids = [s.strip() for s in selected.split(",") if s.strip()] if selected else []
    stale = get_stale_cwd_agents(prefixed_ids, new_cwd)
    return {"stale": stale, "count": len(stale)}


@router.post("", response_model=Agent)
async def create_agent(request: AgentCreate) -> Agent:
    """Create a new agent definition."""
    return agent_storage_service.create_agent(request)


@router.get("", response_model=list[Agent])
async def list_agents() -> list[Agent]:
    """List all agent definitions."""
    return agent_storage_service.list_agents()


@router.get("/eligible-sub-agents", response_model=list[Agent])
async def get_eligible_sub_agents(exclude: str | None = None) -> list[Agent]:
    """Get agents eligible to be used as sub-agents."""
    return agent_storage_service.get_eligible_sub_agents(exclude_agent_id=exclude)


@router.get("/{agent_id}", response_model=Agent)
async def get_agent(agent_id: str) -> Agent:
    """Get an agent definition by ID."""
    agent = agent_storage_service.load_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.put("/{agent_id}", response_model=Agent)
async def update_agent(agent_id: str, request: AgentUpdate) -> Agent:
    """Update an agent definition."""
    agent = agent_storage_service.update_agent(agent_id, request)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str) -> dict:
    """Delete an agent definition."""
    if not agent_storage_service.delete_agent(agent_id):
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"deleted": True}
