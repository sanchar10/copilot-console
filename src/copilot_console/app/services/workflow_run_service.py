"""Workflow run service for managing WorkflowRun lifecycle.

Stores workflow runs as JSON files:
  ~/.copilot-console/workflow-runs/{run-id}.json          (completed/failed/pending)
  ~/.copilot-console/workflow-runs/running/{run-id}.json  (in-progress)
  ~/.copilot-console/workflow-runs/{run-id}-output.md

In-progress runs live in a `running/` subfolder so that startup recovery
only needs to scan that single directory (not hundreds of completed runs).
"""

import json
import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from copilot_console.app.models.workflow import (
    WorkflowRun,
    WorkflowRunStatus,
    WorkflowRunSummary,
)
from copilot_console.app.services.storage_service import atomic_write
from copilot_console.app.workflow_config import WORKFLOW_RUNS_DIR, ensure_workflow_directories

logger = logging.getLogger(__name__)

# Statuses that belong in the running/ subfolder
_ACTIVE_STATUSES = {WorkflowRunStatus.RUNNING, WorkflowRunStatus.PAUSED}


class WorkflowRunService:
    """Handles WorkflowRun persistence and lifecycle."""

    def __init__(self) -> None:
        ensure_workflow_directories()
        # Recover any runs left in running/ from a previous crash
        recovered = self.recover_zombie_runs()
        if recovered:
            logger.info(f"Recovered {recovered} zombie workflow run(s) from previous crash")

    @property
    def _running_dir(self) -> Path:
        d = WORKFLOW_RUNS_DIR / "running"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _run_file(self, run_id: str) -> Path:
        WORKFLOW_RUNS_DIR.mkdir(parents=True, exist_ok=True)
        return WORKFLOW_RUNS_DIR / f"{run_id}.json"

    def _running_file(self, run_id: str) -> Path:
        return self._running_dir / f"{run_id}.json"

    def _output_file(self, run_id: str) -> Path:
        WORKFLOW_RUNS_DIR.mkdir(parents=True, exist_ok=True)
        return WORKFLOW_RUNS_DIR / f"{run_id}-output.md"

    def _serialize_run(self, run: WorkflowRun) -> str:
        data = run.model_dump(exclude={"node_results"})
        for key in ("started_at", "completed_at"):
            if data.get(key):
                data[key] = data[key].isoformat()
        data["node_results"] = run.node_results
        return json.dumps(data, indent=2, default=str)

    def create_run(self, workflow_id: str, workflow_name: str, input_params: dict | None = None) -> WorkflowRun:
        """Create a new pending workflow run."""
        run = WorkflowRun(
            id=uuid.uuid4().hex[:16],
            workflow_id=workflow_id,
            workflow_name=workflow_name,
            status=WorkflowRunStatus.PENDING,
            input=input_params,
            started_at=datetime.now(timezone.utc),
        )
        self.save_run(run)
        return run

    def mark_running(self, run: WorkflowRun) -> WorkflowRun:
        """Mark a run as running — moves JSON to running/ subfolder."""
        # Remove from main dir if it exists (from PENDING state)
        main_f = self._run_file(run.id)
        if main_f.exists():
            main_f.unlink()

        run.status = WorkflowRunStatus.RUNNING
        if not run.started_at:
            run.started_at = datetime.now(timezone.utc)
        self._save_to(self._running_file(run.id), run)
        return run

    def mark_completed(self, run: WorkflowRun, node_results: dict | None = None, events: list[dict] | None = None) -> WorkflowRun:
        """Mark a run as completed — moves JSON from running/ to main dir."""
        run.status = WorkflowRunStatus.COMPLETED
        run.completed_at = datetime.now(timezone.utc)
        if run.started_at:
            run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        if node_results:
            run.node_results = node_results
        if events is not None:
            run.events = events
        self._move_to_main(run)
        return run

    def mark_failed(self, run: WorkflowRun, error: str, node_results: dict | None = None, events: list[dict] | None = None) -> WorkflowRun:
        """Mark a run as failed — moves JSON from running/ to main dir."""
        run.status = WorkflowRunStatus.FAILED
        run.completed_at = datetime.now(timezone.utc)
        run.error = error
        if run.started_at:
            run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        if node_results:
            run.node_results = node_results
        if events is not None:
            run.events = events
        self._move_to_main(run)
        return run

    def mark_paused(self, run: WorkflowRun) -> WorkflowRun:
        """Mark a run as paused (e.g. waiting for human input)."""
        run.status = WorkflowRunStatus.PAUSED
        self.save_run(run)
        return run

    def mark_aborted(self, run: WorkflowRun, node_results: dict | None = None, events: list[dict] | None = None) -> WorkflowRun:
        """Mark a run as aborted (force-cancelled by user) — moves JSON from running/ to main dir."""
        run.status = WorkflowRunStatus.ABORTED
        run.completed_at = datetime.now(timezone.utc)
        if run.started_at:
            run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        if node_results:
            run.node_results = node_results
        if events is not None:
            run.events = events
        self._move_to_main(run)
        return run

    def _move_to_main(self, run: WorkflowRun) -> None:
        """Remove from running/ and save to main dir."""
        running_f = self._running_file(run.id)
        if running_f.exists():
            running_f.unlink()
        self._save_to(self._run_file(run.id), run)

    def _save_to(self, target: Path, run: WorkflowRun) -> None:
        atomic_write(target, self._serialize_run(run))

    def save_run(self, run: WorkflowRun) -> None:
        """Save a workflow run to the appropriate location based on status."""
        if run.status in _ACTIVE_STATUSES:
            self._save_to(self._running_file(run.id), run)
        else:
            self._save_to(self._run_file(run.id), run)

    def load_run(self, run_id: str) -> WorkflowRun | None:
        """Load a workflow run by ID (checks running/, main dir, then legacy)."""
        # Check running/ first
        running_f = self._running_file(run_id)
        if running_f.exists():
            return self._load_from(running_f)

        # Check main dir
        f = self._run_file(run_id)
        if f.exists():
            return self._load_from(f)

        # Fallback: legacy date-based dirs
        return self._load_run_legacy(run_id)

    def _load_from(self, path: Path) -> WorkflowRun | None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return WorkflowRun(**data)
        except (json.JSONDecodeError, IOError, ValueError):
            return None

    def _load_run_legacy(self, run_id: str) -> WorkflowRun | None:
        """Load from legacy date-based directories."""
        if not WORKFLOW_RUNS_DIR.exists():
            return None
        for date_dir in sorted(WORKFLOW_RUNS_DIR.glob("*"), reverse=True):
            if not date_dir.is_dir() or date_dir.name == "running":
                continue
            f = date_dir / f"{run_id}.json"
            if f.exists():
                return self._load_from(f)
        return None

    def list_runs(
        self,
        limit: int = 50,
        workflow_id: str | None = None,
        status: str | None = None,
    ) -> list[WorkflowRunSummary]:
        """List workflow runs, most recent first."""
        runs: list[WorkflowRunSummary] = []
        if not WORKFLOW_RUNS_DIR.exists():
            return runs

        def _scan_dir(directory: Path) -> None:
            for f in directory.glob("*.json"):
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    if workflow_id and data.get("workflow_id") != workflow_id:
                        continue
                    if status and data.get("status") != status:
                        continue
                    data.pop("node_results", None)
                    runs.append(WorkflowRunSummary(**data))
                except (json.JSONDecodeError, IOError, ValueError):
                    pass

        # Main dir (flat files)
        _scan_dir(WORKFLOW_RUNS_DIR)

        # Running subfolder
        _scan_dir(self._running_dir)

        # Legacy: date-based subdirectories (skip running/)
        for date_dir in WORKFLOW_RUNS_DIR.iterdir():
            if not date_dir.is_dir() or date_dir.name == "running":
                continue
            _scan_dir(date_dir)

        runs.sort(key=lambda r: r.started_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return runs[:limit]

    def delete_run(self, run_id: str) -> WorkflowRun | None:
        """Delete a workflow run. Returns the run data (with session IDs) or None if not found.

        Caller is responsible for cleaning up Copilot sessions using
        the returned run's copilot_session_ids.
        """
        run = self.load_run(run_id)
        if not run:
            return None

        # Delete from all possible locations
        for f in (self._run_file(run_id), self._running_file(run_id), self._output_file(run_id)):
            if f.exists():
                f.unlink()

        # Delete default working directory if it exists (created when no CWD specified)
        default_cwd = WORKFLOW_RUNS_DIR / run_id
        if default_cwd.is_dir():
            shutil.rmtree(default_cwd, ignore_errors=True)

        # Legacy: check date-based dirs too
        if WORKFLOW_RUNS_DIR.exists():
            for date_dir in WORKFLOW_RUNS_DIR.iterdir():
                if not date_dir.is_dir() or date_dir.name == "running":
                    continue
                for name in (f"{run_id}.json", f"{run_id}-output.md"):
                    legacy_f = date_dir / name
                    if legacy_f.exists():
                        legacy_f.unlink()

        return run

    def recover_zombie_runs(self) -> int:
        """Mark any runs left in running/ as failed (server crash recovery).

        Called once at startup. Returns count of recovered runs.
        """
        running_dir = self._running_dir
        count = 0
        for f in running_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                run = WorkflowRun(**data)
                logger.warning(
                    f"Recovering zombie run '{run.id}' (was {run.status}) — marking as failed"
                )
                run.status = WorkflowRunStatus.FAILED
                run.completed_at = datetime.now(timezone.utc)
                run.error = "Server terminated unexpectedly"
                if run.started_at:
                    run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
                # Move to main dir
                self._save_to(self._run_file(run.id), run)
                f.unlink()
                count += 1
            except Exception as e:
                logger.error(f"Failed to recover zombie run from {f}: {e}")
        return count


# Singleton instance
workflow_run_service = WorkflowRunService()
