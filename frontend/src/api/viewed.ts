/**
 * API for session viewed timestamps
 */

/** Resolve API base — uses full tunnel URL on mobile, relative '/api' on desktop */
function getApiBase(): string {
  const baseUrl = localStorage.getItem('copilotconsole_base_url');
  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, '')}/api`;
  }
  return '/api';
}

/** Build headers with auth token if available (supports both desktop and mobile/tunnel access) */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem('copilotconsole_api_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export interface ViewedTimestamps {
  [sessionId: string]: number;
}

/**
 * Get all session viewed timestamps
 */
export async function getViewedTimestamps(): Promise<ViewedTimestamps> {
  console.log(`[Viewed API] GET /viewed`);
  const response = await fetch(`${getApiBase()}/viewed`, { headers: getAuthHeaders() });
  if (!response.ok) {
    console.error('[Viewed API] Failed to fetch viewed timestamps');
    return {};
  }
  const data = await response.json();
  console.log(`[Viewed API] Loaded ${Object.keys(data).length} timestamps:`, data);
  return data;
}

/**
 * Mark a session as viewed
 */
export async function markSessionViewed(sessionId: string): Promise<void> {
  try {
    console.log(`[Viewed API] POST /viewed/${sessionId}`);
    const response = await fetch(`${getApiBase()}/viewed/${sessionId}`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (response.ok) {
      const data = await response.json();
      console.log(`[Viewed API] Success:`, data);
    } else {
      console.error(`[Viewed API] Failed: ${response.status}`);
    }
  } catch (error) {
    console.error('[Viewed API] Error:', error);
  }
}
