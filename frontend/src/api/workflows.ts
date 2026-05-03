/** Workflow CRUD and execution API functions. */

import type {
  WorkflowMetadata,
  WorkflowDetail,
  WorkflowCreate,
  WorkflowUpdate,
  WorkflowRun,
  WorkflowRunSummary,
  WorkflowRunRequest,
  HumanInputRequest,
} from '../types/workflow';

const API_BASE = '/api';

export async function createWorkflow(request: WorkflowCreate): Promise<WorkflowMetadata> {
  const response = await fetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to create workflow');
  }
  return response.json();
}

export async function listWorkflows(): Promise<WorkflowMetadata[]> {
  const response = await fetch(`${API_BASE}/workflows`);
  if (!response.ok) {
    throw new Error('Failed to list workflows');
  }
  return response.json();
}

export async function getWorkflow(workflowId: string): Promise<WorkflowDetail> {
  const response = await fetch(`${API_BASE}/workflows/${workflowId}`);
  if (!response.ok) {
    throw new Error('Failed to get workflow');
  }
  return response.json();
}

export async function updateWorkflow(workflowId: string, request: WorkflowUpdate): Promise<WorkflowMetadata> {
  const response = await fetch(`${API_BASE}/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to update workflow');
  }
  return response.json();
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/workflows/${workflowId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete workflow');
  }
}

export async function visualizeWorkflow(workflowId: string): Promise<{ mermaid: string }> {
  const response = await fetch(`${API_BASE}/workflows/${workflowId}/visualize`);
  if (!response.ok) {
    throw new Error('Failed to visualize workflow');
  }
  return response.json();
}

export async function runWorkflow(workflowId: string, request?: WorkflowRunRequest): Promise<{ run_id: string; status: string }> {
  const response = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request || {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to run workflow');
  }
  return response.json();
}

export interface WorkflowRunListResponse {
  items: WorkflowRunSummary[];
  total: number;
}

export async function listWorkflowRuns(workflowId: string, limit = 50): Promise<WorkflowRunListResponse> {
  const response = await fetch(`${API_BASE}/workflows/${workflowId}/runs?limit=${limit}`);
  if (!response.ok) {
    throw new Error('Failed to list workflow runs');
  }
  return response.json();
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRun> {
  const response = await fetch(`${API_BASE}/workflow-runs/${runId}`);
  if (!response.ok) {
    throw new Error('Failed to get workflow run');
  }
  return response.json();
}

export async function deleteWorkflowRun(runId: string): Promise<{ deleted: boolean; sessions_removed?: number }> {
  const response = await fetch(`${API_BASE}/workflow-runs/${runId}`, { method: 'DELETE' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data.detail;
    const msg = typeof detail === 'string'
      ? detail
      : detail?.message || 'Failed to delete workflow run';
    throw new Error(msg);
  }
  return response.json();
}

export async function sendHumanInput(runId: string, request: HumanInputRequest): Promise<{ ok: boolean; status: string }> {
  const response = await fetch(`${API_BASE}/workflow-runs/${runId}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to send human input');
  }
  return response.json();
}

export function createWorkflowRunStream(runId: string, fromEvent = 0): EventSource {
  return new EventSource(`${API_BASE}/workflow-runs/${runId}/stream?from_event=${fromEvent}`);
}
