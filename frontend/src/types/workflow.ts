/** Workflow types matching backend models. */

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'aborted';

export interface WorkflowMetadata {
  id: string;
  name: string;
  description: string;
  yaml_filename: string;
  created_at: string;
  updated_at: string;
  uses_powerfx?: boolean;
  powerfx_available?: boolean;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  description: string;
  yaml_content: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowCreate {
  name: string;
  description?: string;
  yaml_content: string;
}

export interface WorkflowUpdate {
  name?: string;
  description?: string;
  yaml_content?: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: WorkflowRunStatus;
  input: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  node_results: Record<string, unknown>;
  events: Record<string, unknown>[];
  error: string | null;
  session_id: string | null;
}

export interface WorkflowRunSummary {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: WorkflowRunStatus;
  input: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  error: string | null;
  session_id: string | null;
}

export interface WorkflowRunRequest {
  message?: string;
  input_params?: Record<string, unknown>;
  cwd?: string;
}

export interface HumanInputRequest {
  request_id: string;
  data: unknown;
}

/** Discriminator from agent_framework's ExternalInputRequest.request_type. */
export type HumanInputKind = 'confirmation' | 'question' | 'user_input' | 'external';

/** Choice shape for question kind. */
export interface HumanInputChoice {
  value: string;
  label: string;
}

/** Polymorphic prompt shape pushed via the human_input_required SSE event. */
export interface HumanInputPrompt {
  request_id: string;
  request_type?: HumanInputKind | string | null;
  message?: string | null;
  metadata?: {
    output_property?: string;
    choices?: HumanInputChoice[] | null;
    yes_label?: string;
    no_label?: string;
    default_value?: unknown;
    allow_free_text?: boolean;
    timeout_seconds?: number | null;
    required_fields?: string[] | null;
    [key: string]: unknown;
  } | null;
  /** Legacy free-form data carried forward from the SDK event for fallback rendering. */
  data?: unknown;
}
