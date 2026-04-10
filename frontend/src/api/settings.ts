const API_BASE = '/api';

export interface Settings {
  default_model: string;
  default_reasoning_effort: string | null;
  default_cwd: string;
  cli_notifications?: boolean;
  desktop_notifications?: string;
}

export async function getSettings(): Promise<Settings> {
  const response = await fetch(`${API_BASE}/settings`);
  if (!response.ok) {
    throw new Error('Failed to get settings');
  }
  return response.json();
}

export async function updateSettings(settings: Partial<Settings>): Promise<Settings> {
  const response = await fetch(`${API_BASE}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error('Failed to update settings');
  }
  return response.json();
}
