export interface SearchSnippet {
  content: string;
  message_role: string;
  sdk_message_id: string | null;
  timestamp: string | null;
}

export interface SearchResult {
  session_id: string;
  session_name: string;
  match_type: string; // "name" | "content" | "both"
  snippets: SearchSnippet[];
  last_active: number;
  trigger?: string | null; // "workflow" | "automation" | "help" | null — for client-side filtering
}

const API_BASE = '/api';

export async function searchSessions(query: string): Promise<SearchResult[]> {
  const response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error('Search failed');
  }
  const data: { results: SearchResult[] } = await response.json();
  return data.results || [];
}
