"""Workflow API routes — CRUD, execution, visualization, run management.

Endpoints:
  POST   /api/workflows              — Create workflow
  GET    /api/workflows              — List all workflows
  GET    /api/workflows/{id}         — Get workflow detail (metadata + YAML content)
  PUT    /api/workflows/{id}         — Update workflow (YAML + metadata)
  DELETE /api/workflows/{id}         — Delete workflow
  POST   /api/workflows/{id}/run     — Execute workflow (returns run_id, starts execution)
  GET    /api/workflows/{id}/visualize — Get Mermaid diagram string
  GET    /api/workflows/{id}/runs    — List runs for this workflow
  GET    /api/workflow-runs/{run_id} — Get run detail (status, node results)
  POST   /api/workflow-runs/{run_id}/input — Send human input (approval/data)
  GET    /api/workflow-runs/{run_id}/stream — SSE stream for run events
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from copilot_console.app.models.workflow import (
    WorkflowCreate,
    WorkflowDetail,
    WorkflowMetadata,
    WorkflowRunStatus,
    WorkflowUpdate,
)
from copilot_console.app.services.workflow_engine import workflow_engine
from copilot_console.app.services.workflow_run_service import workflow_run_service
from copilot_console.app.services.workflow_storage_service import workflow_storage_service

logger = logging.getLogger(__name__)

# In-memory tracking of active workflow runs
# {run_id: {"events": [...], "status": "running"|"completed"|"failed", "pending_input": {...}|None}}
_active_runs: dict[str, dict] = {}

router = APIRouter(tags=["workflows"])


# ---------------------------------------------------------------------------
# Workflow CRUD
# ---------------------------------------------------------------------------

@router.post("/workflows", response_model=WorkflowMetadata)
async def create_workflow(request: WorkflowCreate) -> WorkflowMetadata:
    """Create a new workflow (YAML + metadata)."""
    # Validate YAML by attempting to load it
    validation = workflow_engine.validate_yaml(request.yaml_content)
    if not validation["valid"]:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {validation['error']}")
    return workflow_storage_service.create_workflow(request)


@router.get("/workflows", response_model=list[WorkflowMetadata])
async def list_workflows() -> list[WorkflowMetadata]:
    """List all workflow definitions."""
    return workflow_storage_service.list_workflows()


@router.get("/workflows/{workflow_id}", response_model=WorkflowDetail)
async def get_workflow(workflow_id: str) -> WorkflowDetail:
    """Get workflow detail (metadata + YAML content)."""
    detail = workflow_storage_service.get_workflow(workflow_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return detail


@router.put("/workflows/{workflow_id}", response_model=WorkflowMetadata)
async def update_workflow(workflow_id: str, request: WorkflowUpdate) -> WorkflowMetadata:
    """Update a workflow (YAML + metadata)."""
    if request.yaml_content is not None:
        validation = workflow_engine.validate_yaml(request.yaml_content)
        if not validation["valid"]:
            raise HTTPException(status_code=400, detail=f"Invalid YAML: {validation['error']}")
    result = workflow_storage_service.update_workflow(workflow_id, request)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@router.delete("/workflows/{workflow_id}")
async def delete_workflow(workflow_id: str) -> dict:
    """Delete a workflow and its YAML + metadata."""
    if not workflow_storage_service.delete_workflow(workflow_id):
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Visualization
# ---------------------------------------------------------------------------

@router.get("/workflows/{workflow_id}/visualize")
async def visualize_workflow(workflow_id: str) -> dict:
    """Get Mermaid diagram for a workflow."""
    yaml_content = workflow_storage_service.get_yaml_content(workflow_id)
    if yaml_content is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    result = workflow_engine.validate_yaml(yaml_content)
    if not result["valid"]:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {result['error']}")
    return {"mermaid": result["mermaid"]}


# ---------------------------------------------------------------------------
# Workflow Execution
# ---------------------------------------------------------------------------

class WorkflowRunRequest(BaseModel):
    """Request to execute a workflow."""
    message: str | None = None
    input_params: dict | None = None
    cwd: str | None = None


@router.post("/workflows/{workflow_id}/run")
async def run_workflow(workflow_id: str, request: WorkflowRunRequest | None = None) -> dict:
    """Execute a workflow. Returns run_id for tracking.

    Starts execution in background — use GET /workflow-runs/{run_id}/stream for SSE events.
    """
    detail = workflow_storage_service.get_workflow(workflow_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Create run record
    input_data = (request.input_params if request else None) or (
        {"message": request.message} if request and request.message else None
    )
    run = workflow_run_service.create_run(workflow_id, detail.name, input_data)

    # Initialize active run tracking
    _active_runs[run.id] = {
        "events": [],
        "status": "running",
        "pending_input": None,
    }

    # Start execution in background
    asyncio.create_task(_execute_workflow(run.id, detail.yaml_content, request))

    return {"run_id": run.id, "status": "started"}


async def _execute_workflow(
    run_id: str,
    yaml_content: str,
    request: WorkflowRunRequest | None,
) -> None:
    """Background task: execute workflow and collect events."""
    run = workflow_run_service.load_run(run_id)
    if not run:
        return

    run = workflow_run_service.mark_running(run)
    active = _active_runs.get(run_id)
    if not active:
        return

    run_agents: dict = {}

    try:
        workflow = workflow_engine.load_from_yaml_string(yaml_content)

        # Snapshot agents for this run — sync_agents_from_library() on the
        # singleton may replace _agents during execution (e.g. editor preview).
        # Keep a local reference so we collect session IDs from the right objects.
        run_agents = dict(workflow_engine._agents)

        # Set working directory for all agents in this run
        cwd = (request.cwd if request else None) or _default_workflow_cwd(run_id)
        os.makedirs(cwd, exist_ok=True)
        workflow_engine.set_working_directory(cwd)

        # Emit start event
        active["events"].append({
            "type": "workflow_started",
            "run_id": run_id,
            "workflow_name": run.workflow_name,
        })

        node_results = {}

        # Build input: prefer input_params, fall back to message, then "start"
        run_input = None
        if request:
            run_input = request.input_params or ({"message": request.message} if request.message else None)

        # Use workflow.run() for streaming events (oneshot path)
        async for event in workflow_engine.run_oneshot(workflow, run_input):
            event_data = _serialize_workflow_event(event, run_id)
            active["events"].append(event_data)

            # Track node results from executor events
            executor_id = getattr(event, "executor_id", None)
            if not executor_id:
                try:
                    executor_id = event.source_executor_id
                except (RuntimeError, AttributeError):
                    executor_id = None
            if executor_id:
                event_type = event_data.get("type", "")
                if event_type == "executor_invoked":
                    node_results[executor_id] = {"status": "running", "started_at": event_data.get("timestamp")}
                elif event_type == "executor_completed":
                    if executor_id in node_results:
                        node_results[executor_id]["status"] = "completed"
                        node_results[executor_id]["output"] = event_data.get("output")
                    # Persist session IDs incrementally for crash recovery
                    run.copilot_session_ids = [
                        sid for a in run_agents.values() for sid in a._session_ids
                    ]
                    workflow_run_service.save_run(run)
                elif event_type == "executor_failed":
                    if executor_id in node_results:
                        node_results[executor_id]["status"] = "failed"
                        node_results[executor_id]["error"] = event_data.get("error")

            # Check for human input requests
            if event_data.get("type") == "request_info":
                active["pending_input"] = {
                    "request_id": event_data.get("request_id"),
                    "data": event_data.get("data"),
                }
                active["status"] = "paused"
                workflow_run_service.mark_paused(run)

        # Append a completion event so history view matches live SSE view
        active["events"].append({
            "type": "run_complete",
            "run_id": run_id,
            "status": "completed",
        })
        active["status"] = "completed"
        workflow_run_service.mark_completed(run, node_results, events=active["events"])

    except Exception as e:
        logger.error(f"Workflow run {run_id} failed: {e}", exc_info=True)
        active["status"] = "failed"
        active["events"].append({"type": "workflow_failed", "run_id": run_id, "error": str(e)})
        workflow_run_service.mark_failed(run, str(e), events=active["events"])
    finally:
        # Final session ID persist — collect from snapshot, not singleton
        run = workflow_run_service.load_run(run_id)
        if run:
            run.copilot_session_ids = [
                sid for a in run_agents.values() for sid in a._session_ids
            ]
            workflow_run_service.save_run(run)

        # Stop agents from the snapshot to destroy sessions and kill CLI processes
        for name, agent in run_agents.items():
            try:
                await agent.stop()
            except Exception as e:
                logger.warning(f"Failed to stop agent '{name}': {e}")

        # Remove from active tracking
        _active_runs.pop(run_id, None)


def _default_workflow_cwd(run_id: str) -> str:
    """Default working directory for workflow runs."""
    return str(Path.home() / ".copilot-console" / "workflow-runs" / run_id)


def _serialize_event_data(data) -> str | dict | list | None:
    """Recursively serialize AF event data to JSON-safe types.

    Handles ActionComplete, Pydantic models, lists/tuples, and plain types.
    """
    if data is None:
        return None
    if isinstance(data, str):
        return data.strip()
    if isinstance(data, (int, float, bool)):
        return data

    # AF ActionComplete — extract its .result
    if hasattr(data, "result") and type(data).__name__ == "ActionComplete":
        inner = _serialize_event_data(data.result)
        return inner if inner is not None else "(action completed)"

    # Pydantic models
    if hasattr(data, "model_dump"):
        try:
            return data.model_dump()
        except Exception:
            pass

    # Lists / tuples — serialize each element, skip ActionComplete wrappers
    if isinstance(data, (list, tuple)):
        items = [_serialize_event_data(item) for item in data]
        # Filter out bare ActionComplete markers, keep meaningful content
        meaningful = [i for i in items if i is not None and i != "(action completed)"]
        if len(meaningful) == 1:
            return meaningful[0]
        return meaningful if meaningful else None

    # Dicts
    if isinstance(data, dict):
        return {str(k): _serialize_event_data(v) for k, v in data.items()}

    # Fallback — avoid raw repr of SDK objects
    s = str(data)
    if "object at 0x" in s:
        return f"({type(data).__name__})"
    return s


def _serialize_workflow_event(event, run_id: str) -> dict:
    """Convert AF WorkflowEvent to a JSON-serializable dict.

    AF WorkflowEvent uses Python properties that raise RuntimeError when accessed
    on the wrong event type. getattr() does NOT catch property exceptions, so we
    must use explicit try/except for every field.
    """
    result: dict = {"run_id": run_id}

    # Extract event type — the only universally safe attribute
    try:
        result["type"] = event.type
    except Exception:
        pass

    # Direct attributes (safe on all event types)
    if getattr(event, "executor_id", None) is not None:
        result["executor_id"] = event.executor_id

    if getattr(event, "iteration", None) is not None:
        result["iteration"] = event.iteration

    # State (for status events) — extract enum value name for readability
    state = getattr(event, "state", None)
    if state is not None:
        state_str = str(state)
        # AF enums serialize as "WorkflowRunState.IDLE" — extract just the value
        if "." in state_str:
            state_str = state_str.rsplit(".", 1)[-1].lower()
        result["state"] = state_str

    # Error details (for failed events)
    details = getattr(event, "details", None)
    if details is not None:
        result["error_type"] = getattr(details, "error_type", None)
        result["error_message"] = getattr(details, "message", None)
        result["error_executor_id"] = getattr(details, "executor_id", None)

    # Data payload — serialize safely
    event_data = getattr(event, "data", None)
    if event_data is not None:
        result["data"] = _serialize_event_data(event_data)

    # Property-gated fields (raise RuntimeError on wrong event type)
    for attr, key in [
        ("request_type", "request_type"),
        ("source_executor_id", "source_executor_id"),
        ("request_id", "request_id"),
    ]:
        try:
            val = getattr(event, attr)
            if val is not None:
                result[key] = str(val)
        except (RuntimeError, AttributeError):
            pass

    return result


# ---------------------------------------------------------------------------
# Run Management
# ---------------------------------------------------------------------------

@router.get("/workflows/{workflow_id}/runs")
async def list_workflow_runs(workflow_id: str, limit: int = 50, status: str | None = None):
    """List runs for a specific workflow."""
    return workflow_run_service.list_runs(limit=limit, workflow_id=workflow_id, status=status)


@router.get("/workflow-runs/{run_id}")
async def get_workflow_run(run_id: str):
    """Get a workflow run detail (status, node results)."""
    run = workflow_run_service.load_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return run


@router.delete("/workflow-runs/{run_id}")
async def delete_workflow_run(run_id: str) -> dict:
    """Delete a workflow run and its associated Copilot sessions.

    Refuses to delete active (running/paused) runs — abort first.
    """
    from copilot_console.app.services.copilot_service import copilot_service
    from copilot_console.app.services.storage_service import storage_service

    # Guard: refuse delete on active runs
    if run_id in _active_runs and _active_runs[run_id]["status"] in ("running", "paused"):
        raise HTTPException(
            status_code=409,
            detail="Cannot delete an active run. Abort it first."
        )

    run = workflow_run_service.delete_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    # Clean up associated Copilot sessions:
    #   copilot_service.delete_session → SDK destroy + ~/.copilot/session-state/{id}/
    #   storage_service.delete_session → ~/.copilot-console/sessions/{id}/
    for sid in run.copilot_session_ids:
        try:
            await copilot_service.delete_session(sid)
        except Exception as e:
            logger.warning(f"Failed to clean up Copilot session {sid}: {e}")
        try:
            storage_service.delete_session(sid)
        except Exception as e:
            logger.warning(f"Failed to clean up session storage {sid}: {e}")
        # Clean up viewed and completion timestamps
        try:
            from copilot_console.app.services.viewed_service import viewed_service
            from copilot_console.app.services.completion_times_service import completion_times_service
            viewed_service.remove(sid)
            completion_times_service.remove(sid)
        except Exception:
            pass

    return {"deleted": True}


class HumanInputRequest(BaseModel):
    """Human input response for a paused workflow."""
    request_id: str
    data: dict | str | bool


@router.post("/workflow-runs/{run_id}/input")
async def send_human_input(run_id: str, request: HumanInputRequest) -> dict:
    """Send human input (approval/data) to a paused workflow run."""
    active = _active_runs.get(run_id)
    if not active:
        raise HTTPException(status_code=404, detail="Active workflow run not found")
    if active["status"] != "paused":
        raise HTTPException(status_code=400, detail=f"Run is not paused (status: {active['status']})")
    if not active.get("pending_input"):
        raise HTTPException(status_code=400, detail="No pending input request")

    # Store the response — the workflow execution loop will pick it up
    active["pending_input"]["response"] = request.data
    active["status"] = "running"
    active["events"].append({
        "type": "human_input_received",
        "run_id": run_id,
        "request_id": request.request_id,
    })

    return {"ok": True, "status": "resumed"}


@router.get("/workflow-runs/{run_id}/stream")
async def stream_workflow_run(run_id: str, from_event: int = 0) -> EventSourceResponse:
    """SSE stream for workflow run events. Reconnectable via from_event param."""

    async def generate_events() -> AsyncGenerator[dict, None]:
        event_idx = from_event
        idle_count = 0
        terminal_types = {"run_complete", "workflow_completed", "workflow_failed"}

        try:
            while True:
                active = _active_runs.get(run_id)

                if active is None:
                    # Run not active — replay stored events for reconnection
                    run = workflow_run_service.load_run(run_id)
                    if not run:
                        yield {
                            "event": "error",
                            "data": json.dumps({"error": "Run not found"}),
                        }
                        return

                    # Send any stored events the client hasn't seen
                    if run.events:
                        for i, ev in enumerate(run.events):
                            if i < event_idx:
                                continue
                            yield {
                                "event": "workflow_event",
                                "data": json.dumps(ev, default=str),
                                "id": str(i),
                            }
                            if ev.get("type") in terminal_types:
                                return

                    # No terminal event in stored events — synthesize one
                    yield {
                        "event": "workflow_event",
                        "data": json.dumps({
                            "type": "run_complete",
                            "run_id": run_id,
                            "status": run.status.value,
                        }),
                    }
                    return

                # Drain new events from the active run
                while event_idx < len(active["events"]):
                    event = active["events"][event_idx]
                    yield {
                        "event": "workflow_event",
                        "data": json.dumps(event, default=str),
                        "id": str(event_idx),
                    }
                    event_idx += 1
                    idle_count = 0

                    # Terminal event drained — we're done
                    if event.get("type") in terminal_types:
                        _active_runs.pop(run_id, None)
                        return

                if active["status"] == "paused" and active.get("pending_input"):
                    yield {
                        "event": "human_input_required",
                        "data": json.dumps({
                            "type": "human_input_required",
                            "run_id": run_id,
                            "request_id": active["pending_input"].get("request_id"),
                            "data": active["pending_input"].get("data"),
                        }, default=str),
                    }

                await asyncio.sleep(0.5)
                idle_count += 1

                # Send keepalive every 15 seconds
                if idle_count % 30 == 0:
                    yield {"event": "keepalive", "data": ""}

        except asyncio.CancelledError:
            logger.info(f"[SSE] Workflow run stream disconnected: {run_id}")

    return EventSourceResponse(generate_events())
