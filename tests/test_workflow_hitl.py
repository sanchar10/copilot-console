"""HITL (human-in-the-loop) workflow execution tests.

Exercises Phase 1 of the workflows refactor: parked-task RunHandle model,
real declarative YAML with `Confirmation` / `Question` actions, response
normalization, and request_id validation.

Tests are hermetic — they use real `agent_framework_declarative` workflows
but no agents (HITL executors don't invoke agents). They run against the
process-local RunHandle, not the FastAPI router.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from copilot_console.app.services.workflow_engine import (
    _build_external_input_response,
    workflow_engine,
)


# ---------------------------------------------------------------------------
# Real declarative YAML fixtures
# ---------------------------------------------------------------------------

YAML_CONFIRMATION = """
kind: Workflow
name: hitl-confirm
description: Single Confirmation HITL test
trigger:
  kind: OnConversationStart
  id: t1
  actions:
    - kind: Confirmation
      id: confirm1
      message: Proceed?
      output_property: Local.confirmed
"""

YAML_SETVALUE_THEN_CONFIRM = """
kind: Workflow
name: hitl-setvalue
description: SetValue before HITL — value must survive resume
trigger:
  kind: OnConversationStart
  id: t1
  actions:
    - kind: SetValue
      id: setx
      path: Local.x
      value: 42
    - kind: Confirmation
      id: confirm1
      message: Proceed?
      output_property: Local.confirmed
"""


async def _drive_workflow(yaml: str, response):
    """Run a HITL workflow to completion, submitting `response` on the first
    request_info event. Returns the workflow's final declarative state.
    """
    wf = workflow_engine.load_from_yaml_string(yaml)
    handle = await workflow_engine.start_run(wf, "go")
    saw_request = False
    saw_after_resume = False
    async for ev in handle.events():
        if getattr(ev, "type", None) == "request_info":
            saw_request = True
            await handle.submit_response(handle.pending_request_id, response)
        elif saw_request:
            saw_after_resume = True
    state = wf._state.get("_declarative_workflow_state")
    return wf, handle, state, saw_request, saw_after_resume


# ---------------------------------------------------------------------------
# _build_external_input_response unit tests
# ---------------------------------------------------------------------------

class TestBuildExternalInputResponse:
    def test_bool_true_for_confirmation(self):
        from agent_framework_declarative._workflows._executors_external_input import (
            ExternalInputRequest,
        )
        pending = ExternalInputRequest(
            request_id="r1", message="Proceed?", request_type="confirmation",
            metadata={},
        )
        out = _build_external_input_response(pending, True)
        assert out == {"user_input": "yes", "value": True}

    def test_bool_false_for_confirmation(self):
        from agent_framework_declarative._workflows._executors_external_input import (
            ExternalInputRequest,
        )
        pending = ExternalInputRequest(
            request_id="r1", message="Proceed?", request_type="confirmation",
            metadata={},
        )
        out = _build_external_input_response(pending, False)
        assert out == {"user_input": "no", "value": False}

    def test_str_for_question(self):
        from agent_framework_declarative._workflows._executors_external_input import (
            ExternalInputRequest,
        )
        pending = ExternalInputRequest(
            request_id="r1", message="Name?", request_type="question",
            metadata={},
        )
        out = _build_external_input_response(pending, "alice")
        assert out == {"user_input": "alice", "value": "alice"}

    def test_dict_passthrough(self):
        from agent_framework_declarative._workflows._executors_external_input import (
            ExternalInputRequest,
        )
        pending = ExternalInputRequest(
            request_id="r1", message="Form", request_type="external",
            metadata={},
        )
        out = _build_external_input_response(pending, {"user_input": "ok", "value": {"a": 1}})
        assert out == {"user_input": "ok", "value": {"a": 1}}

    def test_dict_backfills_user_input(self):
        from agent_framework_declarative._workflows._executors_external_input import (
            ExternalInputRequest,
        )
        pending = ExternalInputRequest(
            request_id="r1", message="Form", request_type="external",
            metadata={},
        )
        out = _build_external_input_response(pending, {"value": "raw"})
        assert out["value"] == "raw"
        assert out["user_input"] == '"raw"'

    def test_none_pending_defaults_to_external(self):
        out = _build_external_input_response(None, "anything")
        assert out["user_input"] == "anything"


# ---------------------------------------------------------------------------
# RunHandle integration tests
# ---------------------------------------------------------------------------

class TestRunHandleHITL:
    @pytest.mark.asyncio
    async def test_confirmation_approve(self):
        wf, handle, state, saw_req, saw_after = await _drive_workflow(YAML_CONFIRMATION, True)
        assert saw_req, "request_info never emitted"
        assert saw_after, "no events after resume — handle stayed parked"
        assert state["Local"]["confirmed"] is True

    @pytest.mark.asyncio
    async def test_confirmation_reject(self):
        wf, handle, state, saw_req, saw_after = await _drive_workflow(YAML_CONFIRMATION, False)
        assert saw_req and saw_after
        assert state["Local"]["confirmed"] is False

    @pytest.mark.asyncio
    async def test_setvalue_survives_pause_resume(self):
        """Idempotent State.clear patch must NOT wipe Local.x set before HITL."""
        wf, handle, state, _, _ = await _drive_workflow(YAML_SETVALUE_THEN_CONFIRM, True)
        assert state["Local"]["x"] == 42, f"Local.x was wiped during resume: {state['Local']}"
        assert state["Local"]["confirmed"] is True

    @pytest.mark.asyncio
    async def test_double_submit_raises(self):
        wf = workflow_engine.load_from_yaml_string(YAML_CONFIRMATION)
        handle = await workflow_engine.start_run(wf, "go")
        async for ev in handle.events():
            if getattr(ev, "type", None) == "request_info":
                await handle.submit_response(handle.pending_request_id, True)
                with pytest.raises(ValueError, match="already submitted"):
                    await handle.submit_response(handle.pending_request_id, True)

    @pytest.mark.asyncio
    async def test_stale_request_id_raises(self):
        wf = workflow_engine.load_from_yaml_string(YAML_CONFIRMATION)
        handle = await workflow_engine.start_run(wf, "go")
        async for ev in handle.events():
            if getattr(ev, "type", None) == "request_info":
                with pytest.raises(ValueError, match="Stale request_id"):
                    await handle.submit_response("not-a-real-id", True)
                # Cleanup so workflow can complete
                await handle.submit_response(handle.pending_request_id, True)

    @pytest.mark.asyncio
    async def test_pending_request_metadata_exposed(self):
        wf = workflow_engine.load_from_yaml_string(YAML_CONFIRMATION)
        handle = await workflow_engine.start_run(wf, "go")
        async for ev in handle.events():
            if getattr(ev, "type", None) == "request_info":
                req = handle.pending_request
                assert req is not None
                assert req.request_type == "confirmation"
                assert req.message == "Proceed?"
                assert req.metadata.get("output_property") == "Local.confirmed"
                await handle.submit_response(handle.pending_request_id, True)
