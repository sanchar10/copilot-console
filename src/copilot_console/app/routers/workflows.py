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
from copilot_console.app.services import workflow_engine as workflow_engine_module
from copilot_console.app.services.workflow_run_service import workflow_run_service
from copilot_console.app.services.workflow_storage_service import workflow_storage_service

logger = logging.getLogger(__name__)

# In-memory tracking of active workflow runs
# {run_id: {"events": [...], "status": "running"|"completed"|"failed", "pending_input": {...}|None}}
_active_runs: dict[str, dict] = {}


def _emit_status_change(active: dict, run, new_status: WorkflowRunStatus) -> None:
    """Centralized status transition: persist + broadcast.

    Updates the in-memory active dict, persists the run via the appropriate
    mark_X helper, and appends a status_changed event to the active event log
    so SSE consumers (frontend status badge) receive a real-time signal for
    every transition — not just terminal ones. Terminal transitions
    (completed/failed) are NOT funneled through here because they already
    carry node_results/events via mark_completed/mark_failed and trigger a
    frontend refetch via terminal SSE events.

    Caller is responsible for ordering: emit BEFORE popping `active` from
    `_active_runs`, so any open SSE viewer drains the event.
    """
    if new_status == WorkflowRunStatus.RUNNING:
        workflow_run_service.mark_running(run)
    elif new_status == WorkflowRunStatus.PAUSED:
        workflow_run_service.mark_paused(run)
    elif new_status == WorkflowRunStatus.ABORTED:
        workflow_run_service.mark_aborted(run)
    else:  # pragma: no cover — terminal transitions go through mark_completed/failed
        return

    status_str = new_status.value
    active["status"] = status_str
    active["events"].append({
        "type": "status_changed",
        "run_id": run.id,
        "status": status_str,
    })

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
    meta = workflow_storage_service.create_workflow(request)
    meta.uses_powerfx = workflow_engine_module._yaml_uses_expressions(request.yaml_content)
    meta.powerfx_available = workflow_engine_module.POWERFX_AVAILABLE
    return meta


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
    yaml_for_check = request.yaml_content
    if yaml_for_check is None:
        yaml_for_check = workflow_storage_service.get_yaml_content(workflow_id) or ""
    result.uses_powerfx = workflow_engine_module._yaml_uses_expressions(yaml_for_check)
    result.powerfx_available = workflow_engine_module.POWERFX_AVAILABLE
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
async def visualize_workflow(workflow_id: str, raw: bool = False) -> dict:
    """Get Mermaid diagram for a workflow.

    By default returns the YAML-overlay diagram (Phase 4) which surfaces
    declarative semantics — diamonds for ``If``/``Switch``/``ConditionGroup``,
    subgraphs for ``Foreach``/``RepeatUntil``/``TryCatch``. Pass ``?raw=true``
    to get AF's built-in mermaid (handy for debugging diagram drift).
    """
    yaml_content = workflow_storage_service.get_yaml_content(workflow_id)
    if yaml_content is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if raw:
        result = workflow_engine.validate_yaml(yaml_content, block_powerfx=True)
        if not result["valid"]:
            raise HTTPException(status_code=400, detail=f"Invalid YAML: {result['error']}")
        return {"mermaid": result["mermaid"]}
    # Overlay path doesn't need a successful Workflow build — pure YAML walk.
    return {"mermaid": workflow_engine.visualize_overlay(yaml_content)}


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
        "handle": None,
        "task": None,
    }

    # Start execution in background — store the task so we can force-abort on delete
    task = asyncio.create_task(_execute_workflow(run.id, detail.yaml_content, request))
    _active_runs[run.id]["task"] = task

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

    active = _active_runs.get(run_id)
    if not active:
        return
    _emit_status_change(active, run, WorkflowRunStatus.RUNNING)

    run_agents: dict = {}

    try:
        workflow = workflow_engine.load_from_yaml_string(yaml_content)

        # Snapshot agents for this run — sync_agents_from_library() on the
        # singleton may replace _agents during execution (e.g. editor preview).
        # Keep a local reference so we collect session IDs from the right objects.
        run_agents = dict(workflow_engine._agents)

        # Map InvokeAzureAgent.id -> agent.name (walks nested If/Switch/TryCatch
        # actions). Used to attribute Copilot session_ids back to the right
        # agent for per-node "Open session" buttons in the live view.
        executor_to_agent = workflow_engine.extract_executor_to_agent(yaml_content)
        # agent_name -> count of executor_completed/failed seen so far.
        # Each InvokeAzureAgent invocation creates one new Copilot session
        # (AF doesn't pass session= to agent.run), so the i-th completion for
        # agent X corresponds to agent._session_ids[i].
        agent_invocation_counts: dict[str, int] = {}

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

        # Start the run with HITL support — RunHandle owns the live workflow
        # across pause/resume boundaries.
        handle = await workflow_engine.start_run(workflow, run_input)
        active["handle"] = handle

        async for event in handle.events():
            event_data = _serialize_workflow_event(event, run_id)

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
                elif event_type in ("executor_completed", "executor_failed"):
                    # Attribute Copilot session_id created during this invocation
                    # back onto the event so the UI can render an "Open session"
                    # button. Loop iterations get one row per invocation, each
                    # with its own session_id.
                    sid = _attach_workflow_session_id(
                        event_data,
                        executor_id,
                        executor_to_agent,
                        run_agents,
                        agent_invocation_counts,
                        run.workflow_name,
                        cwd,
                    )
                    if event_type == "executor_completed":
                        if executor_id in node_results:
                            node_results[executor_id]["status"] = "completed"
                            node_results[executor_id]["output"] = event_data.get("output")
                            if sid:
                                node_results[executor_id]["session_id"] = sid
                        # Persist session IDs incrementally for crash recovery.
                        # Reload from disk before saving — send_human_input may
                        # have flipped status PAUSED→RUNNING via a different run
                        # object, and saving our stale local `run` would clobber
                        # that transition. The fresh load picks up the current
                        # status and any other field updates.
                        fresh = workflow_run_service.load_run(run_id) or run
                        fresh.copilot_session_ids = [
                            sid for a in run_agents.values() for sid in a._session_ids
                        ]
                        workflow_run_service.save_run(fresh)
                        run = fresh
                    else:  # executor_failed
                        if executor_id in node_results:
                            node_results[executor_id]["status"] = "failed"
                            node_results[executor_id]["error"] = event_data.get("error")
                            if sid:
                                node_results[executor_id]["session_id"] = sid

            # Check for human input requests — RunHandle has paused internally
            # by the time we see this event, awaiting submit_response().
            if event_data.get("type") == "request_info":
                pending_req = handle.pending_request
                pending_input = {
                    "request_id": event_data.get("request_id"),
                    "data": event_data.get("data"),
                    "request_type": getattr(pending_req, "request_type", None) if pending_req else None,
                    "message": getattr(pending_req, "message", None) if pending_req else None,
                    "metadata": getattr(pending_req, "metadata", None) if pending_req else None,
                }
                active["pending_input"] = pending_input
                # Persist a structured human_input_required envelope into the
                # event log so reopen / history view renders the same rich
                # HumanInputRow card the live SSE shows. The raw request_info
                # event is dropped (skip the append below) — the envelope below
                # supersedes it for both UI rendering and replay.
                active["events"].append({
                    "type": "human_input_required",
                    "run_id": run_id,
                    "request_id": pending_input["request_id"],
                    "data": pending_input["data"],
                    "request_type": pending_input["request_type"],
                    "message": pending_input["message"],
                    "metadata": pending_input["metadata"],
                    "executor_id": event_data.get("executor_id") or event_data.get("source_executor_id"),
                })
                _emit_status_change(active, run, WorkflowRunStatus.PAUSED)
            else:
                active["events"].append(event_data)

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


