"""Project service — lightweight cwd-to-project-name mapping."""

import json
from pathlib import Path, PurePosixPath, PureWindowsPath

from copilot_console.app.config import PROJECTS_FILE


def _normalize_cwd(cwd: str) -> str:
    """Normalize path: lowercase, forward slashes, no trailing slash."""
    return cwd.replace("\\", "/").rstrip("/").lower()


def _folder_name(cwd: str) -> str:
    """Extract last folder segment from a path."""
    # Handle both Windows and POSIX paths
    for cls in (PureWindowsPath, PurePosixPath):
        try:
            return cls(cwd).name or cwd
        except Exception:
            continue
    return cwd.rsplit("/", 1)[-1].rsplit("\\", 1)[-1] or cwd


def _load_projects() -> dict[str, str]:
    """Load cwd→name overrides from projects.json."""
    if PROJECTS_FILE.exists():
        try:
            return json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_projects(mapping: dict[str, str]) -> None:
    """Persist cwd→name overrides to projects.json."""
    PROJECTS_FILE.write_text(json.dumps(mapping, indent=2), encoding="utf-8")


def get_projects() -> dict[str, str]:
    """Return all cwd→name overrides."""
    return _load_projects()


def resolve_project(cwd: str) -> str:
    """Resolve a project name for a cwd.

    Returns the user-defined override if one exists,
    otherwise the last folder segment of the path.
    """
    if not cwd:
        return ""
    mapping = _load_projects()
    norm = _normalize_cwd(cwd)
    # Check exact match (normalized)
    for stored_cwd, name in mapping.items():
        if _normalize_cwd(stored_cwd) == norm:
            return name
    return _folder_name(cwd)


def set_project(cwd: str, name: str) -> dict[str, str]:
    """Set or update a project name for a cwd. Returns updated mapping."""
    mapping = _load_projects()
    # Remove any existing entry with same normalized path
    norm = _normalize_cwd(cwd)
    mapping = {k: v for k, v in mapping.items() if _normalize_cwd(k) != norm}
    mapping[cwd] = name
    _save_projects(mapping)
    return mapping


def delete_project(cwd: str) -> dict[str, str]:
    """Remove a project name override. Returns updated mapping."""
    mapping = _load_projects()
    norm = _normalize_cwd(cwd)
    mapping = {k: v for k, v in mapping.items() if _normalize_cwd(k) != norm}
    _save_projects(mapping)
    return mapping
