import type { MCPServer, MCPServerConfig } from '../types/mcp';

const API_BASE = '/api';

/** Writable scope identifier; matches the Python ``MCPServerScope`` enum. */
export type MCPWritableScope = 'global' | 'agent-only';

export interface MCPCreateRequest {
  scope: MCPWritableScope;
  name: string;
  config: Record<string, unknown>;
  /** Optional convenience: also flips the per-server auto-enable flag in one round trip. */
  autoEnable?: boolean;
}

export interface MCPUpdateRequest {
  config: Record<string, unknown>;
  autoEnable?: boolean;
}

export interface MCPResetOAuthResult {
  removed: string[];
  scanned: number;
}

/** Settings overlay: per-server "auto-enable on new sessions" flags. */
export interface MCPSettings {
  mcp_auto_enable: Record<string, boolean>;
}

/** Patch payload — `true`/`false` sets the flag, `null` removes the entry. */
export type MCPSettingsPatch = Record<string, boolean | null>;

/** Carries HTTP status + parsed detail from the backend so callers can show
 *  precise toasts (409 conflict, 403 read-only, 400 bad payload, etc.). */
export class MCPApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail || `MCP API error ${status}`);
    this.name = 'MCPApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function parseError(response: Response): Promise<MCPApiError> {
  let detail = response.statusText;
  try {
    const body = await response.json();
    if (body && typeof body.detail === 'string') {
      detail = body.detail;
    } else if (Array.isArray(body?.detail)) {
      // FastAPI 422 validation errors are an array
      detail = body.detail.map((e: { msg?: string }) => e?.msg ?? '').filter(Boolean).join('; ');
    }
  } catch {
    // body wasn't JSON — keep statusText as detail
  }
  return new MCPApiError(response.status, detail);
}

export async function listMCPServers(): Promise<MCPServerConfig> {
  const response = await fetch(`${API_BASE}/mcp/servers`);
  if (!response.ok) {
    throw new Error('Failed to list MCP servers');
  }
  return response.json();
}

export async function refreshMCPServers(): Promise<MCPServerConfig> {
  const response = await fetch(`${API_BASE}/mcp/servers/refresh`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to refresh MCP servers');
  }
  return response.json();
}

export async function createMCPServer(req: MCPCreateRequest): Promise<MCPServer> {
  const response = await fetch(`${API_BASE}/mcp/servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function updateMCPServer(name: string, req: MCPUpdateRequest): Promise<MCPServer> {
  const response = await fetch(`${API_BASE}/mcp/servers/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function deleteMCPServer(name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/mcp/servers/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  // 204 No Content is the expected success path
  if (!response.ok) {
    throw await parseError(response);
  }
}

export async function resetMCPOAuth(name: string): Promise<MCPResetOAuthResult> {
  const response = await fetch(
    `${API_BASE}/mcp/servers/${encodeURIComponent(name)}/reset-oauth`,
    { method: 'POST' },
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function getMCPSettings(): Promise<MCPSettings> {
  const response = await fetch(`${API_BASE}/mcp/settings`);
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function patchMCPSettings(patch: MCPSettingsPatch): Promise<MCPSettings> {
  const response = await fetch(`${API_BASE}/mcp/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mcp_auto_enable: patch }),
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}