def _attach_workflow_session_id(
    event_data: dict,
    executor_id: str,
    executor_to_agent: dict[str, str],
    run_agents: dict,
    agent_invocation_counts: dict[str, int],
    workflow_name: str,
    cwd: str,
) -> str | None:
    """For executor_completed/failed events on InvokeAzureAgent nodes, attach
    the Copilot session_id created during this invocation onto the event and
    write a session sidecar with trigger="workflow" so the sidebar hides it.

    Returns the session_id (or None if not applicable / not yet captured).
    Each invocation creates exactly one new session, so the i-th completion
    for an agent maps to agent._session_ids[i].
    """
    agent_name = executor_to_agent.get(executor_id)
    if not agent_name or agent_name not in run_agents:
        return None
    agent = run_agents[agent_name]
    idx = agent_invocation_counts.get(agent_name, 0)
    agent_invocation_counts[agent_name] = idx + 1
    session_ids = getattr(agent, "_session_ids", []) or []
    if idx >= len(session_ids):
        # Session creation may have failed before _create_session captured the
        # id (rare). Skip — UI just won't render an Open-session button.
        return None
    sid = session_ids[idx]
    event_data["session_id"] = sid

    # Write a minimal sidecar so session_service.list_sessions() reports
    # trigger="workflow" and the sidebar filter hides this session.
    try:
        from copilot_console.app.services.storage_service import storage_service
        existing = storage_service.load_session(sid) or {}
        existing.update({
            "session_id": sid,
            "session_name": existing.get("session_name") or f"{workflow_name} · {executor_id}",
            "trigger": "workflow",
            "cwd": existing.get("cwd") or cwd,
            "name_set": True,
        })
        storage_service.save_session_raw(sid, existing)
    except Exception as e:
        logger.warning(f"Failed to write workflow session sidecar for {sid}: {e}")
    return sid


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
    """List runs for a specific workflow.

    Returns {items, total} so the UI can show "Showing N of M" without
    re-fetching just to count. `total` reflects all matching runs (after
    workflow_id + status filters), regardless of limit.
    """
    # Single scan: pull everything matching the filter, then slice for items.
    # The disk scan is bounded by total run count for this workflow, which the
    # editor surfaces as the denominator anyway.
    all_matching = workflow_run_service.list_runs(
        limit=10_000, workflow_id=workflow_id, status=status,
    )
    return {"items": all_matching[:limit], "total": len(all_matching)}


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

    Active (running/paused) runs are force-aborted first: the background task
    is cancelled, its `finally` block flushes the final session_id manifest,
    and the run is marked aborted. Then per-session cleanup runs strictly —
    if any session fails to delete the run record is preserved so the user
    can retry (no orphaned sessions).
    """
    from copilot_console.app.services.copilot_service import copilot_service
    from copilot_console.app.services.storage_service import storage_service
    from copilot_console.app.services.viewed_service import viewed_service
    from copilot_console.app.services.completion_times_service import completion_times_service

    # Force-abort any active run so its background task flushes session IDs
    # via the _execute_workflow finally block before we try to clean up.
    active = _active_runs.get(run_id)
    if active and active.get("status") in ("running", "paused"):
        task = active.get("task")
        if task is not None and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(task, timeout=10)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
            except Exception as e:
                logger.warning(f"Workflow task {run_id} raised on cancel: {e}")
        # _execute_workflow's finally pops _active_runs and persists
        # copilot_session_ids; mark aborted so history reflects user intent.
        run_snapshot = workflow_run_service.load_run(run_id)
        if run_snapshot and run_snapshot.status in (WorkflowRunStatus.RUNNING, WorkflowRunStatus.PAUSED):
            # Emit through the helper while active still exists so any open
            # SSE viewer sees the transition before _active_runs.pop().
            still_active = _active_runs.get(run_id)
            if still_active is not None:
                _emit_status_change(still_active, run_snapshot, WorkflowRunStatus.ABORTED)
            else:
                workflow_run_service.mark_aborted(run_snapshot)
        _active_runs.pop(run_id, None)

    # Reload the run AFTER force-abort so we have the post-finally session manifest.
    run = workflow_run_service.load_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    # Clean up associated Copilot sessions strictly — collect failures so a
    # partial cleanup never leaves the run record gone with orphans behind.
    #   copilot_service.delete_session → SDK destroy + ~/.copilot/session-state/{id}/
    #   storage_service.delete_session → ~/.copilot-console/sessions/{id}/
    failed_sessions: list[dict] = []
    sessions_removed = 0
    for sid in run.copilot_session_ids:
        sid_failed = False
        try:
            await copilot_service.delete_session(sid)
        except Exception as e:
            logger.warning(f"Failed to delete Copilot session {sid}: {e}")
            failed_sessions.append({"session_id": sid, "stage": "copilot", "error": str(e)})
            sid_failed = True
        try:
            storage_service.delete_session(sid)
        except Exception as e:
            logger.warning(f"Failed to delete session storage {sid}: {e}")
            failed_sessions.append({"session_id": sid, "stage": "storage", "error": str(e)})
            sid_failed = True
        # Best-effort: viewed/completion timestamps are non-critical
        try:
            viewed_service.remove(sid)
            completion_times_service.remove(sid)
        except Exception:
            pass
        if not sid_failed:
            sessions_removed += 1

    if failed_sessions:
        # Preserve the run record (and its copilot_session_ids manifest) so
        # the user can retry. Surface what went wrong.
        raise HTTPException(
            status_code=500,
            detail={
                "message": (
                    f"Aborted run, but {len(failed_sessions)} associated session(s) "
                    f"failed to delete. Run record preserved — retry to remove."
                ),
                "orphaned_sessions": failed_sessions,
                "sessions_removed": sessions_removed,
            },
        )

    deleted_run = workflow_run_service.delete_run(run_id)
    if not deleted_run:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    return {"deleted": True, "sessions_removed": sessions_removed}


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
    pending = active.get("pending_input")
    if not pending:
        raise HTTPException(status_code=400, detail="No pending input request")

    handle = active.get("handle")
    if handle is None:
        raise HTTPException(status_code=500, detail="Run handle missing — cannot resume")

    # Validate request_id matches the live pending request (rejects stale /
    # double-submits before any state mutation).
    expected = handle.pending_request_id
    if expected and request.request_id != expected:
        raise HTTPException(
            status_code=400,
            detail=f"Stale request_id: expected {expected}, got {request.request_id}",
        )

    try:
        await handle.submit_response(request.request_id, request.data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Atomically clear pending state so SSE stops emitting human_input_required.
    active["pending_input"] = None
    active["events"].append({
        "type": "human_input_received",
        "run_id": run_id,
        "request_id": request.request_id,
        "data": request.data,
    })
    # Broadcast paused→running via the unified helper so the live badge flips
    # back to RUNNING for the post-resume window (instead of staying PAUSED
    # until the workflow completes).
    run = workflow_run_service.load_run(run_id)
    if run is not None:
        _emit_status_change(active, run, WorkflowRunStatus.RUNNING)

    return {"ok": True, "status": "resumed"}


@router.get("/workflow-runs/{run_id}/stream")
async def stream_workflow_run(run_id: str, from_event: int = 0) -> EventSourceResponse:
    """SSE stream for workflow run events. Reconnectable via from_event param."""

    async def generate_events() -> AsyncGenerator[dict, None]:
        event_idx = from_event
        idle_count = 0
        terminal_types = {"run_complete", "workflow_completed", "workflow_failed"}
        # On a fresh subscribe (from_event=0) the client just fetched the run
        # and already has the authoritative current status. Replaying historical
        # status_changed events would flicker the badge through stale states
        # (running→paused→running→…) before converging. Skip them in the first
        # drain only; live transitions (after first drain) and reconnects
        # (from_event>0, where the client may have missed real transitions)
        # still flow through unchanged.
        is_initial_replay = from_event == 0
        first_drain_done = False

        def _is_replay_skippable(ev: dict) -> bool:
            return (
                is_initial_replay
                and not first_drain_done
                and ev.get("type") == "status_changed"
            )

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
                            if _is_replay_skippable(ev):
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

                # Drain new events from the active run. The human_input_required
                # envelope is part of active["events"] (appended at the
                # request_info gate), so reconnects naturally re-emit it via the
                # frontend's lastEventId-based dedupe.
                while event_idx < len(active["events"]):
                    event = active["events"][event_idx]
                    current_idx = event_idx
                    event_idx += 1
                    if _is_replay_skippable(event):
                        continue
                    yield {
                        "event": "workflow_event",
                        "data": json.dumps(event, default=str),
                        "id": str(current_idx),
                    }
                    idle_count = 0

                    # Terminal event drained — we're done
                    if event.get("type") in terminal_types:
                        _active_runs.pop(run_id, None)
                        return

                # First active drain complete — subsequent transitions are live
                # and should always reach the client.
                first_drain_done = True

                await asyncio.sleep(0.5)
                idle_count += 1

                # Send keepalive every 15 seconds
                if idle_count % 30 == 0:
                    yield {"event": "keepalive", "data": ""}

        except asyncio.CancelledError:
            logger.info(f"[SSE] Workflow run stream disconnected: {run_id}")

    return EventSourceResponse(generate_events())
