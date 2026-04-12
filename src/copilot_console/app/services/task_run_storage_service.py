"""Task run storage service for persisting task execution history.

Stores task runs as JSON files organized by date:
  ~/.copilot-console/task-runs/{YYYY-MM-DD}/{run-id}.json
  ~/.copilot-console/task-runs/{YYYY-MM-DD}/{run-id}.md  (output)
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from copilot_console.app.config import TASK_RUNS_DIR, ensure_directories
from copilot_console.app.models.automation import TaskRun, TaskRunSummary
from copilot_console.app.services.storage_service import atomic_write


class TaskRunStorageService:
    """Handles task run persistence."""

    def __init__(self) -> None:
        ensure_directories()

    def _date_dir(self, dt: datetime) -> Path:
        return TASK_RUNS_DIR / dt.strftime("%Y-%m-%d")

    def _run_file(self, run: TaskRun) -> Path:
        dt = run.started_at or run.completed_at or datetime.now(timezone.utc)
        d = self._date_dir(dt)
        d.mkdir(parents=True, exist_ok=True)
        return d / f"{run.id}.json"

    def _output_file(self, run: TaskRun) -> Path:
        dt = run.started_at or run.completed_at or datetime.now(timezone.utc)
        d = self._date_dir(dt)
        d.mkdir(parents=True, exist_ok=True)
        return d / f"{run.id}.md"

    def save_run(self, run: TaskRun) -> None:
        """Save a task run to disk. Output stored separately as markdown.
        
        Cleans up stale files if the run moves to a different date directory
        (e.g., pending save was in a different dir than started save).
        """
        target = self._run_file(run)
        # Remove stale files from other date dirs (pending → running may change dirs)
        if TASK_RUNS_DIR.exists():
            for date_dir in TASK_RUNS_DIR.iterdir():
                if not date_dir.is_dir() or date_dir == target.parent:
                    continue
                stale = date_dir / f"{run.id}.json"
                if stale.exists():
                    stale.unlink()
                stale_md = date_dir / f"{run.id}.md"
                if stale_md.exists():
                    stale_md.unlink()
        data = run.model_dump(exclude={"output"})
        for key in ("started_at", "completed_at"):
            if data.get(key):
                data[key] = data[key].isoformat()
        atomic_write(self._run_file(run), json.dumps(data, indent=2, default=str))
        # Save output as separate markdown file
        if run.output:
            atomic_write(self._output_file(run), run.output)

    def load_run(self, run_id: str, date_str: str | None = None) -> TaskRun | None:
        """Load a task run by ID. If date_str not provided, searches all dates."""
        if date_str:
            dirs = [TASK_RUNS_DIR / date_str]
        else:
            dirs = sorted(TASK_RUNS_DIR.glob("*"), reverse=True) if TASK_RUNS_DIR.exists() else []

        for d in dirs:
            f = d / f"{run_id}.json"
            if f.exists():
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    # Load output from markdown file
                    output_file = d / f"{run_id}.md"
                    if output_file.exists():
                        data["output"] = output_file.read_text(encoding="utf-8")
                    return TaskRun(**data)
                except (json.JSONDecodeError, IOError, ValueError):
                    return None
        return None

    def list_runs(
        self,
        limit: int = 50,
        agent_id: str | None = None,
        automation_id: str | None = None,
        status: str | None = None,
    ) -> list[TaskRunSummary]:
        """List task runs, most recent first. Returns summaries (no output body)."""
        runs: list[TaskRunSummary] = []
        if not TASK_RUNS_DIR.exists():
            return runs

        for date_dir in sorted(TASK_RUNS_DIR.glob("*"), reverse=True):
            if not date_dir.is_dir():
                continue
            for f in date_dir.glob("*.json"):
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    if agent_id and data.get("agent_id") != agent_id:
                        continue
                    if automation_id and data.get("automation_id") != automation_id:
                        continue
                    if status and data.get("status") != status:
                        continue
                    runs.append(TaskRunSummary(**data))
                except (json.JSONDecodeError, IOError, ValueError):
                    pass

        # Sort by started_at descending (most recent first)
        runs.sort(key=lambda r: r.started_at or r.completed_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return runs[:limit]

    def delete_run(self, run_id: str) -> bool:
        """Delete a task run. Searches all date directories."""
        if not TASK_RUNS_DIR.exists():
            return False
        for date_dir in TASK_RUNS_DIR.glob("*"):
            if not date_dir.is_dir():
                continue
            f = date_dir / f"{run_id}.json"
            if f.exists():
                f.unlink()
                # Also delete output file
                output_f = date_dir / f"{run_id}.md"
                if output_f.exists():
                    output_f.unlink()
                return True
        return False


# Singleton instance
task_run_storage_service = TaskRunStorageService()
