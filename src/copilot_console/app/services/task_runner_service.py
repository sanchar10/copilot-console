"""Task runner service for headless agent execution.

Runs agents in the background without a chat UI. Creates a proper session
(with metadata), sends a prompt, collects the full response, and records the result.
Sessions persist and can be opened in the chat UI for continuation.
"""

import asyncio
import uuid
from datetime import datetime, timezone

from copilot_console.app.models.agent import Agent
from copilot_console.app.models.automation import TaskRun, TaskRunStatus
from copilot_console.app.models.session import SessionCreate
from copilot_console.app.services.copilot_service import CopilotService
from copilot_console.app.services.response_buffer import ResponseBuffer, ResponseBufferManager, ResponseStatus
from copilot_console.app.services.task_run_storage_service import task_run_storage_service
from copilot_console.app.services.session_service import session_service
from copilot_console.app.services.mcp_service import mcp_service
from copilot_console.app.services.agent_storage_service import agent_storage_service
from copilot_console.app.services.tools_service import get_tools_service
from copilot_console.app.services.logging_service import get_logger
from copilot_console.app.config import DEFAULT_CWD

logger = get_logger(__name__)


class TaskRunnerService:
    """Executes agent runs headlessly with concurrency control."""

    def __init__(
        self,
        copilot_service: CopilotService,
        buffer_manager: ResponseBufferManager,
        max_concurrent: int = 3,
    ) -> None:
        self._copilot = copilot_service
        self._buffer_manager = buffer_manager
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._active_runs: dict[str, asyncio.Task] = {}

    async def submit_run(
        self,
        agent: Agent,
        prompt: str,
        cwd: str | None = None,
        automation_id: str | None = None,
        max_runtime_minutes: int = 10,
    ) -> TaskRun:
        """Submit a new task run. Returns the TaskRun immediately; execution is async."""
        run = TaskRun(
            id=str(uuid.uuid4())[:8],
            automation_id=automation_id,
            agent_id=agent.id,
            agent_name=agent.name,
            prompt=prompt,
            cwd=cwd or DEFAULT_CWD,
            status=TaskRunStatus.PENDING,
        )
        task_run_storage_service.save_run(run)

        task = asyncio.create_task(self._execute_run(run, agent, max_runtime_minutes))
        self._active_runs[run.id] = task
        task.add_done_callback(lambda _: self._active_runs.pop(run.id, None))

        return run

    async def _execute_run(
        self,
        run: TaskRun,
        agent: Agent,
        max_runtime_minutes: int,
    ) -> None:
        """Execute a single task run under the concurrency semaphore."""
        async with self._semaphore:
            run.status = TaskRunStatus.RUNNING
            run.started_at = datetime.now(timezone.utc)
            task_run_storage_service.save_run(run)
            logger.info(f"[task-run:{run.id}] Starting agent={agent.id} prompt={run.prompt[:80]!r}")

            # Create a proper session with metadata (trigger=automation, agent_id set)
            session_request = SessionCreate(
                model=agent.model,
                name=run.prompt[:80],
                cwd=run.cwd or DEFAULT_CWD,
                mcp_servers=agent.mcp_servers or [],
                tools=agent.tools,
                system_message=agent.system_message.model_dump() if agent.system_message and agent.system_message.content else None,
                agent_id=agent.id,
                trigger="automation",
            )
            session = await session_service.create_session(session_request)
            session_id = session.session_id
            run.session_id = session_id
            task_run_storage_service.save_run(run)

            try:
                # Resolve MCP servers from agent config
                mcp_servers_resolved = None
                if agent.mcp_servers:
                    mcp_servers_resolved = mcp_service.get_servers_for_sdk(agent.mcp_servers)

                # Resolve custom tools
                tools_resolved = None
                if agent.tools.custom:
                    ts = get_tools_service()
                    tools_resolved = ts.get_sdk_tools(agent.tools.custom)

                # Built-in tool filtering
                available_tools = agent.tools.builtin or None
                excluded_tools = agent.tools.excluded_builtin or None

                # System message
                system_message = None
                if agent.system_message and agent.system_message.content:
                    system_message = {
                        "mode": agent.system_message.mode,
                        "content": agent.system_message.content,
                    }

                # Resolve sub-agents (Agent Teams)
                custom_agents_sdk = None
                if agent.sub_agents:
                    custom_agents_sdk = agent_storage_service.convert_to_sdk_custom_agents(
                        agent.sub_agents, mcp_service
                    )

                # Create buffer for collecting response
                buffer = await self._buffer_manager.create_buffer(session_id)

                # Run with timeout
                await asyncio.wait_for(
                    self._copilot.send_message_background(
                        session_id=session_id,
                        model=agent.model,
                        cwd=run.cwd or DEFAULT_CWD,
                        prompt=run.prompt,
                        buffer=buffer,
                        mcp_servers=mcp_servers_resolved,
                        tools=tools_resolved,
                        available_tools=available_tools,
                        excluded_tools=excluded_tools,
                        system_message=system_message,
                        is_new_session=True,
                        custom_agents=custom_agents_sdk,
                    ),
                    timeout=max_runtime_minutes * 60,
                )

                # send_message_background does NOT call buffer.complete() — caller must do it
                buffer.complete()
                
                # Record server-side completion timestamp (fixes blue dot)
                from copilot_console.app.services.completion_times_service import completion_times_service
                completion_times_service.mark_completed(session_id)
                
                # Trigger delayed push notification check
                from copilot_console.app.services.notification_manager import notification_manager
                preview = buffer.get_full_content()[:120] if buffer.chunks else ""
                notification_manager.on_agent_completed(session_id, run.agent_name or session_id[:8], preview)

                # Collect result
                if buffer.status == ResponseStatus.COMPLETED:
                    run.status = TaskRunStatus.COMPLETED
                    run.output = buffer.get_full_content()
                    if buffer.usage_info:
                        run.token_usage = buffer.usage_info
                else:
                    run.status = TaskRunStatus.FAILED
                    run.error = buffer.error or "Unknown error"
                    run.output = buffer.get_full_content()

            except asyncio.TimeoutError:
                run.status = TaskRunStatus.TIMED_OUT
                run.error = f"Timed out after {max_runtime_minutes} minutes"
                # Preserve any partial output collected before timeout
                run.output = buffer.get_full_content() if buffer else None
                logger.warning(f"[task-run:{run.id}] Timed out")
            except asyncio.CancelledError:
                run.status = TaskRunStatus.ABORTED
                run.error = "Aborted"
                run.output = buffer.get_full_content() if buffer else None
            except Exception as e:
                run.status = TaskRunStatus.FAILED
                run.error = str(e)
                run.output = buffer.get_full_content() if buffer else None
                logger.error(f"[task-run:{run.id}] Failed: {e}")
            finally:
                run.completed_at = datetime.now(timezone.utc)
                if run.started_at:
                    run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
                task_run_storage_service.save_run(run)
                # Destroy the SessionClient (stops the subprocess) but keep SDK session state
                # on disk so user can resume later. A fresh client is created on demand.
                await self._copilot.destroy_session_client(session_id)
                # Clean up buffer
                await self._buffer_manager.remove_buffer(session_id)
                duration_str = f"{run.duration_seconds:.1f}s" if run.duration_seconds else "n/a"
                logger.info(f"[task-run:{run.id}] Finished status={run.status.value} duration={duration_str}")

    async def abort_run(self, run_id: str) -> bool:
        """Abort a running task. Returns True if aborted."""
        task = self._active_runs.get(run_id)
        if not task or task.done():
            return False
        task.cancel()
        # Update status
        run = task_run_storage_service.load_run(run_id)
        if run:
            run.status = TaskRunStatus.ABORTED
            run.completed_at = datetime.now(timezone.utc)
            if run.started_at:
                run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
            run.error = "Aborted by user"
            task_run_storage_service.save_run(run)
        return True

    def get_active_runs(self) -> list[str]:
        """Get IDs of currently running tasks."""
        return [rid for rid, t in self._active_runs.items() if not t.done()]

    @property
    def active_count(self) -> int:
        return len([t for t in self._active_runs.values() if not t.done()])
