"""Workflow models for the workflow orchestration engine.

A workflow is an AF-native YAML definition + metadata. The YAML is the source of truth
for the workflow graph; we only store metadata (name, description, id) alongside it.

WorkflowRun tracks execution of a workflow instance.
"""

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class WorkflowRunStatus(str, Enum):
    """Status of a workflow run."""
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    ABORTED = "aborted"


class WorkflowMetadata(BaseModel):
    """Metadata stored alongside the YAML definition."""
    id: str = Field(..., description="Unique workflow ID (UUID)")
    name: str = Field(..., description="Display name")
    description: str = Field(default="", description="What this workflow does")
    yaml_filename: str = Field(..., description="Filename of the YAML definition (e.g. 'content-pipeline.yaml')")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # Capability hints (computed at response time, not persisted to disk)
    uses_powerfx: bool = Field(default=False, description="YAML contains =expressions")
    powerfx_available: bool = Field(default=True, description="Server can evaluate PowerFx expressions")


class WorkflowCreate(BaseModel):
    """Request to create a workflow."""
    name: str
    description: str = ""
    yaml_content: str = Field(..., description="AF-native YAML content")


class WorkflowUpdate(BaseModel):
    """Request to update a workflow. All fields optional."""
    name: str | None = None
    description: str | None = None
    yaml_content: str | None = None


class WorkflowDetail(BaseModel):
    """Workflow metadata + YAML content for API responses."""
    id: str
    name: str
    description: str
    yaml_content: str
    created_at: datetime
    updated_at: datetime


class WorkflowRun(BaseModel):
    """A single execution of a workflow."""
    id: str = Field(..., description="Unique run ID (UUID)")
    workflow_id: str = Field(..., description="Source workflow")
    workflow_name: str = Field(default="", description="Workflow name snapshot")
    status: WorkflowRunStatus = Field(default=WorkflowRunStatus.PENDING)
    input: dict | None = Field(default=None, description="Input parameters")
    started_at: datetime | None = Field(default=None)
    completed_at: datetime | None = Field(default=None)
    duration_seconds: float | None = Field(default=None)
    node_results: dict = Field(default_factory=dict, description="{node_id: {status, output, ...}}")
    events: list[dict] = Field(default_factory=list, description="Full event stream for replay")
    error: str | None = Field(default=None, description="Error message if failed")
    session_id: str | None = Field(default=None, description="AF session for as_agent() resumption")
    copilot_session_ids: list[str] = Field(default_factory=list, description="Copilot SDK session IDs for cleanup")


class WorkflowRunSummary(BaseModel):
    """Lightweight workflow run for listing (no node_results body)."""
    id: str
    workflow_id: str
    workflow_name: str
    status: WorkflowRunStatus
    input: dict | None
    started_at: datetime | None
    completed_at: datetime | None
    duration_seconds: float | None
    error: str | None
    session_id: str | None = None
