const API_BASE = '/api';

/** Mapping of cwd → project name (only user overrides). */
export type ProjectMapping = Record<string, string>;

export async function fetchProjects(): Promise<ProjectMapping> {
  const response = await fetch(`${API_BASE}/projects`);
  if (!response.ok) throw new Error('Failed to fetch projects');
  return response.json();
}

export async function resolveProject(cwd: string): Promise<{ cwd: string; name: string }> {
  const response = await fetch(`${API_BASE}/projects/resolve?cwd=${encodeURIComponent(cwd)}`);
  if (!response.ok) throw new Error('Failed to resolve project');
  return response.json();
}

export async function saveProject(cwd: string, name: string): Promise<ProjectMapping> {
  const response = await fetch(`${API_BASE}/projects`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, name }),
  });
  if (!response.ok) throw new Error('Failed to save project');
  return response.json();
}

export async function deleteProject(cwd: string): Promise<ProjectMapping> {
  const response = await fetch(`${API_BASE}/projects?cwd=${encodeURIComponent(cwd)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete project');
  return response.json();
}
