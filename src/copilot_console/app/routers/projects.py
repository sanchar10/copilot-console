"""Projects router — cwd-to-project-name mapping."""

from fastapi import APIRouter
from pydantic import BaseModel

from copilot_console.app.services.project_service import (
    delete_project,
    get_projects,
    resolve_project,
    set_project,
)

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectUpdate(BaseModel):
    cwd: str
    name: str


@router.get("")
async def list_projects() -> dict:
    """Return all cwd→project name overrides."""
    return get_projects()


@router.get("/resolve")
async def resolve(cwd: str) -> dict:
    """Resolve a project name for a given cwd."""
    return {"cwd": cwd, "name": resolve_project(cwd)}


@router.put("")
async def upsert_project(body: ProjectUpdate) -> dict:
    """Set or update a project name for a cwd."""
    mapping = set_project(body.cwd, body.name)
    return mapping


@router.delete("")
async def remove_project(cwd: str) -> dict:
    """Remove a project name override (reverts to folder name)."""
    mapping = delete_project(cwd)
    return mapping
