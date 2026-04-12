"""Workflow storage service for CRUD operations on workflow definitions.

Single-file storage — one YAML file per workflow:
  ~/.copilot-console/workflows/{id}.yaml

The YAML ``name`` field is the workflow ID (dashed, URL-safe).
``name`` and ``description`` are parsed from the YAML on read.
Timestamps come from the filesystem (ctime / mtime).
"""

import os
import re
from datetime import datetime, timezone
from pathlib import Path

import yaml

from copilot_console.app.models.workflow import (
    WorkflowCreate,
    WorkflowDetail,
    WorkflowMetadata,
    WorkflowUpdate,
)
from copilot_console.app.services.storage_service import atomic_write
from copilot_console.app.workflow_config import WORKFLOWS_DIR, ensure_workflow_directories


class WorkflowStorageService:
    """Handles workflow definition persistence (single YAML file per workflow)."""

    def __init__(self) -> None:
        ensure_workflow_directories()

    def _yaml_file(self, workflow_id: str) -> Path:
        return WORKFLOWS_DIR / f"{workflow_id}.yaml"

    @staticmethod
    def _slugify(name: str) -> str:
        """Convert a workflow name to a URL-safe slug (the workflow ID)."""
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        return slug or "workflow"

    @staticmethod
    def _parse_yaml_header(yaml_content: str) -> tuple[str, str]:
        """Extract name and description from YAML without full parse when possible."""
        try:
            data = yaml.safe_load(yaml_content)
            if isinstance(data, dict):
                return data.get("name", ""), data.get("description", "")
        except yaml.YAMLError:
            pass
        return "", ""

    @staticmethod
    def _file_timestamps(path: Path) -> tuple[datetime, datetime]:
        """Return (created_at, updated_at) from filesystem metadata."""
        stat = path.stat()
        created = datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc)
        modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        return created, modified

    def _metadata_from_file(self, yaml_file: Path) -> WorkflowMetadata | None:
        """Build WorkflowMetadata from a YAML file on disk."""
        try:
            content = yaml_file.read_text(encoding="utf-8")
            name, description = self._parse_yaml_header(content)
            workflow_id = yaml_file.stem
            created_at, updated_at = self._file_timestamps(yaml_file)
            return WorkflowMetadata(
                id=workflow_id,
                name=name or workflow_id,
                description=description,
                yaml_filename=yaml_file.name,
                created_at=created_at,
                updated_at=updated_at,
            )
        except (IOError, OSError):
            return None

    def create_workflow(self, request: WorkflowCreate) -> WorkflowMetadata:
        """Create a new workflow. ID is derived from the YAML name field."""
        name, _ = self._parse_yaml_header(request.yaml_content)
        workflow_id = self._slugify(name or request.name)

        # Avoid overwriting an existing workflow
        yaml_file = self._yaml_file(workflow_id)
        if yaml_file.exists():
            # Append a short numeric suffix
            counter = 2
            while self._yaml_file(f"{workflow_id}-{counter}").exists():
                counter += 1
            workflow_id = f"{workflow_id}-{counter}"
            yaml_file = self._yaml_file(workflow_id)

        atomic_write(yaml_file, request.yaml_content)

        # Clean up any orphaned meta file with the same ID
        meta_file = WORKFLOWS_DIR / f"{workflow_id}.meta.json"
        if meta_file.exists():
            meta_file.unlink()

        return self._metadata_from_file(yaml_file)  # type: ignore[return-value]

    def get_workflow(self, workflow_id: str) -> WorkflowDetail | None:
        """Get workflow metadata + YAML content."""
        yaml_file = self._yaml_file(workflow_id)
        if not yaml_file.exists():
            return None

        yaml_content = yaml_file.read_text(encoding="utf-8")
        name, description = self._parse_yaml_header(yaml_content)
        created_at, updated_at = self._file_timestamps(yaml_file)

        return WorkflowDetail(
            id=workflow_id,
            name=name or workflow_id,
            description=description,
            yaml_content=yaml_content,
            created_at=created_at,
            updated_at=updated_at,
        )

    def list_workflows(self) -> list[WorkflowMetadata]:
        """List all workflows by scanning YAML files."""
        workflows: list[WorkflowMetadata] = []
        if not WORKFLOWS_DIR.exists():
            return workflows

        for yaml_file in sorted(WORKFLOWS_DIR.glob("*.yaml")):
            meta = self._metadata_from_file(yaml_file)
            if meta:
                workflows.append(meta)
        return workflows

    def update_workflow(self, workflow_id: str, request: WorkflowUpdate) -> WorkflowMetadata | None:
        """Update an existing workflow. Returns None if not found."""
        yaml_file = self._yaml_file(workflow_id)
        if not yaml_file.exists():
            return None

        if request.yaml_content is not None:
            atomic_write(yaml_file, request.yaml_content)
        else:
            # Touch the file to update mtime even for metadata-only changes
            os.utime(yaml_file)

        return self._metadata_from_file(yaml_file)

    def delete_workflow(self, workflow_id: str) -> bool:
        """Delete a workflow YAML (and any orphaned meta file). Returns True if deleted."""
        yaml_file = self._yaml_file(workflow_id)
        meta_file = WORKFLOWS_DIR / f"{workflow_id}.meta.json"

        deleted = False
        if yaml_file.exists():
            yaml_file.unlink()
            deleted = True
        if meta_file.exists():
            meta_file.unlink()
            deleted = True
        return deleted

    def get_yaml_path(self, workflow_id: str) -> Path | None:
        """Get the filesystem path to a workflow's YAML file."""
        yaml_file = self._yaml_file(workflow_id)
        return yaml_file if yaml_file.exists() else None

    def get_yaml_content(self, workflow_id: str) -> str | None:
        """Get raw YAML content for a workflow."""
        yaml_file = self._yaml_file(workflow_id)
        if not yaml_file.exists():
            return None
        return yaml_file.read_text(encoding="utf-8")


# Singleton instance
workflow_storage_service = WorkflowStorageService()
