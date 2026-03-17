"""Task run API routes."""

from fastapi import APIRouter, HTTPException, Request

from copilot_console.app.services.task_run_storage_service import task_run_storage_service
from copilot_console.app.services.session_service import session_service
from copilot_console.app.services.copilot_service import copilot_service
from copilot_console.app.services.storage_service import storage_service

router = APIRouter(prefix="/task-runs", tags=["task-runs"])


@router.get("")
async def list_task_runs(
    limit: int = 50,
    agent_id: str | None = None,
    automation_id: str | None = None,
    status: str | None = None,
):
    """List task runs, most recent first."""
    return task_run_storage_service.list_runs(
        limit=limit,
        agent_id=agent_id,
        automation_id=automation_id,
        status=status,
    )


@router.get("/{run_id}")
async def get_task_run(run_id: str):
    """Get a task run by ID (includes full output)."""
    run = task_run_storage_service.load_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Task run not found")
    return run


@router.post("/{run_id}/abort")
async def abort_task_run(request: Request, run_id: str):
    """Abort a running task."""
    task_runner = request.app.state.task_runner
    if await task_runner.abort_run(run_id):
        return {"ok": True}
    raise HTTPException(status_code=404, detail="Task run not found or not running")


@router.delete("/{run_id}")
async def delete_task_run(run_id: str):
    """Delete a task run and its associated session + chat history."""
    run = task_run_storage_service.load_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Task run not found")

    # Delete the associated session (metadata + SDK session state)
    if run.session_id:
        try:
            await session_service.delete_session(run.session_id)
        except Exception:
            pass  # Session may already be gone
        # Clean up completion timestamp
        try:
            from copilot_console.app.services.completion_times_service import completion_times_service
            completion_times_service.remove(run.session_id)
        except Exception:
            pass

    # Delete the task run record
    task_run_storage_service.delete_run(run_id)
    return {"ok": True}
