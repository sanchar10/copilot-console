"""Tests for workflow API routes.

Uses a dedicated test client that sends Host: localhost to bypass auth middleware.
Follows the hermetic test pattern from conftest.py but with auth-compatible base_url.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure src/ is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


SAMPLE_YAML = """\
kind: Workflow
name: test-sequential
trigger:
  kind: OnConversationStart
  id: start
  actions:
    - kind: InvokeAzureAgent
      id: step_a
      agent:
        name: agent-a
    - kind: InvokeAzureAgent
      id: step_b
      agent:
        name: agent-b
"""


@pytest.fixture
def wf_client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Test client with localhost base_url so auth middleware allows requests."""
    agent_home = tmp_path / "copilot-console-home"
    user_home = tmp_path / "user-home"
    agent_home.mkdir(parents=True, exist_ok=True)
    user_home.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("copilot_console_HOME", str(agent_home))
    monkeypatch.setenv("HOME", str(user_home))
    monkeypatch.setenv("USERPROFILE", str(user_home))

    # Force clean import
    for mod in list(sys.modules):
        if mod.startswith("copilot_console.app"):
            sys.modules.pop(mod, None)

    import copilot_console.app.services.copilot_service as cs_mod

    async def _noop():
        return None

    monkeypatch.setattr(cs_mod.copilot_service, "_start_main_client", _noop)

    # Bypass auth middleware — TestClient's request.client.host is "testclient" not localhost
    import copilot_console.app.middleware.auth as auth_mod
    monkeypatch.setattr(auth_mod, "_is_localhost", lambda request: True)

    from copilot_console.app.main import app

    with TestClient(app) as tc:
        yield tc


SAMPLE_YAML = """\
kind: Workflow
name: test-sequential
trigger:
  kind: OnConversationStart
  id: start
  actions:
    - kind: InvokeAzureAgent
      id: step_a
      agent:
        name: agent-a
    - kind: InvokeAzureAgent
      id: step_b
      agent:
        name: agent-b
"""


class TestWorkflowCrud:
    """Test workflow CRUD endpoints."""

    def test_create_workflow(self, wf_client):
        resp = wf_client.post("/api/workflows", json={
            "name": "Test Pipeline",
            "description": "A test workflow",
            "yaml_content": SAMPLE_YAML,
        })
        assert resp.status_code == 200
        data = resp.json()
        # Name comes from YAML, not the request body
        assert data["name"] == "test-sequential"
        assert "id" in data

    def test_create_workflow_invalid_yaml(self, wf_client):
        resp = wf_client.post("/api/workflows", json={
            "name": "Bad",
            "yaml_content": "not: valid: yaml: workflow",
        })
        assert resp.status_code == 400

    def test_list_workflows_empty(self, wf_client):
        resp = wf_client.get("/api/workflows")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_workflows(self, wf_client):
        wf_client.post("/api/workflows", json={
            "name": "WF1", "yaml_content": SAMPLE_YAML,
        })
        wf_client.post("/api/workflows", json={
            "name": "WF2", "yaml_content": SAMPLE_YAML,
        })
        resp = wf_client.get("/api/workflows")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_get_workflow(self, wf_client):
        create_resp = wf_client.post("/api/workflows", json={
            "name": "Get Me", "yaml_content": SAMPLE_YAML,
        })
        wf_id = create_resp.json()["id"]

        resp = wf_client.get(f"/api/workflows/{wf_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "test-sequential"
        assert data["yaml_content"] == SAMPLE_YAML

    def test_get_workflow_not_found(self, wf_client):
        resp = wf_client.get("/api/workflows/nonexistent")
        assert resp.status_code == 404

    def test_update_workflow(self, wf_client):
        create_resp = wf_client.post("/api/workflows", json={
            "name": "Original", "yaml_content": SAMPLE_YAML,
        })
        wf_id = create_resp.json()["id"]

        # Update without new yaml_content — name stays from YAML
        resp = wf_client.put(f"/api/workflows/{wf_id}", json={
            "name": "Updated",
            "description": "New description",
        })
        assert resp.status_code == 200
        # Name comes from YAML, not the request body
        assert resp.json()["name"] == "test-sequential"

        # Verify YAML unchanged
        detail = wf_client.get(f"/api/workflows/{wf_id}").json()
        assert detail["yaml_content"] == SAMPLE_YAML

    def test_update_workflow_with_yaml(self, wf_client):
        create_resp = wf_client.post("/api/workflows", json={
            "name": "YamlUpdate", "yaml_content": SAMPLE_YAML,
        })
        wf_id = create_resp.json()["id"]

        new_yaml = SAMPLE_YAML.replace("test-sequential", "updated-workflow")
        resp = wf_client.put(f"/api/workflows/{wf_id}", json={
            "yaml_content": new_yaml,
        })
        assert resp.status_code == 200

        detail = wf_client.get(f"/api/workflows/{wf_id}").json()
        assert "updated-workflow" in detail["yaml_content"]

    def test_update_workflow_invalid_yaml(self, wf_client):
        create_resp = wf_client.post("/api/workflows", json={
            "name": "BadUpdate", "yaml_content": SAMPLE_YAML,
        })
        wf_id = create_resp.json()["id"]

        resp = wf_client.put(f"/api/workflows/{wf_id}", json={
            "yaml_content": "not valid workflow yaml",
        })
        assert resp.status_code == 400

    def test_delete_workflow(self, wf_client):
        create_resp = wf_client.post("/api/workflows", json={
            "name": "Delete Me", "yaml_content": SAMPLE_YAML,
        })
        wf_id = create_resp.json()["id"]

        resp = wf_client.delete(f"/api/workflows/{wf_id}")
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

        # Verify deleted
        resp = wf_client.get(f"/api/workflows/{wf_id}")
        assert resp.status_code == 404

    def test_delete_workflow_not_found(self, wf_client):
        resp = wf_client.delete("/api/workflows/nonexistent")
        assert resp.status_code == 404


class TestWorkflowVisualization:
    """Test Mermaid visualization endpoint."""

    def test_visualize_workflow(self, wf_client):
        create_resp = wf_client.post("/api/workflows", json={
            "name": "Viz Test", "yaml_content": SAMPLE_YAML,
        })
        wf_id = create_resp.json()["id"]

        resp = wf_client.get(f"/api/workflows/{wf_id}/visualize")
        assert resp.status_code == 200
        data = resp.json()
        assert "mermaid" in data
        assert "flowchart" in data["mermaid"]

    def test_visualize_not_found(self, wf_client):
        resp = wf_client.get("/api/workflows/nonexistent/visualize")
        assert resp.status_code == 404


class TestWorkflowRunManagement:
    """Test workflow run listing and detail endpoints."""

    def test_list_runs_empty(self, wf_client):
        create_resp = wf_client.post("/api/workflows", json={
            "name": "Run List", "yaml_content": SAMPLE_YAML,
        })
        wf_id = create_resp.json()["id"]

        resp = wf_client.get(f"/api/workflows/{wf_id}/runs")
        assert resp.status_code == 200
        assert resp.json() == {"items": [], "total": 0}

    def test_get_run_not_found(self, wf_client):
        resp = wf_client.get("/api/workflow-runs/nonexistent")
        assert resp.status_code == 404

    def test_send_input_not_found(self, wf_client):
        resp = wf_client.post("/api/workflow-runs/nonexistent/input", json={
            "request_id": "req-1",
            "data": True,
        })
        assert resp.status_code == 404
