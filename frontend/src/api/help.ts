export interface HelpResponse {
  answer: string;
  session_id: string;
}

const API_BASE = '/api';

export async function askHelp(question: string): Promise<HelpResponse> {
  const response = await fetch(`${API_BASE}/help/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!response.ok) {
    let detail = `Help request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.detail) detail = String(data.detail);
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return response.json();
}
